export interface ScreenSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnail: string | null;
  icon: string | null;
}

export interface DesktopBridge {
  platform: string;
  getScreenSources(kind?: 'screen' | 'window'): Promise<ScreenSource[]>;
  selectScreenSource(id: string, audio: boolean): Promise<void>;
  setTheme(theme: 'light' | 'dark'): void;
  info(): Promise<{ version: string; platform: string; systemAudio: boolean }>;
}

declare global {
  interface Window {
    /** Só existe no app desktop (Electron). No navegador é undefined. */
    discordia?: DesktopBridge;
  }
}
