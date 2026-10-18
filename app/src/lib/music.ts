// Música da sala ("ouvir juntos").
//
// O servidor guarda a fila e o "relógio" da música (qual item, tocando ou
// não, em que segundo). Cada pessoa toca no próprio player oficial do YouTube
// (num iframe) e este módulo mantém o player colado nesse relógio: carrega o
// item certo, dá play/pause e corrige a posição quando escorrega.

import { call } from './call';
import { isWeb, settings } from './settings';
import { createStore } from './store';

export interface MusicItem {
  id: string;
  videoId: string;
  title: string | null;
  author: string | null;
  duration: number | null;
  addedBy: string;
  unavailable: boolean;
  noMeta?: boolean;
}

/** Nome pra mostrar: o título, ou um genérico se ainda não chegou/não existe. */
export function titleOf(item: MusicItem): string {
  return item.title ?? (item.noMeta ? 'Vídeo do YouTube' : 'Carregando título…');
}

export interface MusicState {
  queue: MusicItem[];
  index: number;
  playing: boolean;
  position: number;
  refTime: number;
  loop: 'off' | 'all' | 'one';
  ended: boolean;
}

export interface SearchResult {
  videoId: string;
  title: string;
  author: string;
}

interface Tick {
  id: string | null;
  t: number;
  d: number;
  s: number;
  at: number;
}

interface MusicUi {
  state: MusicState | null;
  /** O player (iframe) está pronto pra receber comandos. */
  ready: boolean;
  /** O navegador bloqueou o som automático: precisa de um clique no vídeo. */
  blocked: boolean;
  fatal: string | null;
  /** Mini-player no canto ou vídeo grande no palco ("assistir juntos"). */
  view: 'mini' | 'stage';
  busy: boolean;
  notice: string | null;
  searchQuery: string;
  results: SearchResult[];
  searching: boolean;
}

const YT = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;
const SYNC_MS = 400;
/** Diferença tolerada antes de corrigir a posição (s). */
const DRIFT_S = 1.2;
const BLOCKED_AFTER_MS = 3500;
const DUCK_FACTOR = 0.3;
const PLAYLIST_TIMEOUT_MS = 12_000;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i;

export const thumbOf = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

export function formatTime(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s) || s < 0) return '–:––';
  const total = Math.floor(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Entende os formatos de link do YouTube (vídeo, Shorts, YouTube Music, playlist, youtu.be). */
export function parseYouTube(input: string): { videoId?: string; list?: string } | null {
  const text = input.trim();
  if (VIDEO_ID.test(text)) return { videoId: text };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!YT_HOSTS.test(url.hostname)) return null;
  const out: { videoId?: string; list?: string } = {};
  const v = url.searchParams.get('v');
  if (v && VIDEO_ID.test(v)) out.videoId = v;
  if (url.hostname.toLowerCase().endsWith('youtu.be')) {
    const id = url.pathname.split('/')[1];
    if (id && VIDEO_ID.test(id)) out.videoId = id;
  }
  const path = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
  if (path) out.videoId = path[1];
  const list = url.searchParams.get('list');
  if (list && /^[A-Za-z0-9_-]{2,64}$/.test(list)) out.list = list;
  return out.videoId || out.list ? out : null;
}

function siteOf(serverUrl: string): string | null {
  try {
    const u = new URL(serverUrl);
    return `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host}`;
  } catch {
    return null;
  }
}

class Music {
  readonly store = createStore<MusicUi>({
    state: null,
    ready: false,
    blocked: false,
    fatal: null,
    view: 'mini',
    busy: false,
    notice: null,
    searchQuery: '',
    results: [],
    searching: false,
  });

  private frame: HTMLIFrameElement | null = null;
  private tick: Tick | null = null;
  private loadedKey: string | null = null;
  private loadedAt = 0;
  private notPlayingSince = 0;
  private reported = new Set<string>();
  private endedKey: string | null = null;
  private lastVolume = -1;
  private playlistWaiters = new Map<string, (ids: string[]) => void>();
  private timer: number | null = null;
  private noticeTimer: number | null = null;

  constructor() {
    call.on('welcome', (msg) => this.apply(msg.music ?? null));
    call.on('music', (msg) => this.apply(msg.state));
    call.on('music-search', (msg) => {
      if (msg.q !== this.store.get().searchQuery) return;
      this.store.set({ results: msg.results ?? [], searching: false });
      if (msg.error) this.notify(msg.error);
    });
    call.store.subscribe(() => {
      const st = call.store.get();
      if (st.status === 'idle' && this.store.get().state) this.reset();
      this.applyVolume();
    });
    settings.subscribe(() => this.applyVolume());
    window.addEventListener('message', (e) => this.onPlayerMessage(e));
  }

  // ------------------------------------------------------------ player (iframe)

