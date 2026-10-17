import { useState } from 'react';
import { ArrowRight, AudioLines, Clock, Dices, MonitorUp, Server, ShieldCheck, Sparkles } from 'lucide-react';
import { call } from '../lib/call';
import { clearRoomLink, isWeb, rememberRoom, roomFromLink, settings } from '../lib/settings';
import { useStore } from '../lib/store';
import { Button, Field, Segmented, TextInput } from './ui';

const ADJ = ['azul', 'veloz', 'feliz', 'bravo', 'sereno', 'dourado', 'noturno', 'selvagem', 'ruivo', 'astuto'];
const NOUN = ['lobo', 'corvo', 'tigre', 'raposa', 'falcao', 'urso', 'dragao', 'panda', 'lince', 'polvo'];

function randomRoom() {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;
  return `${pick(NOUN)}-${pick(ADJ)}-${Math.floor(10 + Math.random() * 90)}`;
}

function cleanRoom(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 32);
}

export function Home({ onSettings }: { onSettings: () => void }) {
  const name = useStore(settings, (s) => s.name);
  const serverUrl = useStore(settings, (s) => s.serverUrl);
  const recent = useStore(settings, (s) => s.recentRooms);
  const error = useStore(call.store, (s) => s.error);
  const status = useStore(call.store, (s) => s.status);
  const [linkRoom] = useState(roomFromLink);
  const [mode, setMode] = useState<'create' | 'join'>(linkRoom ? 'join' : 'create');
  const [code, setCode] = useState(linkRoom);
  const [newRoom, setNewRoom] = useState(randomRoom);

  const room = mode === 'create' ? cleanRoom(newRoom) : cleanRoom(code);
  const canGo = name.trim().length > 0 && room.length > 0 && status === 'idle';

  const go = (target = room) => {
    if (!name.trim() || !target) return;
    rememberRoom(target);
    clearRoomLink();
    void call.join(settings.get().serverUrl, target, name.trim());
  };

  return (
    <div className="bg-grid relative flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-8">
      <div className="pointer-events-none absolute -top-40 left-1/2 size-[640px] -translate-x-1/2 rounded-full bg-accent/20 blur-[120px]" />

      <div className="relative grid w-full max-w-5xl items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
        <section className="hidden lg:block">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1 text-xs font-semibold text-muted">
            <Sparkles size={13} className="text-accent" /> Ponto a ponto, sem anúncio, sem cadastro
          </span>
          <h1 className="mt-5 text-5xl leading-[1.05] font-extrabold tracking-tight">
            Chama a galera.
            <br />
            <span className="bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-transparent">Mostra a tela.</span>
          </h1>
          <p className="mt-5 max-w-md text-lg text-muted">
            Voz cristalina e compartilhamento de tela em até 4K a 60 fps, direto de um PC pro outro.
          </p>
          <ul className="mt-8 space-y-3 text-sm">
            <Feature icon={<AudioLines size={18} />} title="Áudio Opus 48 kHz" text="Até 256 kbps em estéreo, com modo alta fidelidade pra música." />
            <Feature icon={<MonitorUp size={18} />} title="Tela em alta resolução" text="720p a 4K, 30 ou 60 fps, com codec de hardware (AV1, VP9, H.264)." />
            <Feature icon={<ShieldCheck size={18} />} title="Direto entre vocês" text="A mídia vai criptografada (DTLS-SRTP) de um amigo pro outro." />
          </ul>
        </section>

        <section className="animate-pop rounded-3xl border border-line bg-panel p-7 shadow-soft">
          <h2 className="text-xl font-bold">{linkRoom ? 'Você foi convidado!' : 'Entrar numa sala'}</h2>
          <p className="mt-1 text-sm text-muted">
            {linkRoom ? (
              <>
                Sala <span className="font-semibold text-fg">{linkRoom}</span>. Digite seu nome e entre.
              </>
            ) : (
              'Crie uma sala e mande o link pros amigos.'
            )}
          </p>

          <div className="mt-6 space-y-5">
            <Field label="Seu nome">
              <TextInput
                autoFocus={!name}
                value={name}
                maxLength={32}
                placeholder="Como os amigos te veem"
                onChange={(e) => settings.set({ name: e.target.value })}
              />
            </Field>

            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'create', label: 'Criar sala' },
                { value: 'join', label: 'Tenho um código' },
              ]}
            />

            {mode === 'create' ? (
              <Field label="Nome da sala" hint="Esse é o código que seus amigos vão digitar.">
                <div className="flex gap-2">
                  <TextInput value={newRoom} maxLength={32} onChange={(e) => setNewRoom(e.target.value)} />
                  <Button variant="secondary" onClick={() => setNewRoom(randomRoom())} title="Sortear outro" className="w-11 shrink-0 px-0">
                    <Dices size={18} />
                  </Button>
                </div>
              </Field>
            ) : (
              <Field label="Código da sala">
                <TextInput
                  autoFocus
                  value={code}
                  placeholder="ex: lobo-azul-42"
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && canGo && go()}
                />
              </Field>
            )}

            {error && <div className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">{error}</div>}

            <Button variant="primary" className="h-12 w-full text-base" disabled={!canGo} onClick={() => go()}>
              {status === 'connecting' ? 'Conectando…' : mode === 'create' ? 'Criar e entrar' : 'Entrar'}
              <ArrowRight size={18} />
            </Button>
          </div>

          {recent.length > 0 && (
            <div className="mt-6 border-t border-line pt-5">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
                <Clock size={13} /> Recentes
              </div>
              <div className="flex flex-wrap gap-2">
                {recent.map((r) => (
                  <button
                    key={r}
                    disabled={!name.trim() || status !== 'idle'}
                    onClick={() => go(r)}
                    className="rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!isWeb && <button
            onClick={onSettings}
            className="mt-5 flex w-full items-center gap-2 truncate text-xs text-faint transition-colors hover:text-muted"
            title="Trocar servidor"
          >
            <Server size={13} className="shrink-0" />
            <span className="truncate">{serverUrl}</span>
          </button>}
        </section>
      </div>
    </div>
  );
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">{icon}</span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="text-muted">{text}</span>
      </span>
    </li>
  );
}
