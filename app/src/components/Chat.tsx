import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { ImageOff, ImagePlus, Loader2, SendHorizontal, X } from 'lucide-react';
import { call, type ChatMessage } from '../lib/call';
import { pickImageFile, prepareChatImage } from '../lib/image';
import { settings } from '../lib/settings';
import { useStore } from '../lib/store';
import { Avatar, IconButton, cx } from './ui';

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;
const GROUP_MS = 5 * 60_000;

function linkify(text: string): ReactNode[] {
  return text.split(URL_RE).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function time(ts: number) {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function firstImage(list: DataTransferItemList | FileList | null | undefined): File | null {
  if (!list) return null;
  for (const item of Array.from(list as ArrayLike<DataTransferItem | File>)) {
    const file = item instanceof File ? item : item.kind === 'file' ? item.getAsFile() : null;
    if (file && file.type.startsWith('image/')) return file;
  }
  return null;
}

export function Chat({ onClose }: { onClose: () => void }) {
  const messages = useStore(call.store, (s) => s.messages);
  const selfId = useStore(call.store, (s) => s.selfId);
  const peers = useStore(call.store, (s) => s.peers);
  const myAvatar = useStore(settings, (s) => s.avatar);
  const [text, setText] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    call.setChatVisible(true);
    input.current?.focus();
    return () => call.setChatVisible(false);
  }, []);

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const attach = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    try {
      setImage(await prepareChatImage(file));
      input.current?.focus();
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const send = () => {
    if (!text.trim() && !image) return;
    call.sendChat(text, image);
    setText('');
    setImage(null);
    setProblem(null);
  };

  const avatarOf = (m: ChatMessage) => (m.from === selfId ? myAvatar : (peers[m.from]?.avatar ?? null));

  return (
    <aside
      className="animate-fade absolute inset-y-0 right-0 z-30 flex w-full shrink-0 flex-col border-l border-line bg-panel shadow-soft sm:w-80 lg:static lg:shadow-none"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void attach(firstImage(e.dataTransfer.files));
      }}
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
        <span className="font-bold">Chat da sala</span>
        <IconButton label="Fechar chat" onClick={onClose} className="size-8">
          <X size={16} />
        </IconButton>
      </div>

      <div ref={list} className="selectable relative min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && <p className="mt-10 text-center text-sm text-faint">Nenhuma mensagem ainda. Diga oi! 👋</p>}
        {messages.map((m, i) => (
          <Message
            key={m.id}
            msg={m}
            avatar={avatarOf(m)}
            mine={m.from === selfId}
            grouped={isGrouped(messages[i - 1], m)}
            onZoom={setZoom}
            onLoad={() => {
              const el = list.current;
              if (el && i === messages.length - 1) el.scrollTop = el.scrollHeight;
            }}
          />
        ))}
      </div>

      <div className="border-t border-line p-3">
        {(image || busy) && (
          <div className="relative mb-2 inline-block">
            {image ? (
              <img src={image} alt="Imagem pra enviar" className="max-h-32 rounded-xl border border-line" />
            ) : (
              <div className="grid size-20 place-items-center rounded-xl border border-line bg-panel-2 text-muted">
                <Loader2 size={18} className="animate-spin" />
              </div>
            )}
            {image && (
              <button
                onClick={() => setImage(null)}
                title="Remover imagem"
                className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-danger text-white shadow"
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}
        {problem && <div className="mb-2 rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium text-danger">{problem}</div>}
        <div className="flex items-end gap-1.5 rounded-2xl border border-line bg-panel-2 p-1.5 focus-within:border-accent">
          <button
            onClick={async () => attach(await pickImageFile())}
            title="Enviar imagem (ou cole com Ctrl+V / arraste aqui)"
            className="grid size-9 shrink-0 place-items-center rounded-xl text-muted transition hover:bg-hover hover:text-fg"
          >
            <ImagePlus size={18} />
          </button>
          <textarea
            ref={input}
            rows={1}
            value={text}
            maxLength={2000}
            placeholder={image ? 'Legenda (opcional)' : 'Mensagem'}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const file = firstImage(e.clipboardData.items);
              if (file) {
                e.preventDefault();
                void attach(file);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-1.5 py-2 text-sm text-fg outline-none placeholder:text-faint"
          />
          <button
            onClick={send}
            disabled={(!text.trim() && !image) || busy}
            title="Enviar (Enter)"
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-white transition hover:brightness-110 disabled:opacity-30"
          >
            <SendHorizontal size={16} />
          </button>
        </div>
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-accent-soft/90 text-sm font-semibold text-accent">
          Solte a imagem pra enviar
        </div>
      )}

      {zoom && (
        <div className="animate-fade fixed inset-0 z-50 grid cursor-zoom-out place-items-center bg-black/85 p-6" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
        </div>
      )}
    </aside>
  );
}

function isGrouped(prev: ChatMessage | undefined, m: ChatMessage) {
  return !!prev && prev.from === m.from && m.ts - prev.ts < GROUP_MS;
}

function Message({
  msg,
  avatar,
  mine,
  grouped,
  onZoom,
  onLoad,
}: {
  msg: ChatMessage;
  avatar: string | null;
  mine: boolean;
  grouped: boolean;
  onZoom: (src: string) => void;
  onLoad: () => void;
}) {
  return (
    <div className={cx('flex gap-2.5 rounded-lg px-1.5 hover:bg-hover/50', grouped ? 'py-0.5' : 'mt-3 py-1')}>
      <div className="w-8 shrink-0">{!grouped && <Avatar name={msg.name} src={avatar} size={32} />}</div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className={cx('text-sm font-semibold', mine && 'text-accent')}>{msg.name}</span>
            <span className="text-[11px] text-faint">{time(msg.ts)}</span>
          </div>
        )}
        {msg.text && <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-fg/90">{linkify(msg.text)}</p>}
        {msg.image && (
          <button onClick={() => onZoom(msg.image!)} className="mt-1 block cursor-zoom-in" title="Ampliar">
            <img src={msg.image} alt="Imagem enviada" onLoad={onLoad} className="max-h-60 max-w-full rounded-xl border border-line object-contain" />
          </button>
        )}
        {msg.expired && (
          <span className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-panel-2 px-2.5 py-1.5 text-xs text-faint">
            <ImageOff size={13} /> Imagem antiga (não está mais disponível)
          </span>
        )}
      </div>
    </div>
  );
}
