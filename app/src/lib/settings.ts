import { createStore } from './store';

export type Theme = 'light' | 'dark' | 'system';
export type VideoCodec = 'auto' | 'h264' | 'vp9' | 'av1';
/** off = nada · browser = filtro do próprio navegador · rnnoise/gtcrn = IA rodando no PC. */
export type NoiseMode = 'off' | 'browser' | 'rnnoise' | 'gtcrn';

export interface Settings {
  name: string;
  serverUrl: string;
  theme: Theme;
  inputDeviceId: string;
  outputDeviceId: string;
  noiseMode: NoiseMode;
  /** Portão de ruído: corta/abaixa tudo abaixo de um limite em dB. */
  gateEnabled: boolean;
  gateAuto: boolean;
  gateThresholdDb: number;
  gateRangeDb: number;
  gateHoldMs: number;
  echoCancellation: boolean;
  autoGainControl: boolean;
  /** Microfone sem processamento, estéreo e com bitrate alto (música, instrumento). */
  hifi: boolean;
  codec: VideoCodec;
  /** Volume por amigo (pelo nome), de 0 a 2. */
  userVolumes: Record<string, number>;
  recentRooms: string[];
  sounds: boolean;
  /** Foto de perfil (data URL 256×256) ou null pras iniciais. */
  avatar: string | null;
  /** Volume da minha voz, 0..2. */
  micGain: number;
  /** Volume de tudo que eu ouço, 0..2. */
  outputVolume: number;
  /** Volume da música da sala (0..100) — separado das vozes. */
  musicVolume: number;
  musicMuted: boolean;
  /** Abaixa a música enquanto alguém fala. */
  musicDuck: boolean;
}

const KEY = 'discordia.settings';

export const isWeb = !window.discordia && location.protocol.startsWith('http');

function defaultServer(): string {
  // Versão web: o próprio site É o servidor, então usa a mesma origem.
  if (isWeb) return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const env = import.meta.env.VITE_DEFAULT_SERVER as string | undefined;
  return env || 'ws://localhost:8787';
}

/** Endereço do site a partir do endereço do servidor (wss://x → https://x). */
function siteOf(serverUrl: string): string | null {
  try {
    const u = new URL(serverUrl);
    if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return null;
    return `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host}`;
  } catch {
    return null;
  }
}

/** Link que abre a sala direto (o servidor também entrega a versão web). */
export function inviteLink(room: string): string | null {
  const site = isWeb ? location.origin : siteOf(settings.get().serverUrl);
  return site ? `${site}/?sala=${encodeURIComponent(room)}` : null;
}

/** Sala vinda de um link de convite (?sala=...), se houver. */
export function roomFromLink(): string {
  return new URLSearchParams(location.search).get('sala') ?? '';
}

/** Tira o ?sala= da barra de endereço (pra não reentrar sozinho depois). */
export function clearRoomLink() {
  if (!location.search.includes('sala=')) return;
  history.replaceState(null, '', location.pathname + location.hash);
}

const DEFAULTS: Settings = {
  name: '',
  serverUrl: defaultServer(),
  theme: 'system',
  inputDeviceId: 'default',
  outputDeviceId: 'default',
  noiseMode: 'browser',
  gateEnabled: true,
  gateAuto: true,
  gateThresholdDb: -50,
  gateRangeDb: 40,
  gateHoldMs: 250,
  echoCancellation: true,
  autoGainControl: true,
  hifi: false,
  codec: 'auto',
  userVolumes: {},
  recentRooms: [],
  sounds: true,
  avatar: null,
  micGain: 1,
  outputVolume: 1,
  musicVolume: 60,
  musicMuted: false,
  musicDuck: true,
};

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    // Versão antiga guardava só liga/desliga da supressão.
    if (raw.noiseMode === undefined && raw.noiseSuppression === false) raw.noiseMode = 'off';
    delete raw.noiseSuppression;
    // Na versão web o servidor é sempre o próprio site.
    return { ...DEFAULTS, ...raw, ...(isWeb ? { serverUrl: DEFAULTS.serverUrl } : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = createStore<Settings>(load());

settings.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings.get()));
  } catch {
    // Armazenamento cheio ou bloqueado: as configurações valem só nesta sessão.
  }
});

export function rememberRoom(room: string) {
  const list = [room, ...settings.get().recentRooms.filter((r) => r !== room)].slice(0, 6);
  settings.set({ recentRooms: list });
}

// ---- Tema ----

const media = window.matchMedia('(prefers-color-scheme: dark)');

export function resolvedTheme(theme: Theme = settings.get().theme): 'light' | 'dark' {
  if (theme === 'system') return media.matches ? 'dark' : 'light';
  return theme;
}

function applyTheme() {
  const t = resolvedTheme();
  document.documentElement.classList.toggle('dark', t === 'dark');
  window.discordia?.setTheme(t);
}

let lastTheme = settings.get().theme;
settings.subscribe(() => {
  if (settings.get().theme !== lastTheme) {
    lastTheme = settings.get().theme;
    applyTheme();
  }
});
media.addEventListener('change', applyTheme);
applyTheme();
