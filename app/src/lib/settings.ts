import { createStore } from './store';

export type Theme = 'light' | 'dark' | 'system';
export type VideoCodec = 'auto' | 'h264' | 'vp9' | 'av1';

export interface Settings {
  name: string;
  serverUrl: string;
  theme: Theme;
  inputDeviceId: string;
  outputDeviceId: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  /** Microfone sem processamento, estéreo e com bitrate alto (música, instrumento). */
  hifi: boolean;
  codec: VideoCodec;
  /** Volume por amigo (pelo nome), de 0 a 2. */
  userVolumes: Record<string, number>;
  recentRooms: string[];
  sounds: boolean;
}

const KEY = 'discordia.settings';

function defaultServer(): string {
  const env = import.meta.env.VITE_DEFAULT_SERVER as string | undefined;
  if (env) return env;
  // Aberto pelo navegador a partir do próprio servidor: usa a mesma origem.
  if (!window.discordia && location.protocol.startsWith('http')) {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }
  return 'ws://localhost:8787';
}

const DEFAULTS: Settings = {
  name: '',
  serverUrl: defaultServer(),
  theme: 'system',
  inputDeviceId: 'default',
  outputDeviceId: 'default',
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  hifi: false,
  codec: 'auto',
  userVolumes: {},
  recentRooms: [],
  sounds: true,
};

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...raw };
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
