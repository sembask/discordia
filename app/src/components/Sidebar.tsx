import { useState } from 'react';
import { Check, Copy, Link2, Headphones, HeadphoneOff, Mic, MicOff, MonitorUp, PhoneOff, Signal, Volume2, WifiOff } from 'lucide-react';
import { call, type RemotePeer } from '../lib/call';
import { inviteLink, settings } from '../lib/settings';
import { useStore } from '../lib/store';
import { Avatar, IconButton, cx } from './ui';

export function Sidebar() {
  const room = useStore(call.store, (s) => s.room);
  const status = useStore(call.store, (s) => s.status);
  const peers = useStore(call.store, (s) => s.peers);
  const speaking = useStore(call.store, (s) => s.speaking);
  const muted = useStore(call.store, (s) => s.muted);
  const deafened = useStore(call.store, (s) => s.deafened);
  const localScreen = useStore(call.store, (s) => s.localScreen);
  const name = useStore(settings, (s) => s.name);
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const list = Object.values(peers).sort((a, b) => a.name.localeCompare(b.name));

  const link = room ? inviteLink(room) : null;
  const copy = async (what: 'link' | 'code') => {
    if (!room) return;
    await navigator.clipboard.writeText(what === 'link' && link ? link : room);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-panel">
      <div className="border-b border-line p-4">
        <div className="text-xs font-semibold tracking-wide text-muted uppercase">Sala</div>
        <button
          onClick={() => copy('code')}
          title="Copiar o código da sala"
          className="group mt-1 flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-panel-2 px-3 py-2 text-left transition-colors hover:border-accent"
        >
          <span className="selectable truncate font-mono text-sm font-semibold">{room}</span>
          {copied === 'code' ? <Check size={15} className="shrink-0 text-success" /> : <Copy size={15} className="shrink-0 text-muted group-hover:text-accent" />}
        </button>
        {link && (
          <button
            onClick={() => copy('link')}
            title={link}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-sm font-semibold text-accent transition hover:brightness-110"
          >
            {copied === 'link' ? <Check size={15} /> : <Link2 size={15} />}
            {copied === 'link' ? 'Link copiado!' : 'Copiar link de convite'}
          </button>
        )}
        <div className={cx('mt-2 flex items-center gap-1.5 text-xs font-medium', status === 'connected' ? 'text-success' : 'text-warning')}>
          {status === 'connected' ? <Signal size={13} /> : <WifiOff size={13} />}
          {status === 'connected' ? 'Voz conectada' : status === 'reconnecting' ? 'Reconectando…' : 'Conectando…'}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="px-2 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">Na sala — {list.length + 1}</div>
        <MemberRow name={name || 'Você'} you speaking={!!speaking.self && !muted} muted={muted} deafened={deafened} sharing={!!localScreen} />
        {list.map((p) => (
          <RemoteRow key={p.id} peer={p} speaking={!!speaking[p.id] && !p.state.muted} />
        ))}
        {list.length === 0 && (
          <p className="px-3 py-4 text-sm text-faint">
            Ninguém por aqui ainda. Copie o link de convite acima e mande pra galera.
          </p>
        )}
      </div>

      <UserPanel />
    </aside>
  );
}

function MemberRow({
  name,
  you,
  speaking,
  muted,
  deafened,
  sharing,
  weak,
  onClick,
  open,
}: {
  name: string;
  you?: boolean;
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
  sharing: boolean;
  weak?: boolean;
  onClick?: () => void;
  open?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cx(
        'flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors',
        onClick && 'hover:bg-hover',
        open && 'bg-hover',
      )}
    >
      <Avatar name={name} size={32} speaking={speaking} />
      <span className="min-w-0 flex-1">
        <span className={cx('block truncate text-sm font-semibold', weak && 'opacity-60')}>
          {name}
          {you && <span className="ml-1 font-normal text-faint">(você)</span>}
        </span>
        {weak && <span className="block text-xs text-warning">conectando…</span>}
      </span>
      <span className="flex items-center gap-1 text-muted">
        {sharing && <MonitorUp size={15} className="text-accent" />}
        {deafened ? <HeadphoneOff size={15} className="text-danger" /> : muted ? <MicOff size={15} className="text-danger" /> : null}
      </span>
    </button>
  );
}

function RemoteRow({ peer, speaking }: { peer: RemotePeer; speaking: boolean }) {
  const [open, setOpen] = useState(false);
  const volume = useStore(settings, (s) => s.userVolumes[peer.name] ?? 1);
  const weak = peer.connection !== 'connected';
  return (
    <div>
      <MemberRow
        name={peer.name}
        speaking={speaking}
        muted={peer.state.muted}
        deafened={peer.state.deafened}
        sharing={!!peer.state.screen}
        weak={weak}
        open={open}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div className="animate-pop mx-2 mb-2 rounded-xl border border-line bg-panel-2 px-3 py-2.5">
          <div className="mb-1 flex items-center justify-between text-xs font-semibold text-muted">
            <span className="flex items-center gap-1.5">
              <Volume2 size={13} /> Volume
            </span>
            <span>{Math.round(volume * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={volume}
            onChange={(e) => call.setUserVolume(peer.id, Number(e.target.value))}
            className="w-full"
          />
        </div>
      )}
    </div>
  );
}

function UserPanel() {
  const muted = useStore(call.store, (s) => s.muted);
  const deafened = useStore(call.store, (s) => s.deafened);
  const micError = useStore(call.store, (s) => s.micError);
  const speaking = useStore(call.store, (s) => !!s.speaking.self);
  const name = useStore(settings, (s) => s.name);
  return (
    <div className="border-t border-line bg-panel-2/60 p-2">
      {micError && <div className="mb-2 rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium text-danger">{micError}</div>}
      <div className="flex items-center gap-1.5">
        <Avatar name={name || 'Você'} size={32} speaking={speaking && !muted} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{name}</div>
          <div className="truncate text-xs text-muted">{deafened ? 'Ensurdecido' : muted ? 'Mutado' : 'Mic aberto'}</div>
        </div>
        <IconButton label={muted ? 'Desmutar' : 'Mutar'} danger={muted} onClick={() => call.toggleMute()} className="size-8">
          {muted ? <MicOff size={16} /> : <Mic size={16} />}
        </IconButton>
        <IconButton label={deafened ? 'Voltar a ouvir' : 'Ensurdecer'} danger={deafened} onClick={() => call.toggleDeafen()} className="size-8">
          {deafened ? <HeadphoneOff size={16} /> : <Headphones size={16} />}
        </IconButton>
        <IconButton label="Sair da sala" onClick={() => call.leave()} className="size-8 hover:!bg-danger hover:!text-white">
          <PhoneOff size={16} />
        </IconButton>
      </div>
    </div>
  );
}
