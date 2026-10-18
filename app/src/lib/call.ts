// A chamada: conexão com o servidor de sinalização + uma RTCPeerConnection
// por amigo (malha ponto a ponto). Voz e tela vão direto entre os PCs, sem
// passar por servidor, com a menor latência possível.
//
// A negociação usa o padrão "perfect negotiation" do WebRTC: qualquer lado
// pode adicionar/remover mídia a qualquer momento (começar a transmitir a
// tela, por exemplo) e colisões de oferta se resolvem sozinhas.

import { audio } from './audio';
import { tuneSdp } from './sdp';
import { settings, type VideoCodec } from './settings';
import { createStore } from './store';

export interface PeerMediaState {
  muted: boolean;
  deafened: boolean;
  /** id do MediaStream da tela, ou null se não está transmitindo. */
  screen: string | null;
  screenAudio: boolean;
}

export interface RemotePeer {
  id: string;
  name: string;
  avatar: string | null;
  state: PeerMediaState;
  connection: RTCPeerConnectionState | 'new';
  screenStream: MediaStream | null;
}

export interface ChatMessage {
  id: string;
  from: string;
  name: string;
  text: string;
  /** Imagem anexada (data URL) ou null. */
  image?: string | null;
  /** A imagem saiu do histórico do servidor (só as mais recentes ficam). */
  expired?: boolean;
  ts: number;
}

export type CallStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting';
export type Resolution = '720' | '1080' | '1440' | '2160' | 'native';

export interface ScreenOptions {
  sourceId: string | null;
  resolution: Resolution;
  fps: 15 | 30 | 60;
  /** detail = texto/código nítido; motion = jogo/vídeo fluido. */
  mode: 'detail' | 'motion';
  audio: boolean;
}

export interface CallState {
  status: CallStatus;
  error: string | null;
  room: string | null;
  selfId: string | null;
  peers: Record<string, RemotePeer>;
  messages: ChatMessage[];
  unread: number;
  muted: boolean;
  deafened: boolean;
  micError: string | null;
  localScreen: MediaStream | null;
  localScreenOptions: ScreenOptions | null;
  speaking: Record<string, boolean>;
}

export interface VideoStats {
  width: number;
  height: number;
  fps: number;
  kbps: number;
  codec: string;
}

const RESOLUTIONS: Record<Exclude<Resolution, 'native'>, [number, number]> = {
  '720': [1280, 720],
  '1080': [1920, 1080],
  '1440': [2560, 1440],
  '2160': [3840, 2160],
};

const MIC_BITRATE = 96_000;
const MIC_BITRATE_HIFI = 256_000;
const SCREEN_AUDIO_BITRATE = 192_000;
const MIN_VIDEO_KBPS = 1500;
const MAX_VIDEO_KBPS = 40_000;
const PROTOCOL = 1;

/** Bitrate de vídeo proporcional a pixels × quadros (bits por pixel por quadro). */
export function videoBitrateKbps(width: number, height: number, fps: number, mode: ScreenOptions['mode']): number {
  const bpp = mode === 'detail' ? 0.09 : 0.07;
  const kbps = (width * height * fps * bpp) / 1000;
  return Math.round(Math.min(MAX_VIDEO_KBPS, Math.max(MIN_VIDEO_KBPS, kbps)));
}

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingRemoteAnswer: boolean;
  /** Transceptor da voz. Nulo até a primeira oferta, em quem responde. */
  micTx: RTCRtpTransceiver | null;
  screenSenders: RTCRtpSender[];
  streams: Map<string, MediaStream>;
  statsPrev: { bytes: number; ts: number } | null;
}

function initialState(): CallState {
  return {
    status: 'idle',
    error: null,
    room: null,
    selfId: null,
    peers: {},
    messages: [],
    unread: 0,
    muted: false,
    deafened: false,
    micError: null,
    localScreen: null,
    localScreenOptions: null,
    speaking: {},
  };
}

