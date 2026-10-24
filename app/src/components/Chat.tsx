import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { ImageOff, Loader2, Paperclip, SendHorizontal, X } from 'lucide-react';
import { call, UploadError, type ChatMessage } from '../lib/call';
import { pickFiles, prepareChatImage } from '../lib/image';
import { FileCard, UploadRow, type PendingUpload } from './FileCard';
import { music } from '../lib/music';
import { settings } from '../lib/settings';
import { useStore } from '../lib/store';
import { Avatar, cx } from './ui';

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

function filesOf(list: DataTransferItemList | FileList | null | undefined): File[] {
  if (!list) return [];
  const out: File[] = [];
  for (const item of Array.from(list as ArrayLike<DataTransferItem | File>)) {
    const file = item instanceof File ? item : item.kind === 'file' ? item.getAsFile() : null;
    if (file) out.push(file);
  }
  return out;
}

/** Imagens comuns vão comprimidas direto no chat; o resto vira arquivo. */
const INLINE_IMAGE = /^image\/(png|jpeg|webp|gif|avif|bmp)$/;
let uploadSeq = 0;

export function Chat() {
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
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
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

  const patchUpload = (key: number, patch: Partial<PendingUpload>) =>
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...patch } : u)));

  /** Sobe o arquivo e, quando termina, ele aparece no chat pra todo mundo. */
  const uploadFile = (file: File) => {
    const key = ++uploadSeq;
    const job = call.uploadFile(file, (progress) => patchUpload(key, { progress }));
    setUploads((list) => [...list, { key, name: file.name, size: file.size, progress: 0, error: null, abort: job.abort }]);
    job.promise.then(
      (sent) => {
        call.sendChat('', null, sent.id);
        setUploads((list) => list.filter((u) => u.key !== key));
      },
      (err: Error) => {
        if (err instanceof UploadError && err.message === 'cancelado') {
          setUploads((list) => list.filter((u) => u.key !== key));
        } else {
          patchUpload(key, { error: err.message });
        }
      },
    );
  };

  const attachImage = async (file: File) => {
    setBusy(true);
    setProblem(null);
    try {
      setImage(await prepareChatImage(file));
      input.current?.focus();
    } catch {
      // Grande demais pra ir no chat (GIF enorme, por exemplo): vai como arquivo.
      uploadFile(file);
    } finally {
      setBusy(false);
    }
  };

  const attach = (files: File[]) => {
    let imageTaken = !!image || busy;
    for (const file of files) {
      if (!imageTaken && INLINE_IMAGE.test(file.type)) {
        imageTaken = true;
        void attachImage(file);
      } else {
        uploadFile(file);
      }
    }
  };

  const send = () => {
    if (!text.trim() && !image) return;
    if (!image && runCommand(text)) {
      setText('');
      return;
    }
    call.sendChat(text, image);
    setText('');
    setImage(null);
    setProblem(null);
  };

  const avatarOf = (m: ChatMessage) => (m.from === selfId ? myAvatar : (peers[m.from]?.avatar ?? null));

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
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
        attach(filesOf(e.dataTransfer.files));
      }}
    >
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
        {uploads.map((up) => (
          <UploadRow key={up.key} up={up} onDismiss={() => setUploads((list) => list.filter((u) => u.key !== up.key))} />
        ))}
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
            onClick={async () => attach(await pickFiles())}
            title={`Enviar imagem ou arquivo (ou cole com Ctrl+V / arraste aqui). Arquivos somem do servidor depois de ${Math.round((call.features.files?.ttlMs ?? 1_800_000) / 60_000)} min.`}
            aria-label="Anexar"
            className="grid size-9 shrink-0 place-items-center rounded-xl text-muted transition hover:bg-hover hover:text-fg"
          >
            <Paperclip size={18} />
          </button>
          <textarea
            ref={input}
            rows={1}
            value={text}
            maxLength={2000}
            placeholder={image ? 'Legenda (opcional)' : 'Mensagem ou /play link'}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const pasted = filesOf(e.clipboardData.items);
              if (pasted.length) {
                e.preventDefault();
                attach(pasted);
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
          Solte pra enviar (imagens e arquivos)
        </div>
      )}

      {zoom && (
        <div className="animate-fade fixed inset-0 z-50 grid cursor-zoom-out place-items-center bg-black/85 p-6" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
        </div>
      )}
    </div>
  );
}

function isGrouped(prev: ChatMessage | undefined, m: ChatMessage) {
  return !!prev && !prev.system && !m.system && prev.from === m.from && m.ts - prev.ts < GROUP_MS;
}

/** Comandos de música no chat. Devolve true se era um comando. */
function runCommand(raw: string): boolean {
  const text = raw.trim();
  if (!text.startsWith('/')) return false;
  const [cmd, ...rest] = text.slice(1).split(/\s+/);
  const arg = rest.join(' ');
  switch (cmd.toLowerCase()) {
    case 'play':
    case 'p':
    case 'tocar':
      if (arg) void music.add(arg);
      else music.op('play');
      return true;
    case 'next':
    case 'seguinte':
      if (arg) void music.add(arg, 'next');
      return true;
    case 'skip':
    case 's':
    case 'pular':
      music.op('skip');
      return true;
    case 'pause':
    case 'pausar':
      music.op('pause');
      return true;
    case 'resume':
    case 'continuar':
      music.op('play');
      return true;
    case 'stop':
    case 'parar':
      music.op('clear');
      return true;
    case 'shuffle':
    case 'embaralhar':
      music.op('shuffle');
      return true;
    case 'loop':
    case 'repetir':
      music.cycleLoop();
      return true;
    case 'volume':
    case 'vol': {
      const v = Number(arg);
      if (Number.isFinite(v)) settings.set({ musicVolume: Math.max(0, Math.min(100, Math.round(v))), musicMuted: false });
      return true;
    }
    default:
      return false;
  }
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
  if (msg.system) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-muted">
        <span className="min-w-0 flex-1 break-words">{msg.text}</span>
        <span className="shrink-0 text-[10px] text-faint">{time(msg.ts)}</span>
      </div>
    );
  }
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
        {msg.file && <FileCard file={msg.file} onZoom={onZoom} onLoad={onLoad} />}
        {msg.expired && (
          <span className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-panel-2 px-2.5 py-1.5 text-xs text-faint">
            <ImageOff size={13} /> Imagem antiga (não está mais disponível)
          </span>
        )}
      </div>
    </div>
  );
}
