import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { SendHorizontal, X } from 'lucide-react';
import { call, type ChatMessage } from '../lib/call';
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

export function Chat({ onClose }: { onClose: () => void }) {
  const messages = useStore(call.store, (s) => s.messages);
  const selfId = useStore(call.store, (s) => s.selfId);
  const [text, setText] = useState('');
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

  const send = () => {
    if (!text.trim()) return;
    call.sendChat(text);
    setText('');
  };

  return (
    <aside className="animate-fade absolute inset-y-0 right-0 z-30 flex w-full shrink-0 flex-col border-l border-line bg-panel shadow-soft sm:w-80 lg:static lg:shadow-none">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
        <span className="font-bold">Chat da sala</span>
        <IconButton label="Fechar chat" onClick={onClose} className="size-8">
          <X size={16} />
        </IconButton>
      </div>

      <div ref={list} className="selectable min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && <p className="mt-10 text-center text-sm text-faint">Nenhuma mensagem ainda. Diga oi! 👋</p>}
        {messages.map((m, i) => (
          <Message key={m.id} msg={m} mine={m.from === selfId} grouped={isGrouped(messages[i - 1], m)} />
        ))}
      </div>

      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-panel-2 p-1.5 focus-within:border-accent">
          <textarea
            ref={input}
            rows={1}
            value={text}
            maxLength={2000}
            placeholder="Mensagem"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2.5 py-2 text-sm text-fg outline-none placeholder:text-faint"
          />
          <button
            onClick={send}
            disabled={!text.trim()}
            title="Enviar (Enter)"
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-white transition hover:brightness-110 disabled:opacity-30"
          >
            <SendHorizontal size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function isGrouped(prev: ChatMessage | undefined, m: ChatMessage) {
  return !!prev && prev.from === m.from && m.ts - prev.ts < GROUP_MS;
}

function Message({ msg, mine, grouped }: { msg: ChatMessage; mine: boolean; grouped: boolean }) {
  return (
    <div className={cx('flex gap-2.5 rounded-lg px-1.5 hover:bg-hover/50', grouped ? 'py-0.5' : 'mt-3 py-1')}>
      <div className="w-8 shrink-0">{!grouped && <Avatar name={msg.name} size={32} />}</div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className={cx('text-sm font-semibold', mine && 'text-accent')}>{msg.name}</span>
            <span className="text-[11px] text-faint">{time(msg.ts)}</span>
          </div>
        )}
        <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-fg/90">{linkify(msg.text)}</p>
      </div>
    </div>
  );
}