/** Escolhe o codec de vídeo: o melhor que o PC codifica em hardware. */
async function pickCodec(pref: VideoCodec, width: number, height: number, fps: number): Promise<string> {
  if (pref !== 'auto') return { h264: 'video/H264', vp9: 'video/VP9', av1: 'video/AV1' }[pref];
  const candidates = ['video/AV1', 'video/VP9', 'video/H264'];
  for (const contentType of candidates) {
    try {
      const info = await navigator.mediaCapabilities.encodingInfo({
        type: 'webrtc',
        video: { contentType, width, height, framerate: fps, bitrate: videoBitrateKbps(width, height, fps, 'motion') * 1000 },
      });
      if (info.supported && info.powerEfficient) return contentType;
    } catch {
      // Consulta não suportada: segue pro próximo.
    }
  }
  // Sem codificador de hardware: H.264 em software é o mais leve em resolução alta.
  return 'video/H264';
}

/** Põe o codec preferido na frente; se ele não existir aqui, tenta VP9, H.264 e AV1. */
function orderCodecs(preferred: string): RTCRtpCodec[] | null {
  const caps = RTCRtpReceiver.getCapabilities('video');
  if (!caps) return null;
  const priority = [preferred, 'video/VP9', 'video/H264', 'video/AV1', 'video/VP8'].map((m) => m.toLowerCase());
  const rank = (c: RTCRtpCodec) => {
    const i = priority.indexOf(c.mimeType.toLowerCase());
    return i < 0 ? priority.length : i; // RTX/RED/FEC vão pro fim, na ordem original
  };
  const sorted = caps.codecs.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i);
  return sorted.map((x) => x.c);
}

function micConstraints(): MediaTrackConstraints {
  const s = settings.get();
  const device = s.inputDeviceId && s.inputDeviceId !== 'default' ? { deviceId: { exact: s.inputDeviceId } } : {};
  if (s.hifi) {
    return {
      ...device,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
      sampleRate: { ideal: 48000 },
      sampleSize: { ideal: 24 },
    };
  }
  return {
    ...device,
    echoCancellation: s.echoCancellation,
    noiseSuppression: s.noiseSuppression,
    autoGainControl: s.autoGainControl,
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48000 },
  };
}

class Call {
  readonly store = createStore<CallState>(initialState());

  private ws: WebSocket | null = null;
  private peers = new Map<string, Peer>();
  private iceServers: RTCIceServer[] = [];
  private target: { url: string; room: string; name: string } | null = null;
  private retry = 0;
  private retryTimer: number | null = null;
  private micStream: MediaStream | null = null;
  /** Ganho da minha voz entre o microfone e o envio. */
  private micChain: ReturnType<typeof audio.micPipeline> | null = null;
  /** Stream "contêiner" do microfone: id fixo, a faixa dentro troca à vontade. */
  private micOut = new MediaStream();
  private screen: MediaStream | null = null;
  private screenOpts: ScreenOptions | null = null;
  private screenCodec = 'video/H264';
  private chatVisible = false;
  private pingTimer: number | null = null;

  constructor() {
    audio.onSpeaking((speaking) => this.store.set({ speaking }));
    audio.localTrackEnabled = () => !this.store.get().muted;
  }

  // ---------------------------------------------------------------- sala

  async join(url: string, room: string, name: string) {
    this.leave();
    audio.unlock();
    this.target = { url, room, name };
    this.store.set({ ...initialState(), status: 'connecting', muted: this.store.get().muted });
    await this.acquireMic();
    void audio.setOutputDevice(settings.get().outputDeviceId);
    audio.setOutputVolume(settings.get().outputVolume);
    this.connect();
  }

  leave() {
    this.target = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.ws) {
      this.send({ t: 'leave' });
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.closePeers();
    this.stopScreen(false);
    this.micChain?.dispose();
    this.micChain = null;
    for (const t of this.micStream?.getTracks() ?? []) t.stop();
    this.micStream = null;
    for (const t of this.micOut.getTracks()) this.micOut.removeTrack(t);
    audio.dispose();
    const { muted, deafened } = this.store.get();
    this.store.set({ ...initialState(), muted, deafened });
  }

