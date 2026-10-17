import { useEffect, useRef, useState } from 'react';
import { AudioLines, Monitor, Moon, Palette, Server, Sun, Video } from 'lucide-react';
import { call } from '../lib/call';
import { isWeb, settings, type Settings } from '../lib/settings';
import { useStore } from '../lib/store';
import { audio } from '../lib/audio';
import { Field, Modal, Segmented, Select, TextInput, Toggle, cx } from './ui';

type Tab = 'appearance' | 'voice' | 'video' | 'server';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'appearance', label: 'Aparência', icon: <Palette size={16} /> },
  { id: 'voice', label: 'Voz e áudio', icon: <AudioLines size={16} /> },
  { id: 'video', label: 'Vídeo', icon: <Video size={16} /> },
  { id: 'server', label: 'Servidor', icon: <Server size={16} /> },
];

/** Mudou algo que afeta o microfone: reabre ele na chamada em andamento. */
function setVoice(patch: Partial<Settings>) {
  settings.set(patch);
  if (call.store.get().status !== 'idle') void call.acquireMic();
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('appearance');
  return (
    <Modal title="Configurações" onClose={onClose} wide>
      <div className="flex min-h-[460px] flex-col sm:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-3 sm:w-52 sm:flex-col sm:border-r sm:border-b-0">
          {TABS.filter((t) => !(isWeb && t.id === 'server')).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                'flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors sm:w-full',
                tab === t.id ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-fg',
              )}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 space-y-6 p-4 sm:p-6">
          {tab === 'appearance' && <Appearance />}
          {tab === 'voice' && <Voice />}
          {tab === 'video' && <VideoTab />}
          {tab === 'server' && <ServerTab />}
        </div>
      </div>
    </Modal>
  );
}

function Row({ title, text, children }: { title: string; text?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div>
        <div className="text-sm font-semibold">{title}</div>
        {text && <div className="text-xs text-muted">{text}</div>}
      </div>
      {children}
    </div>
  );
}

function Appearance() {
  const theme = useStore(settings, (s) => s.theme);
  const sounds = useStore(settings, (s) => s.sounds);
  return (
    <>
      <div>
        <div className="mb-3 text-sm font-semibold">Tema</div>
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              { id: 'light', label: 'Claro', icon: <Sun size={16} /> },
              { id: 'dark', label: 'Escuro', icon: <Moon size={16} /> },
              { id: 'system', label: 'Do sistema', icon: <Monitor size={16} /> },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => settings.set({ theme: t.id })}
              className={cx(
                'overflow-hidden rounded-2xl border-2 text-left transition-all',
                theme === t.id ? 'border-accent shadow-[0_0_0_4px_var(--accent-soft)]' : 'border-line hover:border-faint',
              )}
            >
              <ThemePreview kind={t.id} />
              <div className="flex items-center gap-2 px-3 py-2.5 text-sm font-semibold">
                {t.icon} {t.label}
              </div>
            </button>
          ))}
        </div>
      </div>
      <Row title="Sons de entrada e saída" text="Um toque curto quando alguém entra, sai ou manda mensagem.">
        <Toggle checked={sounds} onChange={(v) => settings.set({ sounds: v })} />
      </Row>
    </>
  );
}

function ThemePreview({ kind }: { kind: 'light' | 'dark' | 'system' }) {
  const half = (dark: boolean) => (
    <div className={cx('flex h-full flex-1 gap-1.5 p-2', dark ? 'bg-[#0b0c10]' : 'bg-[#f4f5f9]')}>
      <div className={cx('w-1/4 rounded-md', dark ? 'bg-[#181b22]' : 'bg-white')} />
      <div className="flex flex-1 flex-col gap-1.5">
        <div className={cx('flex-1 rounded-md', dark ? 'bg-[#121419]' : 'bg-[#e9ebf3]')} />
        <div className="h-2 w-1/2 self-center rounded-full bg-[#6656f5]" />
      </div>
    </div>
  );
  return (
    <div className="flex h-24">
      {kind === 'system' ? (
        <>
          {half(false)}
          {half(true)}
        </>
      ) : (
        half(kind === 'dark')
      )}
    </div>
  );
}

function useDevices(kind: MediaDeviceKind) {
  const [list, setList] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    const load = async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const items = devices
        .filter((d) => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d, i) => ({ value: d.deviceId, label: d.label || `Dispositivo ${i + 1}` }));
      setList([{ value: 'default', label: 'Padrão do sistema' }, ...items]);
    };
    void load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => navigator.mediaDevices.removeEventListener('devicechange', load);
  }, [kind]);
  return list;
}

function MicMeter() {
  const [level, setLevel] = useState(0);
  const deviceId = useStore(settings, (s) => s.inputDeviceId);
  const raf = useRef(0);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let alive = true;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId !== 'default' ? { deviceId: { exact: deviceId } } : true,
        });
        if (!alive) return;
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += v * v;
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6));
          raf.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setLevel(0);
      }
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf.current);
      for (const t of stream?.getTracks() ?? []) t.stop();
      void ctx?.close();
    };
  }, [deviceId]);
  return (
    <div className="h-2 overflow-hidden rounded-full bg-panel-2">
      <div
        className="h-full rounded-full bg-gradient-to-r from-success to-accent transition-[width] duration-75"
        style={{ width: `${Math.round(level * 100)}%` }}
      />
    </div>
  );
}

