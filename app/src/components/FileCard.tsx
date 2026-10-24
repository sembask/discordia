import { useEffect, useState } from 'react';
import { Download, File as FileIcon, FileArchive, FileAudio, FileCode, FileText, FileVideo, Image as ImageIcon, Loader2, TimerOff, X } from 'lucide-react';
import { call, formatBytes, type ChatFile } from '../lib/call';
import { cx } from './ui';

/** Relógio do servidor, atualizado a cada `ms`. */
function useServerNow(ms: number) {
  const [now, setNow] = useState(() => call.serverNow());
  useEffect(() => {
    const t = window.setInterval(() => setNow(call.serverNow()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

function iconFor(name: string, mime: string) {
  if (mime.startsWith('image/')) return ImageIcon;
  if (mime.startsWith('video/')) return FileVideo;
  if (mime.startsWith('audio/')) return FileAudio;
  if (/\.(zip|rar|7z|tar|gz|bz2|xz)$/i.test(name)) return FileArchive;
  if (/\.(js|ts|tsx|jsx|py|gd|c|cpp|h|cs|java|rs|go|json|html|css|sh)$/i.test(name)) return FileCode;
  if (mime.startsWith('text/') || /\.(pdf|docx?|odt|md|txt)$/i.test(name)) return FileText;
  return FileIcon;
}

function remaining(ms: number) {
  const min = Math.ceil(ms / 60_000);
  if (min > 1) return `expira em ${min} min`;
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s > 59 ? 'expira em 1 min' : `expira em ${s} s`;
}

const PREVIEW_IMAGE = /^image\/(png|jpeg|gif|webp|avif)$/;
const PREVIEW_VIDEO = /^video\/(mp4|webm|ogg|quicktime)$/;
const PREVIEW_AUDIO = /^audio\//;

/** Arquivo enviado no chat: pré-visualização (imagem/vídeo/áudio) + baixar. */
export function FileCard({ file, onZoom, onLoad }: { file: ChatFile; onZoom: (src: string) => void; onLoad: () => void }) {
  const now = useServerNow(1000);
  const left = file.expiresAt - now;
  const expired = file.expired || left <= 0;
  const Icon = iconFor(file.name, file.mime);
  const src = call.fileUrl(file);

  if (expired) {
    return (
      <div className="mt-1 inline-flex max-w-full items-center gap-2 rounded-xl border border-line bg-panel-2 px-3 py-2 text-xs text-faint" data-file-expired>
        <TimerOff size={15} className="shrink-0" />
        <span className="min-w-0 truncate line-through">{file.name}</span>
        <span className="shrink-0">· o arquivo expirou</span>
      </div>
    );
  }

  return (
    <div className="mt-1 w-full max-w-sm overflow-hidden rounded-xl border border-line bg-panel-2" data-file={file.id}>
      {PREVIEW_IMAGE.test(file.mime) && (
        <button onClick={() => onZoom(src)} className="block w-full cursor-zoom-in bg-black/20" title="Ampliar">
          <img src={src} alt={file.name} onLoad={onLoad} className="mx-auto max-h-60 object-contain" />
        </button>
      )}
      {PREVIEW_VIDEO.test(file.mime) && (
        <video src={src} controls preload="metadata" onLoadedMetadata={onLoad} className="max-h-64 w-full bg-black" />
      )}
      {PREVIEW_AUDIO.test(file.mime) && <audio src={src} controls preload="none" className="w-full px-2 pt-2" />}
      <div className="flex items-center gap-2.5 px-3 py-2">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-fg" title={file.name}>
            {file.name}
          </div>
          <div className={cx('text-[11px]', left < 5 * 60_000 ? 'text-warning' : 'text-faint')}>
            {formatBytes(file.size)} · {remaining(left)}
          </div>
        </div>
        <a
          href={call.fileUrl(file, true)}
          download={file.name}
          target="_blank"
          rel="noreferrer"
          title="Baixar"
          className="grid size-9 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-hover hover:text-fg"
        >
          <Download size={17} />
        </a>
      </div>
    </div>
  );
}

export interface PendingUpload {
  key: number;
  name: string;
  size: number;
  progress: number;
  error: string | null;
  abort: () => void;
}

/** Envio em andamento (ou que falhou) logo acima da caixa de mensagem. */
export function UploadRow({ up, onDismiss }: { up: PendingUpload; onDismiss: () => void }) {
  return (
    <div className="mb-2 flex items-center gap-2.5 rounded-xl border border-line bg-panel-2 px-3 py-2" data-upload>
      {up.error ? (
        <FileIcon size={16} className="shrink-0 text-danger" />
      ) : (
        <Loader2 size={16} className="shrink-0 animate-spin text-accent" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{up.name}</span>
          <span className="shrink-0 text-[11px] text-faint">
            {up.error ? '' : `${Math.round(up.progress * 100)}% · `}
            {formatBytes(up.size)}
          </span>
        </div>
        {up.error ? (
          <div className="text-xs text-danger">{up.error}</div>
        ) : (
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${up.progress * 100}%` }} />
          </div>
        )}
      </div>
      <button
        onClick={() => (up.error ? onDismiss() : up.abort())}
        title={up.error ? 'Fechar' : 'Cancelar envio'}
        className="grid size-7 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-hover hover:text-fg"
      >
        <X size={14} />
      </button>
    </div>
  );
}