  private connect() {
    const target = this.target;
    if (!target) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(target.url);
    } catch {
      this.store.set({ status: 'idle', error: 'Endereço do servidor inválido. Confira nas configurações.' });
      this.target = null;
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.send({
        t: 'join',
        room: target.room,
        name: target.name,
        avatar: settings.get().avatar,
        state: this.localState(),
        protocol: PROTOCOL,
      });
    };
    ws.onmessage = (ev) => {
      try {
        this.onServerMessage(JSON.parse(String(ev.data)));
      } catch (err) {
        console.error('[sinalização] mensagem inválida', err);
      }
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (!this.target) return;
      const neverConnected = this.store.get().status === 'connecting' && this.retry === 0;
      this.closePeers();
      if (neverConnected) {
        this.leave();
        this.store.set({ error: 'Não deu pra conectar ao servidor. Confira o endereço nas configurações.' });
        return;
      }
      // Caiu no meio: tenta voltar sozinho (1s, 2s, 4s... até 10s).
      this.store.set({ status: 'reconnecting' });
      const delay = Math.min(10_000, 1000 * 2 ** this.retry++);
      this.retryTimer = window.setTimeout(() => this.connect(), delay);
    };
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private onServerMessage(msg: any) {
    switch (msg.t) {
      case 'welcome': {
        this.retry = 0;
        this.iceServers = msg.iceServers ?? [];
        const peers: Record<string, RemotePeer> = {};
        for (const p of msg.peers as { id: string; name: string; avatar: string | null; state: PeerMediaState }[]) {
          peers[p.id] = { id: p.id, name: p.name, avatar: p.avatar ?? null, state: p.state, connection: 'new', screenStream: null };
        }
        this.store.set({ status: 'connected', error: null, room: msg.room, selfId: msg.id, peers, messages: msg.history ?? [] });
        for (const id of Object.keys(peers)) this.ensurePeer(id);
        this.pingTimer = window.setInterval(() => this.send({ t: 'ping', ts: Date.now() }), 20_000);
        return;
      }
      case 'peer-joined': {
        const p = msg.peer as { id: string; name: string; avatar: string | null; state: PeerMediaState };
        this.store.set((s) => ({
          peers: {
            ...s.peers,
            [p.id]: { id: p.id, name: p.name, avatar: p.avatar ?? null, state: p.state, connection: 'new', screenStream: null },
          },
        }));
        this.applyVolume(p.id);
        // Quem acabou de entrar é quem inicia a conexão (evita as duas ofertas
        // se cruzarem). Aqui só esperamos a oferta dele chegar.
        if (settings.get().sounds) audio.chime('join');
        return;
      }
      case 'peer-left': {
        this.dropPeer(msg.id);
        if (settings.get().sounds) audio.chime('leave');
        return;
      }
      case 'profile': {
        const peer = this.store.get().peers[msg.id];
        if (!peer) return;
        this.store.set((s) => ({ peers: { ...s.peers, [msg.id]: { ...peer, name: msg.name, avatar: msg.avatar ?? null } } }));
        return;
      }
      case 'state': {
        const peer = this.store.get().peers[msg.id];
        if (!peer) return;
        this.store.set((s) => ({ peers: { ...s.peers, [msg.id]: { ...peer, state: msg.state } } }));
        this.refreshPeerMedia(msg.id);
        return;
      }
      case 'signal':
        void this.onSignal(msg.from, msg.data);
        return;
      case 'chat': {
        const m = msg.msg as ChatMessage;
        const mine = m.from === this.store.get().selfId;
        this.store.set((s) => ({
          messages: [...s.messages, m].slice(-300),
          unread: !mine && !this.chatVisible ? s.unread + 1 : s.unread,
        }));
        if (!mine && settings.get().sounds) audio.chime('message');
        return;
      }
      case 'error':
        if (msg.code === 'room-full' || msg.code === 'bad-room') {
          this.leave();
        }
        this.store.set({ error: msg.message });
        return;
      default:
        return;
    }
  }

  // ---------------------------------------------------------------- peers

