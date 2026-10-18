import { useEffect, useState } from 'react';
import { Loader2, WifiOff, X } from 'lucide-react';
import { call } from './lib/call';
import { useStore } from './lib/store';
import { TitleBar } from './components/TitleBar';
import { Home } from './components/Home';
import { Sidebar } from './components/Sidebar';
import { Stage } from './components/Stage';
import { Chat } from './components/Chat';
import { ScreenPicker } from './components/ScreenPicker';
import { SettingsModal } from './components/SettingsModal';

export function App() {
  const status = useStore(call.store, (s) => s.status);
  const room = useStore(call.store, (s) => s.room);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const inRoom = status === 'connected' || status === 'reconnecting' || (status === 'connecting' && !!room);

  return (
    <div className="flex h-full flex-col">
      <TitleBar
        onSettings={() => setSettingsOpen(true)}
        center={inRoom && room ? <span className="truncate font-medium">#{room}</span> : null}
      />
      {inRoom ? <Room onSettings={() => setSettingsOpen(true)} /> : <Home onSettings={() => setSettingsOpen(true)} />}
      {status === 'connecting' && !room && <ConnectingOverlay />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

const wide = () => window.matchMedia('(min-width: 1024px)').matches;

function Room({ onSettings }: { onSettings: () => void }) {
  const [chatOpen, setChatOpen] = useState(wide);
  const [people, setPeople] = useState(false);
  const [picker, setPicker] = useState(false);
  const status = useStore(call.store, (s) => s.status);
  const error = useStore(call.store, (s) => s.error);

  // Atalhos: Ctrl+Shift+M muta, Ctrl+Shift+D ensurdece.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      if (e.code === 'KeyM') {
        e.preventDefault();
        call.toggleMute();
      } else if (e.code === 'KeyD') {
        e.preventDefault();
        call.toggleDeafen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1">
      {/* Tela larga: barra lateral fixa. Celular: gaveta que abre por cima. */}
      <div className={people ? 'absolute inset-0 z-30 flex lg:static lg:z-auto' : 'hidden lg:flex'}>
        <Sidebar onSettings={onSettings} />
        {people && <div className="flex-1 bg-black/40 lg:hidden" onClick={() => setPeople(false)} />}
      </div>
      <Stage
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen((o) => !o)}
        onShare={() => setPicker(true)}
        onPeople={() => setPeople(true)}
      />
      {chatOpen && <Chat onClose={() => setChatOpen(false)} />}
      {picker && <ScreenPicker onClose={() => setPicker(false)} />}

      {status === 'reconnecting' && (
        <div className="animate-pop absolute top-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-warning px-4 py-2 text-sm font-semibold text-black shadow-soft">
          <WifiOff size={15} /> Conexão caiu — reconectando…
        </div>
      )}
      {error && (
        <div className="animate-pop absolute bottom-24 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-danger px-4 py-2.5 text-sm font-medium text-white shadow-soft">
          {error}
          <button onClick={() => call.clearError()} title="Fechar">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function ConnectingOverlay() {
  return (
    <div className="animate-fade fixed inset-0 top-10 z-40 grid place-items-center bg-bg/70 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 text-muted">
        <Loader2 className="animate-spin text-accent" size={28} />
        <span className="text-sm font-medium">Entrando na sala…</span>
        <button onClick={() => call.leave()} className="text-xs underline-offset-2 hover:underline">
          Cancelar
        </button>
      </div>
    </div>
  );
}
