import { useEffect, useState } from 'react';
import {
  GripVertical,
  ListPlus,
  ListVideo,
  Loader2,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { call } from '../lib/call';
import { formatTime, music, thumbOf, titleOf, type MusicItem } from '../lib/music';
import { settings } from '../lib/settings';
import { useStore } from '../lib/store';
import { Toggle, cx } from './ui';

/** Posição atual da música, atualizada várias vezes por segundo. */
export function useMusicPosition() {
  const [pos, setPos] = useState(0);
  const state = useStore(music.store, (s) => s.state);
  useEffect(() => {
    const tick = () => setPos(music.expectedPosition());
    tick();
    if (!state?.playing) return;
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [state]);
  return pos;
}

export function SeekBar({ compact }: { compact?: boolean }) {
  const cur = useStore(music.store, (s) => (s.state && s.state.index >= 0 ? s.state.queue[s.state.index] : null));
  const pos = useMusicPosition();
  const [drag, setDrag] = useState<number | null>(null);
  const dur = cur?.duration ?? 0;
  const value = drag ?? Math.min(pos, dur || pos);
  return (
    <div className={cx('flex items-center gap-2 text-[11px] text-muted tabular-nums', compact && 'text-[10px]')}>
      <span className="w-9 text-right">{formatTime(value)}</span>
      <input
        type="range"
        aria-label="Posição da música"
        min={0}
        max={dur || 1}
        step={0.5}
        value={dur ? value : 0}
        disabled={!dur}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={() => {
          if (drag != null) music.op('seek', { position: drag });
          setDrag(null);
        }}
        onKeyUp={() => {
          if (drag != null) music.op('seek', { position: drag });
          setDrag(null);
        }}
        className="min-w-0 flex-1"
      />
      <span className="w-9">{formatTime(cur?.duration)}</span>
    </div>
  );
}

function RoundButton({ label, onClick, children, big, active }: { label: string; onClick: () => void; children: React.ReactNode; big?: boolean; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cx(
        'grid place-items-center rounded-full transition',
        big ? 'size-11 bg-fg text-bg hover:scale-105' : 'size-9 text-muted hover:bg-hover hover:text-fg',
        active && !big && 'text-accent',
      )}
    >
      {children}
    </button>
  );
}

export function TransportControls({ compact }: { compact?: boolean }) {
  const st = useStore(music.store, (s) => s.state);
  if (!st) return null;
  const LoopIcon = st.loop === 'one' ? Repeat1 : Repeat;
  return (
    <div className="flex items-center justify-center gap-1">
      {!compact && (
        <RoundButton label="Embaralhar o que falta" onClick={() => music.op('shuffle')}>
          <Shuffle size={16} />
        </RoundButton>
      )}
      <RoundButton label="Voltar" onClick={() => music.op('prev')}>
        <SkipBack size={17} />
      </RoundButton>
      <RoundButton label={st.playing ? 'Pausar' : 'Tocar'} onClick={() => music.togglePlay()} big={!compact}>
        {st.playing ? <Pause size={compact ? 17 : 20} /> : <Play size={compact ? 17 : 20} />}
      </RoundButton>
      <RoundButton label="Pular" onClick={() => music.op('skip')}>
        <SkipForward size={17} />
      </RoundButton>
      {!compact && (
        <RoundButton
          label={st.loop === 'off' ? 'Repetir: desligado' : st.loop === 'all' ? 'Repetir: fila toda' : 'Repetir: só esta'}
          onClick={() => music.cycleLoop()}
          active={st.loop !== 'off'}
        >
          <LoopIcon size={16} />
        </RoundButton>
      )}
    </div>
  );
}

export function MusicVolume() {
  const volume = useStore(settings, (s) => s.musicVolume);
  const muted = useStore(settings, (s) => s.musicMuted);
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => settings.set({ musicMuted: !muted })} title={muted ? 'Ligar som da música' : 'Silenciar música'} className="text-muted hover:text-fg">
        {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </button>
      <input
        type="range"
        aria-label="Volume da música"
        min={0}
        max={100}
        value={muted ? 0 : volume}
        onChange={(e) => settings.set({ musicVolume: Number(e.target.value), musicMuted: false })}
        className="min-w-0 flex-1"
      />
      <span className="w-8 text-right text-[11px] text-muted tabular-nums">{muted ? 0 : volume}%</span>
    </div>
  );
}