  /**
   * Cria a conexão com um amigo. `answering` = ela nasce de uma oferta que ele
   * mandou: aí a voz é ligada no transceptor que a oferta criou (bindMic),
   * sem precisar de uma segunda rodada de negociação.
   */
  private ensurePeer(id: string, answering = false): Peer {
    const existing = this.peers.get(id);
    if (existing) return existing;
    const selfId = this.store.get().selfId ?? '';
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' });

    const micTrack = this.micOut.getAudioTracks()[0] ?? null;
    const micTx = answering ? null : pc.addTransceiver(micTrack ?? 'audio', { direction: 'sendrecv', streams: [this.micOut] });

    const peer: Peer = {
      id,
      pc,
      polite: selfId > id,
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      micTx,
      screenSenders: [],
      streams: new Map(),
      statsPrev: null,
    };
    this.peers.set(id, peer);

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.signal(id, { description: this.outgoing(pc.localDescription!) });
      } catch (err) {
        console.error('[rtc] falha ao criar oferta', err);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.signal(id, { candidate: candidate.toJSON() });
    };
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      peer.streams.set(stream.id, stream);
      const refresh = () => this.refreshPeerMedia(id);
      stream.onaddtrack = refresh;
      stream.onremovetrack = refresh;
      ev.track.onunmute = refresh;
      ev.track.onended = refresh;
      refresh();
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'failed') pc.restartIce();
      if (state === 'connected') void this.tuneSenders(peer);
      const remote = this.store.get().peers[id];
      if (remote) this.store.set((s) => ({ peers: { ...s.peers, [id]: { ...remote, connection: state } } }));
    };

    if (!answering) {
      void this.tuneSenders(peer);
      if (this.screen) this.attachScreen(peer);
    }
    return peer;
  }

  /** Liga o microfone no transceptor de áudio que veio na primeira oferta. */
  private bindMic(peer: Peer) {
    if (peer.micTx) return;
    const tx = peer.pc.getTransceivers().find((t) => t.receiver.track.kind === 'audio' && !t.sender.track && t.currentDirection !== 'stopped');
    const track = this.micOut.getAudioTracks()[0] ?? null;
    if (tx) {
      tx.direction = 'sendrecv';
      tx.sender.setStreams(this.micOut);
      if (track) void tx.sender.replaceTrack(track);
      peer.micTx = tx;
    } else {
      peer.micTx = peer.pc.addTransceiver(track ?? 'audio', { direction: 'sendrecv', streams: [this.micOut] });
    }
  }

  private outgoing(desc: RTCSessionDescription): RTCSessionDescriptionInit {
    return { type: desc.type, sdp: tuneSdp(desc.sdp) };
  }

  private signal(to: string, data: object) {
    this.send({ t: 'signal', to, data });
  }

  private async onSignal(from: string, data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
    if (!this.store.get().peers[from]) return;
    const fresh = !this.peers.has(from);
    if (fresh && data.description?.type !== 'offer') return;
    const peer = this.ensurePeer(from, fresh);
    const pc = peer.pc;
    try {
      if (data.description) {
        const description = data.description;
        const readyForOffer = !peer.makingOffer && (pc.signalingState === 'stable' || peer.settingRemoteAnswer);
        const collision = description.type === 'offer' && !readyForOffer;
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        peer.settingRemoteAnswer = description.type === 'answer';
        await pc.setRemoteDescription(description);
        peer.settingRemoteAnswer = false;
        if (description.type === 'offer') {
          if (!peer.micTx) {
            this.bindMic(peer);
            if (this.screen) this.attachScreen(peer);
          }
          await pc.setLocalDescription();
          this.signal(from, { description: this.outgoing(pc.localDescription!) });
        }
        void this.tuneSenders(peer);
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (err) {
          if (!peer.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.error('[rtc] erro na negociação', err);
    }
  }

  /** Classifica os streams recebidos (voz × tela) e liga o áudio certo. */
  private refreshPeerMedia(id: string) {
    const peer = this.peers.get(id);
    const remote = this.store.get().peers[id];
    if (!peer || !remote) return;
    const screenId = remote.state.screen;
    let mic: MediaStreamTrack | null = null;
    let screen: MediaStream | null = null;
    for (const stream of peer.streams.values()) {
      if (screenId && stream.id === screenId) {
        screen = stream;
      } else {
        const track = stream.getAudioTracks().find((t) => t.readyState === 'live');
        if (track) mic = track;
      }
    }
    audio.setSource(`${id}:mic`, mic);
    const screenAudio = screen?.getAudioTracks().find((t) => t.readyState === 'live') ?? null;
    audio.setSource(`${id}:screen`, screenAudio);
    const screenStream = screen && screen.getVideoTracks().some((t) => t.readyState === 'live') ? screen : null;
    if (remote.screenStream !== screenStream) {
      this.store.set((s) => ({ peers: { ...s.peers, [id]: { ...s.peers[id], screenStream } } }));
    }
  }

  private dropPeer(id: string) {
    const peer = this.peers.get(id);
    if (peer) {
      peer.pc.close();
      this.peers.delete(id);
    }
    audio.removePeer(id);
    this.store.set((s) => {
      const peers = { ...s.peers };
      delete peers[id];
      return { peers };
    });
  }

  private closePeers() {
    for (const id of [...this.peers.keys()]) {
      this.peers.get(id)!.pc.close();
      audio.removePeer(id);
    }
    this.peers.clear();
    this.store.set({ peers: {} });
  }

  /** Limites de bitrate e prioridades dos envios (voz e tela). */
  private async tuneSenders(peer: Peer) {
    const hifi = settings.get().hifi;
    if (peer.micTx) await this.setSenderParams(peer.micTx.sender, (enc) => {
      enc.maxBitrate = hifi ? MIC_BITRATE_HIFI : MIC_BITRATE;
      enc.priority = 'high';
      enc.networkPriority = 'high';
    });
    const opts = this.screenOpts;
    const video = this.screen?.getVideoTracks()[0];
    if (!opts || !video) return;
    const { width = 1920, height = 1080, frameRate } = video.getSettings();
    const fps = Math.min(opts.fps, Math.round(frameRate ?? opts.fps)) || opts.fps;
    for (const sender of peer.screenSenders) {
      if (sender.track?.kind === 'video') {
        await this.setSenderParams(
          sender,
          (enc) => {
            enc.maxBitrate = videoBitrateKbps(width, height, fps, opts.mode) * 1000;
            enc.maxFramerate = opts.fps;
            enc.scaleResolutionDownBy = 1;
            enc.priority = 'high';
            enc.networkPriority = 'high';
          },
          opts.mode === 'detail' ? 'maintain-resolution' : 'maintain-framerate',
        );
      } else if (sender.track?.kind === 'audio') {
        await this.setSenderParams(sender, (enc) => {
          enc.maxBitrate = SCREEN_AUDIO_BITRATE;
        });
      }
    }
  }

  private async setSenderParams(
    sender: RTCRtpSender,
    edit: (enc: RTCRtpEncodingParameters & { priority?: string; networkPriority?: string }) => void,
    degradation?: RTCDegradationPreference,
  ) {
    try {
      const params = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: RTCDegradationPreference };
      if (!params.encodings?.length) return;
      params.encodings.forEach((enc) => edit(enc));
      if (degradation) params.degradationPreference = degradation;
      await sender.setParameters(params);
    } catch {
      // Antes da negociação terminar alguns campos ainda não valem: tentamos de novo depois.
    }
  }

  private applyVolume(id: string) {
    const peer = this.store.get().peers[id];
    if (!peer) return;
    audio.setVolume(`${id}:mic`, settings.get().userVolumes[peer.name] ?? 1);
  }

  setUserVolume(id: string, volume: number) {
    const peer = this.store.get().peers[id];
    if (!peer) return;
    settings.set((s) => ({ userVolumes: { ...s.userVolumes, [peer.name]: volume } }));
    audio.setVolume(`${id}:mic`, volume);
  }

  setScreenVolume(id: string, volume: number) {
    audio.setVolume(`${id}:screen`, volume);
  }

  // ---------------------------------------------------------------- voz

  private localState(): PeerMediaState {
    const s = this.store.get();
    return {
      muted: s.muted,
      deafened: s.deafened,
      screen: this.screen?.id ?? null,
      screenAudio: !!this.screen?.getAudioTracks().length,
    };
  }

  private broadcastState() {
    this.send({ t: 'state', state: this.localState() });
  }

  /** (Re)abre o microfone com as configurações atuais e troca a faixa em todas as conexões. */
  async acquireMic() {
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(), video: false });
      this.store.set({ micError: null });
    } catch (err) {
      try {
        // O dispositivo salvo pode ter sumido (fone desconectado): tenta o padrão.
        const fallback = { ...micConstraints() } as MediaTrackConstraints;
        delete fallback.deviceId;
        stream = await navigator.mediaDevices.getUserMedia({ audio: fallback, video: false });
        this.store.set({ micError: null });
      } catch {
        const name = (err as DOMException)?.name;
        this.store.set({
          micError:
            name === 'NotAllowedError'
              ? 'Sem permissão pro microfone. Você entra só ouvindo.'
              : 'Nenhum microfone encontrado. Você entra só ouvindo.',
        });
      }
    }
    this.micChain?.dispose();
    this.micChain = null;
    for (const t of this.micStream?.getTracks() ?? []) t.stop();
    this.micStream = stream;
    for (const t of this.micOut.getTracks()) this.micOut.removeTrack(t);
    const raw = stream?.getAudioTracks()[0] ?? null;
    let track: MediaStreamTrack | null = null;
    if (raw) {
      const s = settings.get();
      this.micChain = audio.micPipeline(raw, s.micGain, s.hifi);
      track = this.micChain.track;
      track.contentHint = s.hifi ? 'music' : 'speech';
      track.enabled = !this.store.get().muted;
      this.micOut.addTrack(track);
    }
    audio.setLocal(track);
    for (const peer of this.peers.values()) {
      await peer.micTx?.sender.replaceTrack(track);
      void this.tuneSenders(peer);
    }
  }

  toggleMute() {
    const s = this.store.get();
    const muted = !s.muted;
    // Desmutar também tira o "ensurdecido" (igual ao Discord).
    const deafened = muted ? s.deafened : false;
    this.setVoice(muted, deafened);
    if (settings.get().sounds) audio.chime(muted ? 'mute' : 'unmute');
  }

  toggleDeafen() {
    const s = this.store.get();
    const deafened = !s.deafened;
    this.setVoice(deafened ? true : s.muted && !s.deafened ? true : false, deafened);
    if (settings.get().sounds) audio.chime(deafened ? 'mute' : 'unmute');
  }

  private setVoice(muted: boolean, deafened: boolean) {
    this.store.set({ muted, deafened });
    for (const t of this.micOut.getAudioTracks()) t.enabled = !muted;
    audio.setDeafened(deafened);
    this.broadcastState();
  }

  // ---------------------------------------------------------------- tela

  async startScreen(opts: ScreenOptions) {
    this.stopScreen(false);
    if (window.discordia && opts.sourceId) await window.discordia.selectScreenSource(opts.sourceId, opts.audio);

    const size = opts.resolution === 'native' ? null : RESOLUTIONS[opts.resolution];
    const video: MediaTrackConstraints = {
      frameRate: { ideal: opts.fps, max: opts.fps },
      ...(size ? { width: { max: size[0] }, height: { max: size[1] } } : {}),
    };
    const audioConstraints: MediaTrackConstraints | boolean = opts.audio
      ? ({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, suppressLocalAudioPlayback: false, restrictOwnAudio: true } as MediaTrackConstraints)
      : false;
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video,
      audio: audioConstraints,
      // Só valem no navegador; o Electron usa a fonte escolhida no seletor.
      ...({ systemAudio: opts.audio ? 'include' : 'exclude', selfBrowserSurface: 'exclude', surfaceSwitching: 'include' } as object),
    } as DisplayMediaStreamOptions);

    const track = stream.getVideoTracks()[0];
    track.contentHint = opts.mode === 'detail' ? 'detail' : 'motion';
    try {
      await track.applyConstraints(video);
    } catch {
      // Algumas fontes não aceitam redimensionar: fica no tamanho original.
    }
    track.addEventListener('ended', () => this.stopScreen());

    const { width = 1920, height = 1080 } = track.getSettings();
    this.screenCodec = await pickCodec(settings.get().codec, width, height, opts.fps);
    this.screen = stream;
    this.screenOpts = opts;
    this.broadcastState();
    for (const peer of this.peers.values()) this.attachScreen(peer);
    this.store.set({ localScreen: stream, localScreenOptions: opts });
  }

  private attachScreen(peer: Peer) {
    if (!this.screen) return;
    const order = orderCodecs(this.screenCodec);
    for (const track of this.screen.getTracks()) {
      const sender = peer.pc.addTrack(track, this.screen);
      peer.screenSenders.push(sender);
      if (track.kind === 'video' && order) {
        const tx = peer.pc.getTransceivers().find((t) => t.sender === sender);
        try {
          tx?.setCodecPreferences(order);
        } catch (err) {
          console.warn('[rtc] codec preferido indisponível', err);
        }
      }
    }
    void this.tuneSenders(peer);
  }

  stopScreen(announce = true) {
    if (!this.screen) return;
    for (const peer of this.peers.values()) {
      for (const sender of peer.screenSenders) {
        try {
          peer.pc.removeTrack(sender);
        } catch {
          // Conexão já fechada.
        }
      }
      peer.screenSenders = [];
    }
    for (const t of this.screen.getTracks()) t.stop();
    this.screen = null;
    this.screenOpts = null;
    this.store.set({ localScreen: null, localScreenOptions: null });
    if (announce) this.broadcastState();
  }

  // ---------------------------------------------------------------- chat

  sendChat(text: string, image: string | null = null) {
    const clean = text.trim();
    if (clean || image) this.send({ t: 'chat', text: clean, image });
  }

  // ---------------------------------------------------------------- perfil e volumes

  /** Troca nome e/ou foto no meio da sala; os amigos veem na hora. */
  updateProfile(name: string, avatar: string | null) {
    if (this.target) this.target.name = name;
    this.send({ t: 'profile', name, avatar });
  }

  setMicGain(gain: number) {
    settings.set({ micGain: gain });
    this.micChain?.setGain(gain);
  }

  setOutputVolume(volume: number) {
    settings.set({ outputVolume: volume });
    audio.setOutputVolume(volume);
  }

  setChatVisible(visible: boolean) {
    this.chatVisible = visible;
    if (visible) this.store.set({ unread: 0 });
  }

  clearError() {
    this.store.set({ error: null });
  }

  // ---------------------------------------------------------------- estatísticas

  /** Resolução/fps/bitrate do vídeo de tela recebido de um amigo. */
  async remoteVideoStats(id: string): Promise<VideoStats | null> {
    const peer = this.peers.get(id);
    if (!peer) return null;
    const report = await peer.pc.getStats();
    let inbound: any = null;
    report.forEach((s: any) => {
      if (s.type === 'inbound-rtp' && s.kind === 'video' && (!inbound || s.bytesReceived > inbound.bytesReceived)) inbound = s;
    });
    if (!inbound) return null;
    const codec = inbound.codecId ? (report.get(inbound.codecId) as any)?.mimeType?.replace('video/', '') ?? '' : '';
    const prev = peer.statsPrev;
    const kbps = prev ? ((inbound.bytesReceived - prev.bytes) * 8) / (inbound.timestamp - prev.ts) : 0;
    peer.statsPrev = { bytes: inbound.bytesReceived, ts: inbound.timestamp };
    return {
      width: inbound.frameWidth ?? 0,
      height: inbound.frameHeight ?? 0,
      fps: Math.round(inbound.framesPerSecond ?? 0),
      kbps: Math.max(0, Math.round(kbps)),
      codec,
    };
  }
}

export const call = new Call();

// Expõe pra depuração e pros testes automáticos.
(window as unknown as { __discordiaCall: Call }).__discordiaCall = call;
