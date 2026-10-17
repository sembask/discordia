import { useEffect, useRef, useState } from 'react';
import {
  Headphones,
  HeadphoneOff,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  PhoneOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { call, type VideoStats } from '../lib/call';
import { settings } from '../lib/settings';
import { useStore } from '../lib/store';
import { Avatar, IconButton, cx } from './ui';

interface Share {
  key: string;
  peerId: string | null; // null = minha tela
  name: string;
  stream: MediaStream;
  hasAudio: boolean;
}

function useShares(): Share[] {
  const peers = useStore(call.store, (s) => s.peers);
  const local = useStore(call.store, (s) => s.localScreen);
  const name = useStore(settings, (s) => s.name);
  const shares: Share[] = [];
  for (const p of Object.values(peers)) {
    if (p.screenStream && p.state.screen) {
      shares.push({ key: p.id, peerId: p.id, name: p.name, stream: p.screenStream, hasAudio: p.state.screenAudio });
    }
  }
  shares.sort((a, b) => a.name.localeCompare(b.name));
  if (local) shares.push({ key: 'self', peerId: null, name: name || 'Você', stream: local, hasAudio: local.getAudioTracks().length > 0 });
  return shares;
}

export function Stage({ chatOpen, onToggleChat, onShare }: { chatOpen: boolean; onToggleChat: () => void; onShare: () => void }) {
  const shares = useShares();
  const [focus, setFocus] = useState<string | null>(null);
  const focused = shares.find((s) => s.key === focus) ?? shares.find((s) => s.peerId !== null) ?? shares[0] ?? null;
  const others = shares.filter((s) => s !== focused);

  return (
    <main className="relative flex min-w-0 flex-1 flex-col bg-stage">
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {focused ? (
          <>
            <ScreenTile share={focused} large />
            {others.length > 0 && (
              <div className="flex h-36 shrink-0 gap-3 overflow-x-auto">
                {others.map((s) => (
                  <button key={s.key} onClick={() => setFocus(s.key)} className="aspect-video h-full shrink-0">
                    <ScreenTile share={s} />
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <VoiceGrid onShare={onShare} />
        )}
      </div>
      <ControlBar chatOpen={chatOpen} onToggleChat={onToggleChat} onShare={onShare} />
    </main>
  );
}

function ScreenTile({ share, large }: { share: Share; large?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<VideoStats | null>(null);
  const [vol, setVol] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = share.stream;
    void el.play().catch(() => {});
  }, [share.stream]);

  useEffect(() => {
    if (!large) return;
    let alive = true;
    const tick = async () => {
      if (share.peerId) {
        const s = await call.remoteVideoStats(share.peerId);
        if (alive) setStats(s);
      } else {
        const t = share.stream.getVideoTracks()[0];
        const st = t?.getSettings();
        if (alive && st) setStats({ width: st.width ?? 0, height: st.height ?? 0, fps: Math.round(st.frameRate ?? 0), kbps: 0, codec: '' });
      }
    };
    void tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [large, share.peerId, share.stream]);

  const setVolume = (v: number) => {
    setVol(v);
    if (share.peerId) call.setScreenVolume(share.peerId, v);
  };

  return (
    <div
      ref={box}
      className={cx(
        'group relative overflow-hidden rounded-2xl border border-line bg-black',
        large ? 'min-h-0 flex-1' : 'h-full w-full',
      )}
      onDoubleClick={() => large && box.current?.requestFullscreen()}
    >
      {/* O áudio da tela toca pelo motor de áudio; o vídeo fica sempre mudo. */}
      <video ref={ref} autoPlay playsInline muted className="size-full object-contain" />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent p-3 text-white">
        <span className="flex items-center gap-2 rounded-lg bg-black/40 px-2.5 py-1 text-sm font-semibold backdrop-blur">
          <span className="size-2 rounded-full bg-danger" />
          {share.peerId ? share.name : 'Sua tela'}
        </span>
        {large && stats && stats.width > 0 && (
          <span className="rounded-lg bg-black/40 px-2.5 py-1 font-mono text-xs backdrop-blur">
            {stats.width}×{stats.height} · {stats.fps} fps
            {stats.kbps > 0 && ` · ${(stats.kbps / 1000).toFixed(1)} Mb/s`}
            {stats.codec && ` · ${stats.codec}`}
          </span>
        )}
      </div>

      {large && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-2 bg-gradient-to-t from-black/60 to-transparent p-3 text-white opacity-0 transition-opacity group-hover:opacity-100">
          {share.peerId && share.hasAudio && (
            <div className="flex items-center gap-2 rounded-lg bg-black/40 px-2.5 py-1.5 backdrop-blur">
              <button onClick={() => setVolume(vol > 0 ? 0 : 1)} title="Áudio da tela">
                {vol > 0 ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
              <input type="range" min={0} max={1.5} step={0.01} value={vol} onChange={(e) => setVolume(Number(e.target.value))} className="w-24" />
            </div>
          )}
          <button
            onClick={() => box.current?.requestFullscreen()}
            title="Tela cheia (ou duplo clique)"
            className="grid size-8 place-items-center rounded-lg bg-black/40 backdrop-blur hover:bg-black/60"
          >
            <Maximize2 size={16} />
          </button>
        </div>
      )}

      {!share.peerId && !large && <div className="absolute inset-0 grid place-items-center bg-black/30 text-xs font-semibold text-white">Sua tela</div>}
    </div>
  );
}

function VoiceGrid({ onShare }: { onShare: () => void }) {
  const peers = useStore(call.store, (s) => s.peers);
  const speaking = useStore(call.store, (s) => s.speaking);
  const muted = useStore(call.store, (s) => s.muted);
  const name = useStore(settings, (s) => s.name);
  const people = [{ id: 'self', name: name || 'Você', speaking: !!speaking.self && !muted, muted }].concat(
    Object.values(peers).map((p) => ({ id: p.id, name: p.name, speaking: !!speaking[p.id] && !p.state.muted, muted: p.state.muted })),
  );
  return (
    <div className="bg-grid flex flex-1 flex-col items-center justify-center gap-10 rounded-2xl border border-line bg-panel/40 p-8">
      <div className="flex max-w-3xl flex-wrap justify-center gap-6">
        {people.map((p) => (
          <div key={p.id} className="animate-pop flex w-28 flex-col items-center gap-2.5">
            <div className="relative">
              <Avatar name={p.name} size={84} speaking={p.speaking} />
              {p.muted && (
                <span className="absolute -right-1 -bottom-1 grid size-7 place-items-center rounded-full border-2 border-stage bg-danger text-white">
                  <MicOff size={13} />
                </span>
              )}
            </div>
            <span className="w-full truncate text-center text-sm font-semibold">{p.name}</span>
          </div>
        ))}
      </div>
      <div className="text-center">
        <p className="text-sm text-muted">Ninguém está mostrando a tela.</p>
        <button
          onClick={onShare}
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-accent to-accent-2 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_var(--accent)] transition hover:brightness-110"
        >
          <MonitorUp size={17} /> Compartilhar minha tela
        </button>
      </div>
    </div>
  );
}

function ControlBar({ chatOpen, onToggleChat, onShare }: { chatOpen: boolean; onToggleChat: () => void; onShare: () => void }) {
  const muted = useStore(call.store, (s) => s.muted);
  const deafened = useStore(call.store, (s) => s.deafened);
  const sharing = useStore(call.store, (s) => !!s.localScreen);
  const unread = useStore(call.store, (s) => s.unread);
  return (
    <div className="flex shrink-0 justify-center pb-4">
      <div className="flex items-center gap-1.5 rounded-2xl border border-line bg-panel p-1.5 shadow-soft">
        <IconButton label={muted ? 'Desmutar' : 'Mutar'} danger={muted} onClick={() => call.toggleMute()} className="size-11">
          {muted ? <MicOff size={19} /> : <Mic size={19} />}
        </IconButton>
        <IconButton label={deafened ? 'Voltar a ouvir' : 'Ensurdecer'} danger={deafened} onClick={() => call.toggleDeafen()} className="size-11">
          {deafened ? <HeadphoneOff size={19} /> : <Headphones size={19} />}
        </IconButton>
        <IconButton
          label={sharing ? 'Parar de compartilhar' : 'Compartilhar tela'}
          active={sharing}
          onClick={() => (sharing ? call.stopScreen() : onShare())}
          className="size-11"
        >
          {sharing ? <MonitorOff size={19} /> : <MonitorUp size={19} />}
        </IconButton>
        <div className="relative">
          <IconButton label="Chat" active={chatOpen} onClick={onToggleChat} className="size-11">
            <MessageSquare size={19} />
          </IconButton>
          {unread > 0 && !chatOpen && (
            <span className="absolute -top-1 -right-1 grid min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] font-bold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </div>
        <div className="mx-1 h-7 w-px bg-line" />
        <button
          onClick={() => call.leave()}
          title="Sair da sala"
          className="flex h-11 items-center gap-2 rounded-xl bg-danger px-4 text-sm font-semibold text-white transition hover:brightness-110"
        >
          <PhoneOff size={18} /> Sair
        </button>
      </div>
    </div>
  );
}
