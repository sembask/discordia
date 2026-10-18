import { useEffect, useRef, useState } from 'react';
import { Camera, Headphones, Mic, Settings2, Trash2, Volume2 } from 'lucide-react';
import { audio } from '../lib/audio';
import { call } from '../lib/call';
import { pickImageFile, prepareAvatar } from '../lib/image';
import { settings } from '../lib/settings';
import { useStore } from '../lib/store';
import { useDevices } from './SettingsModal';
import { Avatar, Button, Popover, Select, Slider, TextInput, Toggle } from './ui';

/** Medidor ao vivo da minha voz (já com o volume aplicado). */
function LiveMicMeter() {
  const [level, setLevel] = useState(0);
  const muted = useStore(call.store, (s) => s.muted);
  const raf = useRef(0);
  useEffect(() => {
    const tick = () => {
      setLevel(audio.micLevel());
      raf.current = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf.current);
  }, []);
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
      <div
        className={muted ? 'h-full rounded-full bg-faint' : 'h-full rounded-full bg-gradient-to-r from-success to-accent'}
        style={{ width: `${Math.round(level * 100)}%`, transition: 'width 60ms linear' }}
      />
    </div>
  );
}

/** Ajustes rápidos de voz, abertos pelo painel do usuário (canto inferior). */
export function VoicePopover({ onClose, onMore }: { onClose: () => void; onMore: () => void }) {
  const s = useStore(settings, (x) => x);
  const inputs = useDevices('audioinput');
  const outputs = useDevices('audiooutput');
  const reopenMic = (patch: Partial<typeof s>) => {
    settings.set(patch);
    void call.acquireMic();
  };
  return (
    <Popover onClose={onClose} className="absolute bottom-full left-2 mb-2 w-[300px] space-y-4">
      <div className="text-sm font-bold">Voz</div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
          <Mic size={13} /> Microfone
        </div>
        <Select value={s.inputDeviceId} options={inputs} onChange={(v) => reopenMic({ inputDeviceId: v })} />
      </div>
      <Slider label="Volume da minha voz" icon={<Mic size={13} />} value={s.micGain} onChange={(v) => call.setMicGain(v)} />
      <LiveMicMeter />

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
          <Headphones size={13} /> Saída
        </div>
        <Select
          value={s.outputDeviceId}
          options={outputs}
          onChange={(v) => {
            settings.set({ outputDeviceId: v });
            void audio.setOutputDevice(v);
          }}
        />
      </div>
      <Slider label="Volume do que eu ouço" icon={<Volume2 size={13} />} value={s.outputVolume} onChange={(v) => call.setOutputVolume(v)} />

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Supressão de ruído</span>
        <Toggle checked={s.noiseSuppression && !s.hifi} disabled={s.hifi} onChange={(v) => reopenMic({ noiseSuppression: v })} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Alta fidelidade (música)</span>
        <Toggle checked={s.hifi} onChange={(v) => reopenMic({ hifi: v })} />
      </div>

      <button
        onClick={() => {
          onClose();
          onMore();
        }}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-line py-2 text-xs font-semibold text-muted transition-colors hover:bg-hover hover:text-fg"
      >
        <Settings2 size={13} /> Todas as configurações
      </button>
    </Popover>
  );
}

/** Editar meu nome e foto (no meio da sala também). */
export function ProfilePopover({ onClose }: { onClose: () => void }) {
  const saved = useStore(settings, (s) => s);
  const [name, setName] = useState(saved.name);
  const [avatar, setAvatar] = useState(saved.avatar);
  const [error, setError] = useState<string | null>(null);

  const choose = async () => {
    const file = await pickImageFile();
    if (!file) return;
    try {
      setAvatar(await prepareAvatar(file));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const save = () => {
    const clean = name.trim() || saved.name;
    settings.set({ name: clean, avatar });
    call.updateProfile(clean, avatar);
    onClose();
  };

  return (
    <Popover onClose={onClose} className="absolute bottom-full left-2 mb-2 w-[300px] space-y-4">
      <div className="text-sm font-bold">Seu perfil</div>
      <div className="flex items-center gap-4">
        <button onClick={choose} className="group relative shrink-0 rounded-full" title="Trocar foto">
          <Avatar name={name || '?'} src={avatar} size={72} />
          <span className="absolute inset-0 grid place-items-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
            <Camera size={22} />
          </span>
        </button>
        <div className="flex flex-col gap-2">
          <Button variant="secondary" className="h-9 px-3 text-xs" onClick={choose}>
            <Camera size={14} /> Trocar foto
          </Button>
          {avatar && (
            <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => setAvatar(null)}>
              <Trash2 size={14} /> Remover
            </Button>
          )}
        </div>
      </div>
      {error && <div className="rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium text-danger">{error}</div>}
      <TextInput value={name} maxLength={32} placeholder="Seu nome" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      <Button variant="primary" className="w-full" onClick={save}>
        Salvar
      </Button>
    </Popover>
  );
}