function AddBox() {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'end' | 'next'>('end');
  const busy = useStore(music.store, (s) => s.busy);
  const searchOn = call.features.search;
  const submit = async () => {
    if (!text.trim()) return;
    const added = await music.add(text, mode);
    if (added) setText('');
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-panel-2 px-3 focus-within:border-accent">
          {searchOn ? <Search size={15} className="shrink-0 text-faint" /> : <ListPlus size={15} className="shrink-0 text-faint" />}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            placeholder={searchOn ? 'Buscar ou colar link do YouTube' : 'Colar link do YouTube (vídeo ou playlist)'}
            className="h-10 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-faint"
          />
        </div>
        <button
          onClick={() => void submit()}
          disabled={!text.trim() || busy}
          title="Adicionar"
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={18} />}
        </button>
      </div>
      <div className="flex gap-1 text-xs">
        {(['end', 'next'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cx('rounded-lg px-2.5 py-1 font-medium transition', mode === m ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover')}
          >
            {m === 'end' ? 'No fim da fila' : 'Tocar a seguir'}
          </button>
        ))}
      </div>
      <SearchResults onPick={() => setText('')} mode={mode} />
    </div>
  );
}

function SearchResults({ onPick, mode }: { onPick: () => void; mode: 'end' | 'next' }) {
  const { results, searching, searchQuery } = useStore(music.store, (s) => s);
  if (!searchQuery) return null;
  return (
    <div className="animate-pop overflow-hidden rounded-xl border border-line bg-panel-2">
      <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold text-muted">
        <span>Resultados pra “{searchQuery}”</span>
        <button onClick={() => music.clearSearch()} title="Fechar busca">
          <X size={14} />
        </button>
      </div>
      {searching && (
        <div className="grid place-items-center py-6 text-muted">
          <Loader2 size={18} className="animate-spin" />
        </div>
      )}
      {!searching && results.length === 0 && <p className="px-3 pb-3 text-xs text-faint">Nada encontrado.</p>}
      <div className="max-h-72 overflow-y-auto">
        {results.map((r) => (
          <button
            key={r.videoId}
            onClick={() => {
              music.addResult(r, mode);
              music.clearSearch();
              onPick();
            }}
            className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-hover"
          >
            <img src={thumbOf(r.videoId)} alt="" className="h-10 w-16 shrink-0 rounded-md bg-black object-cover" />
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-sm font-medium">{r.title}</span>
              <span className="block truncate text-xs text-muted">{r.author}</span>
            </span>
            <Plus size={16} className="shrink-0 text-accent" />
          </button>
        ))}
      </div>
    </div>
  );
}

function NowPlaying() {
  const st = useStore(music.store, (s) => s.state);
  const view = useStore(music.store, (s) => s.view);
  const duck = useStore(settings, (s) => s.musicDuck);
  const cur = st && st.index >= 0 ? st.queue[st.index] : null;
  if (!st || !cur || st.ended) return null;
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-panel-2/60 p-4">
      <div className="flex gap-3">
        <img src={thumbOf(cur.videoId)} alt="" className="h-14 w-24 shrink-0 rounded-lg bg-black object-cover" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold tracking-wide text-accent uppercase">{st.playing ? 'Tocando agora' : 'Pausado'}</div>
          <div className="line-clamp-2 text-sm leading-snug font-semibold">{titleOf(cur)}</div>
          <div className="truncate text-xs text-muted">
            {cur.author ? `${cur.author} · ` : ''}pedido por {cur.addedBy}
          </div>
        </div>
      </div>
      <SeekBar />
      <TransportControls />
      <MusicVolume />
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-muted">Abaixar quando alguém fala</span>
        <Toggle checked={duck} onChange={(v) => settings.set({ musicDuck: v })} />
      </div>
      <button
        onClick={() => music.setView(view === 'stage' ? 'mini' : 'stage')}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-line py-2 text-xs font-semibold text-muted transition hover:bg-hover hover:text-fg"
      >
        <ListVideo size={14} /> {view === 'stage' ? 'Voltar pro mini-player' : 'Assistir junto (vídeo grande)'}
      </button>
    </div>
  );
}

