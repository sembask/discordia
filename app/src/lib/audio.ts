// Motor de áudio: toca as vozes (e o áudio de tela) dos amigos com volume
// individual, detecta quem está falando e toca os sonzinhos de entrar/sair.
//
// Tudo passa por um AudioContext a 48 kHz (a taxa nativa do Opus — sem
// reamostragem, sem perda) e por um ganho mestre (o "ensurdecer").

interface Source {
  trackId: string;
  el: HTMLAudioElement;
  node: MediaStreamAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
}

const SPEAK_THRESHOLD = 0.018; // RMS
const SPEAK_HOLD_MS = 320;
const METER_MS = 60;

type SpeakingListener = (speaking: Record<string, boolean>) => void;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sources = new Map<string, Source>();
  private volumes = new Map<string, number>();
  private local: { trackId: string; node: MediaStreamAudioSourceNode; analyser: AnalyserNode } | null = null;
  private lastLoud = new Map<string, number>();
  private speaking: Record<string, boolean> = {};
  private listeners = new Set<SpeakingListener>();
  private timer: number | null = null;
  private buf = new Float32Array(1024);
  private sinkId = '';
  private localLevel = 0;

  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      if (this.sinkId) void this.applySink();
      this.timer = window.setInterval(() => this.meter(), METER_MS);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Chamar dentro de um clique (o navegador só libera áudio com gesto do usuário). */
  unlock() {
    this.ensure();
  }

  onSpeaking(listener: SpeakingListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Conecta (ou troca/remove) uma fonte remota. `key` = "peerId:mic" ou "peerId:screen". */
  setSource(key: string, track: MediaStreamTrack | null) {
    const current = this.sources.get(key);
    if (current && track && current.trackId === track.id) return;
    if (current) this.removeSource(key);
    if (!track) return;

    const ctx = this.ensure();
    const stream = new MediaStream([track]);
    // O Chrome só "puxa" áudio de WebRTC pro WebAudio se o stream também
    // estiver ligado a um elemento de mídia. Ele fica mudo: quem toca é o grafo.
    const el = new Audio();
    el.srcObject = stream;
    el.muted = true;
    void el.play().catch(() => {});

    const node = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.gain.value = this.volumes.get(key) ?? 1;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    node.connect(gain);
    gain.connect(this.master!);
    node.connect(analyser);
    this.sources.set(key, { trackId: track.id, el, node, gain, analyser });
  }

  removeSource(key: string) {
    const s = this.sources.get(key);
    if (!s) return;
    s.node.disconnect();
    s.gain.disconnect();
    s.el.srcObject = null;
    this.sources.delete(key);
    this.lastLoud.delete(key);
  }

  removePeer(peerId: string) {
    for (const key of [...this.sources.keys()]) if (key.startsWith(`${peerId}:`)) this.removeSource(key);
  }

  setVolume(key: string, volume: number) {
    this.volumes.set(key, volume);
    const s = this.sources.get(key);
    if (s && this.ctx) s.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.03);
  }

  setDeafened(deafened: boolean) {
    this.ensure();
    this.master!.gain.setTargetAtTime(deafened ? 0 : 1, this.ctx!.currentTime, 0.02);
  }

  async setOutputDevice(deviceId: string) {
    this.sinkId = deviceId === 'default' ? '' : deviceId;
    if (this.ctx) await this.applySink();
  }

  private async applySink() {
    const ctx = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    try {
      await ctx.setSinkId?.(this.sinkId);
    } catch (err) {
      console.warn('[áudio] não deu pra trocar a saída', err);
    }
  }

  /** Microfone local, só pra medir se estou falando (não toca de volta). */
  setLocal(track: MediaStreamTrack | null) {
    if (this.local) {
      this.local.node.disconnect();
      this.local = null;
    }
    if (!track) return;
    const ctx = this.ensure();
    const node = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    node.connect(analyser);
    this.local = { trackId: track.id, node, analyser };
  }

  /** Nível do microfone local, 0..1 (pro medidor das configurações). */
  micLevel(): number {
    return this.localLevel;
  }

  private rms(analyser: AnalyserNode): number {
    analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    return Math.sqrt(sum / this.buf.length);
  }

  private meter() {
    const now = performance.now();
    const next: Record<string, boolean> = {};
    const check = (key: string, analyser: AnalyserNode, enabled: boolean) => {
      const level = this.rms(analyser);
      if (key === 'self') this.localLevel = Math.min(1, level * 6);
      if (enabled && level > SPEAK_THRESHOLD) this.lastLoud.set(key, now);
      next[key] = enabled && now - (this.lastLoud.get(key) ?? 0) < SPEAK_HOLD_MS;
    };
    for (const [key, s] of this.sources) {
      if (key.endsWith(':mic')) check(key.slice(0, -4), s.analyser, true);
    }
    if (this.local) {
      const track = this.localTrackEnabled?.() ?? true;
      check('self', this.local.analyser, track);
    }
    const changed =
      Object.keys(next).length !== Object.keys(this.speaking).length ||
      Object.entries(next).some(([k, v]) => this.speaking[k] !== v);
    if (changed) {
      this.speaking = next;
      for (const l of this.listeners) l(next);
    }
  }

  /** Quem controla o mudo informa aqui se o mic está ativo (pra não acender o anel mutado). */
  localTrackEnabled: (() => boolean) | null = null;

  // ---- Sons de interface (sintetizados, sem arquivo) ----

  chime(kind: 'join' | 'leave' | 'mute' | 'unmute' | 'message') {
    const ctx = this.ensure();
    const notes: Record<typeof kind, number[]> = {
      join: [523.25, 783.99],
      leave: [659.25, 392.0],
      mute: [440, 330],
      unmute: [330, 494],
      message: [880],
    };
    const t0 = ctx.currentTime + 0.01;
    notes[kind].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = t0 + i * 0.09;
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(kind === 'message' ? 0.05 : 0.08, start + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      osc.connect(env);
      env.connect(this.master!);
      osc.start(start);
      osc.stop(start + 0.25);
    });
  }

  dispose() {
    for (const key of [...this.sources.keys()]) this.removeSource(key);
    this.setLocal(null);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.speaking = {};
    for (const l of this.listeners) l({});
  }
}

export const audio = new AudioEngine();