function Voice() {
  const s = useStore(settings, (x) => x);
  const inputs = useDevices('audioinput');
  const outputs = useDevices('audiooutput');
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Microfone">
          <Select value={s.inputDeviceId} options={inputs} onChange={(v) => setVoice({ inputDeviceId: v })} />
        </Field>
        <Field label="Saída (fone/caixa)">
          <Select
            value={s.outputDeviceId}
            options={outputs}
            onChange={(v) => {
              settings.set({ outputDeviceId: v });
              void audio.setOutputDevice(v);
            }}
          />
        </Field>
      </div>
      <Field label="Teste do microfone" hint="Fale algo: a barra deve se mexer.">
        <MicMeter />
      </Field>
      <div className="space-y-4 rounded-2xl border border-line p-4">
        <Row
          title="Modo alta fidelidade"
          text="Estéreo, sem filtros e até 256 kbps. Ideal pra música e instrumento — exige fone de ouvido."
        >
          <Toggle checked={s.hifi} onChange={(v) => setVoice({ hifi: v })} />
        </Row>
        <div className={cx('space-y-4', s.hifi && 'pointer-events-none opacity-40')}>
          <Row title="Supressão de ruído" text="Corta ventilador, teclado e barulho de fundo.">
            <Toggle checked={s.noiseSuppression} onChange={(v) => setVoice({ noiseSuppression: v })} />
          </Row>
          <Row title="Cancelamento de eco" text="Evita que os amigos se ouçam pela sua caixa de som.">
            <Toggle checked={s.echoCancellation} onChange={(v) => setVoice({ echoCancellation: v })} />
          </Row>
          <Row title="Ganho automático" text="Nivela o volume da sua voz.">
            <Toggle checked={s.autoGainControl} onChange={(v) => setVoice({ autoGainControl: v })} />
          </Row>
        </div>
      </div>
    </>
  );
}

function VideoTab() {
  const codec = useStore(settings, (s) => s.codec);
  return (
    <>
      <Field
        label="Codec de vídeo da tela"
        hint="Automático escolhe o melhor que sua placa de vídeo codifica em hardware (AV1 → VP9 → H.264). Vale na próxima vez que você compartilhar."
      >
        <Segmented
          value={codec}
          onChange={(v) => settings.set({ codec: v })}
          options={[
            { value: 'auto', label: 'Automático' },
            { value: 'av1', label: 'AV1' },
            { value: 'vp9', label: 'VP9' },
            { value: 'h264', label: 'H.264' },
          ]}
        />
      </Field>
      <div className="rounded-2xl border border-line bg-panel-2 p-4 text-sm text-muted">
        <p className="font-semibold text-fg">Dicas pra tela ficar perfeita</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Use “Texto nítido” pra código e documentos; “Movimento” pra jogos e vídeos.</li>
          <li>Cada amigo assistindo recebe uma cópia: 4 amigos em 1080p60 ≈ 35 Mb/s de upload.</li>
          <li>Passe o mouse sobre a tela pra ver resolução, fps, bitrate e codec ao vivo.</li>
        </ul>
      </div>
    </>
  );
}

function ServerTab() {
  const serverUrl = useStore(settings, (s) => s.serverUrl);
  const [draft, setDraft] = useState(serverUrl);
  const [check, setCheck] = useState<'idle' | 'ok' | 'fail' | 'testing'>('idle');

  const test = () => {
    setCheck('testing');
    try {
      const ws = new WebSocket(draft);
      const timer = setTimeout(() => {
        ws.close();
        setCheck('fail');
      }, 4000);
      ws.onopen = () => {
        clearTimeout(timer);
        ws.close();
        setCheck('ok');
      };
      ws.onerror = () => {
        clearTimeout(timer);
        setCheck('fail');
      };
    } catch {
      setCheck('fail');
    }
  };

  return (
    <>
      <Field
        label="Endereço do servidor"
        hint="Todo mundo da sala precisa usar o mesmo servidor. Ex.: wss://discordia.seudominio.com"
      >
        <div className="flex gap-2">
          <TextInput value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
          <button
            onClick={test}
            className="h-11 shrink-0 rounded-xl border border-line bg-panel-2 px-4 text-sm font-semibold hover:bg-hover"
          >
            Testar
          </button>
        </div>
      </Field>
      {check !== 'idle' && (
        <div
          className={cx(
            'rounded-xl px-4 py-2.5 text-sm font-medium',
            check === 'ok' ? 'bg-success/15 text-success' : check === 'fail' ? 'bg-danger-soft text-danger' : 'bg-panel-2 text-muted',
          )}
        >
          {check === 'ok' ? 'Servidor respondeu!' : check === 'fail' ? 'Não respondeu. Confira o endereço.' : 'Testando…'}
        </div>
      )}
      <button
        disabled={draft === serverUrl}
        onClick={() => settings.set({ serverUrl: draft.trim() })}
        className="h-10 rounded-xl bg-accent px-5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
      >
        Salvar
      </button>
      {call.store.get().status !== 'idle' && <p className="text-xs text-faint">O novo servidor vale na próxima vez que você entrar numa sala.</p>}
    </>
  );
}