function QueueRow({
  item,
  index,
  current,
  played,
  onDragStart,
  onDropAt,
}: {
  item: MusicItem;
  index: number;
  current: boolean;
  played: boolean;
  onDragStart: (id: string) => void;
  onDropAt: (index: number) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(item.id);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDropAt(index);
      }}
      className={cx(
        'group flex items-center gap-2 rounded-xl px-1.5 py-1.5 transition',
        current ? 'bg-accent-soft' : 'hover:bg-hover',
        (played || item.unavailable) && !current && 'opacity-50',
        over && 'ring-2 ring-accent',
      )}
    >
      <GripVertical size={14} className="shrink-0 cursor-grab text-faint opacity-0 group-hover:opacity-100" />
      <button onClick={() => music.op('jump', { id: item.id })} title="Tocar esta" className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <span className="relative shrink-0">
          <img src={thumbOf(item.videoId)} alt="" loading="lazy" className="h-9 w-16 rounded-md bg-black object-cover" />
          {current && (
            <span className="absolute inset-0 grid place-items-center rounded-md bg-black/50 text-white">
              <Music2 size={14} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cx('line-clamp-1 text-sm font-medium', current && 'text-accent')}>
            {item.unavailable ? '⚠ ' : ''}
            {titleOf(item)}
          </span>
          <span className="block truncate text-[11px] text-muted">
            {formatTime(item.duration)} · {item.addedBy}
          </span>
        </span>
      </button>
      <button
        onClick={() => music.op('remove', { id: item.id })}
        title="Tirar da fila"
        className="grid size-7 shrink-0 place-items-center rounded-lg text-faint opacity-0 transition group-hover:opacity-100 hover:bg-danger-soft hover:text-danger"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export function MusicPanel() {
  const st = useStore(music.store, (s) => s.state);
  const notice = useStore(music.store, (s) => s.notice);
  const fatal = useStore(music.store, (s) => s.fatal);
  const [dragId, setDragId] = useState<string | null>(null);
  const queue = st?.queue ?? [];
  const totalLeft = queue.slice(Math.max(0, st?.index ?? 0)).reduce((acc, q) => acc + (q.duration ?? 0), 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 border-b border-line p-3">
        <AddBox />
        {notice && <div className="rounded-lg bg-accent-soft px-3 py-2 text-xs font-medium text-accent">{notice}</div>}
        {fatal && <div className="rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium text-danger">{fatal}</div>}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <NowPlaying />
        {queue.length === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-3 px-4 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent">
              <Music2 size={26} />
            </div>
            <p className="text-sm font-semibold">Nenhuma música na fila</p>
            <p className="text-xs text-muted">
              Cole um link do YouTube aqui em cima, ou no chat digite <code className="rounded bg-panel-2 px-1">/play link</code>. Playlists inteiras
              funcionam também.
            </p>
          </div>
        ) : (
          <div>
            <div className="mb-1 flex items-center justify-between px-1 text-xs font-semibold tracking-wide text-muted uppercase">
              <span>Fila — {queue.length}</span>
              {totalLeft > 0 && <span className="font-normal normal-case">{formatTime(totalLeft)} restantes</span>}
            </div>
            {queue.map((item, i) => (
              <QueueRow
                key={item.id}
                item={item}
                index={i}
                current={i === st?.index && !st?.ended}
                played={!!st && (i < st.index || (st.ended && i <= st.index))}
                onDragStart={setDragId}
                onDropAt={(to) => {
                  if (dragId) music.op('move', { id: dragId, to });
                  setDragId(null);
                }}
              />
            ))}
            <button
              onClick={() => music.op('clear')}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2 text-xs font-semibold text-muted transition hover:bg-danger-soft hover:text-danger"
            >
              <Trash2 size={13} /> Limpar fila
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