  /** Endereço da página do player (servida pelo próprio servidor do Discordia). */
  playerUrl(): string {
    const site = isWeb ? location.origin : siteOf(settings.get().serverUrl);
    const fake = (window as unknown as { __discordiaFakeYT?: boolean }).__discordiaFakeYT ? '?fake=1' : '';
    return `${site ?? ''}/player.html${fake}`;
  }

  attach(frame: HTMLIFrameElement) {
    this.frame = frame;
    this.store.set({ ready: false, fatal: null });
    this.loadedKey = null;
    this.lastVolume = -1;
    if (this.timer) clearInterval(this.timer);
    this.timer = window.setInterval(() => this.sync(), SYNC_MS);
  }

  detach(frame: HTMLIFrameElement) {
    if (this.frame !== frame) return;
    this.frame = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.store.set({ ready: false });
  }

  private cmd(cmd: string, extra: object = {}) {
    this.frame?.contentWindow?.postMessage({ __discordiaCmd: true, cmd, ...extra }, '*');
  }

  private onPlayerMessage(e: MessageEvent) {
    if (!this.frame || e.source !== this.frame.contentWindow) return;
    const m = e.data;
    if (!m || !m.__discordiaPlayer) return;
    switch (m.ev) {
      case 'ready':
        this.loadedKey = null;
        this.lastVolume = -1;
        this.store.set({ ready: true, fatal: null });
        this.sync();
        return;
      case 'tick':
        this.tick = { id: m.id, t: m.t, d: m.d, s: m.s, at: performance.now() };
        return;
      case 'ended': {
        const cur = this.current();
        if (cur && m.id === cur.videoId) {
          const key = `${cur.id}:${this.store.get().state?.refTime}`;
          if (this.endedKey !== key) {
            this.endedKey = key;
            this.op('ended', { id: cur.id });
          }
        }
        return;
      }
      case 'error': {
        const cur = this.current();
        if (cur && m.id === cur.videoId) {
          this.op('error', { id: cur.id });
          this.notify(`“${cur.title ?? cur.videoId}” não pode ser tocado aqui (bloqueado pelo dono do vídeo). Pulando…`);
        }
        return;
      }
      case 'playlist': {
        const done = this.playlistWaiters.get(m.reqId);
        if (done) {
          this.playlistWaiters.delete(m.reqId);
          done(Array.isArray(m.ids) ? m.ids.filter((id: unknown) => typeof id === 'string' && VIDEO_ID.test(id)) : []);
        }
        return;
      }
      case 'fatal':
        this.store.set({ fatal: m.message ?? 'O player do YouTube não carregou.' });
        return;
    }
  }

  // ------------------------------------------------------------ sincronia

  current(): MusicItem | null {
    const st = this.store.get().state;
    return st && st.index >= 0 && st.index < st.queue.length ? st.queue[st.index] : null;
  }

  /** Onde a música deveria estar agora (s), pelo relógio do servidor. */
  expectedPosition(): number {
    const st = this.store.get().state;
    if (!st) return 0;
    return st.playing ? st.position + (call.serverNow() - st.refTime) / 1000 : st.position;
  }

  private apply(state: MusicState | null) {
    this.store.set({ state });
    this.sync();
  }

  private reset() {
    this.store.set({ state: null, blocked: false, results: [], searchQuery: '', view: 'mini' });
    this.loadedKey = null;
    this.cmd('stop');
  }

  private sync() {
    const { state, ready } = this.store.get();
    if (!ready || !this.frame) return;
    this.applyVolume();
    const cur = this.current();
    if (!state || !cur || state.ended || cur.unavailable) {
      if (this.loadedKey) this.cmd('stop');
      this.loadedKey = null;
      if (this.store.get().blocked) this.store.set({ blocked: false });
      return;
    }

    const expected = this.expectedPosition();
    const key = `${cur.id}`;
    if (this.loadedKey !== key) {
      this.cmd('load', { videoId: cur.videoId, start: expected, play: state.playing });
      this.loadedKey = key;
      this.loadedAt = performance.now();
      this.notPlayingSince = 0;
      return;
    }

    const tick = this.tick;
    if (!tick || tick.id !== cur.videoId || performance.now() - tick.at > 2000) return;

    if (tick.d > 0 && !cur.duration && !this.reported.has(cur.id)) {
      this.reported.add(cur.id);
      this.op('duration', { id: cur.id, seconds: tick.d });
    }

    const settling = performance.now() - this.loadedAt < 1500;
    // Terminou aqui mas o servidor mandou tocar de novo (repetir uma, voltar): recarrega.
    if (state.playing && tick.s === YT.ENDED && tick.d > 0 && expected < tick.d - 1.5 && !settling) {
      this.loadedKey = null;
      this.sync();
      return;
    }
    if (state.playing) {
      if (tick.s === YT.PLAYING) {
        this.notPlayingSince = 0;
        if (this.store.get().blocked) this.store.set({ blocked: false });
      } else if (tick.s !== YT.BUFFERING && tick.s !== YT.ENDED && !settling) {
        this.cmd('play');
        this.notPlayingSince ||= performance.now();
        // Continua parado mesmo pedindo play: o navegador barrou o som automático.
        if (performance.now() - this.notPlayingSince > BLOCKED_AFTER_MS && !this.store.get().blocked) {
          this.store.set({ blocked: true });
        }
      }
    } else if (tick.s === YT.PLAYING || tick.s === YT.BUFFERING) {
      this.cmd('pause');
    }

    const drift = tick.t - expected;
    const comparable = tick.s === YT.PLAYING || (!state.playing && tick.s !== YT.BUFFERING);
    if (comparable && !settling && Math.abs(drift) > DRIFT_S && !(cur.duration && expected > cur.duration)) {
      this.cmd('seek', { t: expected });
    }
  }

