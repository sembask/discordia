import type { ReactNode } from 'react';
import { Monitor, Moon, Settings2, Sun } from 'lucide-react';
import { settings, type Theme } from '../lib/settings';
import { useStore } from '../lib/store';
import { cx } from './ui';

const isDesktop = !!window.discordia;
const isMac = window.discordia?.platform === 'darwin';

const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const ICON: Record<Theme, ReactNode> = {
  light: <Sun size={16} />,
  dark: <Moon size={16} />,
  system: <Monitor size={16} />,
};
const LABEL: Record<Theme, string> = { light: 'Tema claro', dark: 'Tema escuro', system: 'Tema do sistema' };

export function ThemeButton() {
  const theme = useStore(settings, (s) => s.theme);
  return (
    <button
      onClick={() => settings.set({ theme: NEXT[theme] })}
      title={`${LABEL[theme]} (clique pra trocar)`}
      className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg"
    >
      {ICON[theme]}
    </button>
  );
}

export function TitleBar({ center, onSettings }: { center?: ReactNode; onSettings: () => void }) {
  return (
    <header
      className={cx(
        'drag flex h-10 shrink-0 items-center gap-3 border-b border-line bg-bg',
        isMac ? 'pl-[84px]' : 'pl-4',
        isDesktop && !isMac ? 'pr-[148px]' : 'pr-3',
      )}
    >
      <div className="flex items-center gap-2">
        <img src="./icon.svg" alt="" className="size-5" draggable={false} />
        <span className="text-sm font-bold tracking-tight">Discordia</span>
      </div>
      <div className="flex min-w-0 flex-1 justify-center text-sm text-muted">{center}</div>
      <div className="flex items-center gap-1">
        <ThemeButton />
        <button
          onClick={onSettings}
          title="Configurações"
          className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <Settings2 size={16} />
        </button>
      </div>
    </header>
  );
}
