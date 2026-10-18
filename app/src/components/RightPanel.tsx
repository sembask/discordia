import { MessageSquare, Music2, X } from 'lucide-react';
import { call } from '../lib/call';
import { music } from '../lib/music';
import { useStore } from '../lib/store';
import { Chat } from './Chat';
import { MusicPanel } from './MusicPanel';
import { IconButton, cx } from './ui';

export type PanelTab = 'chat' | 'music';

/** Painel da direita com abas: chat e música. No celular, cobre a tela. */
export function RightPanel({ tab, onTab, onClose }: { tab: PanelTab; onTab: (t: PanelTab) => void; onClose: () => void }) {
  const unread = useStore(call.store, (s) => s.unread);
  const playing = useStore(music.store, (s) => !!s.state?.playing && !s.state.ended);
  const tabs: { id: PanelTab; label: string; icon: React.ReactNode; badge?: React.ReactNode }[] = [
    {
      id: 'chat',
      label: 'Chat',
      icon: <MessageSquare size={15} />,
      badge: unread > 0 && tab !== 'chat' ? <span className="rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span> : null,
    },
    {
      id: 'music',
      label: 'Música',
      icon: <Music2 size={15} />,
      badge: playing ? <span className="size-1.5 animate-pulse rounded-full bg-success" /> : null,
    },
  ];
  return (
    <aside className="animate-fade absolute inset-y-0 right-0 z-30 flex w-full shrink-0 flex-col border-l border-line bg-panel shadow-soft sm:w-[340px] lg:static lg:shadow-none">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-line px-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onTab(t.id)}
            className={cx(
              'flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition',
              tab === t.id ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-fg',
            )}
          >
            {t.icon} {t.label} {t.badge}
          </button>
        ))}
        <div className="flex-1" />
        <IconButton label="Fechar painel" onClick={onClose} className="size-8">
          <X size={16} />
        </IconButton>
      </div>
      {tab === 'chat' ? <Chat /> : <MusicPanel />}
    </aside>
  );
}