  // ------------------------------------------------------------ volume

  private applyVolume() {
    if (!this.frame || !this.store.get().ready) return;
    const s = settings.get();
    const st = call.store.get();
    const someoneTalking = Object.entries(st.speaking).some(([k, v]) => v && k !== 'self');
    let v = s.musicMuted || st.deafened ? 0 : s.musicVolume * Math.min(1, s.outputVolume);
    if (s.musicDuck && someoneTalking) v *= DUCK_FACTOR;
    const vol = Math.round(Math.max(0, Math.min(100, v)));
    if (vol === this.lastVolume) return;
    this.lastVolume = vol;
    this.cmd('volume', { v: vol });
  }

  // ------------------------------------------------------------ comandos (vão pro servidor)

  op(op: string, extra: object = {}) {
    call.sendRaw({ t: 'music', op, ...extra });
  }

  private notify(text: string) {
    this.store.set({ notice: text });
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => this.store.set({ notice: null }), 6000);
  }

  private requestPlaylist(list: string): Promise<string[]> {
    const reqId = Math.random().toString(36).slice(2);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.playlistWaiters.delete(reqId);
        resolve([]);
      }, PLAYLIST_TIMEOUT_MS);
      this.playlistWaiters.set(reqId, (ids) => {
        clearTimeout(timer);
        resolve(ids);
      });
      this.cmd('playlist', { list, reqId });
    });
  }

  /**
   * Adiciona a partir do que a pessoa digitou: link de vídeo, link de
   * playlist, id, ou (se o servidor tiver busca) um nome.
   * Devolve true se adicionou algo.
   */
  async add(input: string, mode: 'end' | 'next' | 'now' = 'end'): Promise<boolean> {
    const parsed = parseYouTube(input);
    if (!parsed) {
      if (call.features.search && input.trim()) {
        this.search(input);
        return false;
      }
      this.notify('Cole um link do YouTube (vídeo ou playlist).');
      return false;
    }
    if (parsed.list) {
      this.store.set({ busy: true });
      const ids = await this.requestPlaylist(parsed.list);
      this.store.set({ busy: false });
      if (ids.length) {
        // Link de um vídeo dentro da playlist: começa por ele.
        const start = parsed.videoId ? Math.max(0, ids.indexOf(parsed.videoId)) : 0;
        const ordered = [...ids.slice(start), ...ids.slice(0, start)];
        this.op('add', { items: ordered.map((videoId) => ({ videoId })), mode });
        this.notify(`${ordered.length} músicas da playlist adicionadas.`);
        return true;
      }
      if (!parsed.videoId) {
        this.notify('Não consegui abrir essa playlist (privada ou mix automático?).');
        return false;
      }
    }
    this.op('add', { items: [{ videoId: parsed.videoId }], mode });
    return true;
  }

  addResult(r: SearchResult, mode: 'end' | 'next' | 'now' = 'end') {
    this.op('add', { items: [{ videoId: r.videoId, title: r.title, author: r.author }], mode });
  }

  search(q: string) {
    const query = q.trim();
    if (!query) return;
    this.store.set({ searchQuery: query, searching: true, results: [] });
    this.op('search', { q: query });
  }

  clearSearch() {
    this.store.set({ searchQuery: '', results: [], searching: false });
  }

  togglePlay() {
    const st = this.store.get().state;
    if (!st) return;
    this.op(st.playing ? 'pause' : 'play');
  }

  cycleLoop() {
    const st = this.store.get().state;
    if (!st) return;
    const next = st.loop === 'off' ? 'all' : st.loop === 'all' ? 'one' : 'off';
    this.op('loop', { mode: next });
  }

  setView(view: 'mini' | 'stage') {
    this.store.set({ view });
  }
}

export const music = new Music();
(window as unknown as { __discordiaMusic: Music }).__discordiaMusic = music;
