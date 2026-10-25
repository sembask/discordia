// Ações com atalho e as teclas padrão (separado pra settings.ts poder usar sem ciclo).

export type HotkeyAction =
  | 'toggleMute'
  | 'toggleDeafen'
  | 'pushToTalk'
  | 'pushToMute'
  | 'toggleScreen'
  | 'toggleChat'
  | 'musicPlayPause'
  | 'musicSkip';

export type HotkeyMap = Record<HotkeyAction, string | null>;

export const DEFAULT_HOTKEYS: HotkeyMap = {
  toggleMute: 'Ctrl+Shift+KeyM',
  toggleDeafen: 'Ctrl+Shift+KeyD',
  pushToTalk: null,
  pushToMute: null,
  toggleScreen: null,
  toggleChat: null,
  musicPlayPause: null,
  musicSkip: null,
};
