import { useEffect, useState } from 'react';
import { AppWindow, Gamepad2, Loader2, Monitor, MonitorUp, Type, Volume2 } from 'lucide-react';
import type { ScreenSource } from '../global';
import { call, videoBitrateKbps, type Resolution, type ScreenOptions } from '../lib/call';
import { Button, Modal, Segmented, Toggle, cx } from './ui';

const RES_LABEL: Record<Resolution, string> = {
  '720': '720p',
  '1080': '1080p',
  '1440': '1440p',
  '2160': '4K',
  native: 'Original',
};
const RES_SIZE: Record<Exclude<Resolution, 'native'>, [number, number]> = {
  '720': [1280, 720],
  '1080': [1920, 1080],
  '1440': [2560, 1440],
  '2160': [3840, 2160],
};

const PREF_KEY = 'discordia.screen';

function loadPrefs(): Omit<ScreenOptions, 'sourceId'> {
  try {
    return { resolution: '1080', fps: 60, mode: 'motion', audio: false, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') };
  } catch {
    return { resolution: '1080', fps: 60, mode: 'motion', audio: false };
  }
}

export function ScreenPicker({ onClose }: { onClose: () => void }) {
  const desktop = window.discordia;
  const [sources, setSources] = useState<ScreenSource[] | null>(desktop ? null : []);
  const [tab, setTab] = useState<'screen' | 'window'>('screen');
  const [selected, setSelected] = useState<string | null>(null);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [systemAudio, setSystemAudio] = useState(!desktop);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    // Telas e janelas chegam separadas: as telas (rápidas) aparecem na hora.
    const loadKind = async (kind: 'screen' | 'window') => {
      try {
        const list = await desktop.getScreenSources(kind);
        if (!alive) return;
        setSources((cur) => [...(cur ?? []).filter((s) => s.kind !== kind), ...list]);
        if (kind === 'screen') {
          setListError(null);
          setSelected((cur) => cur ?? list[0]?.id ?? null);
        }
      } catch {
        if (!alive) return;
        setSources((cur) => cur ?? []);
        if (kind === 'screen') {
          setListError('Não consegui listar as telas. No macOS, libere “Gravação de Tela” pro Discordia nas Configurações do Sistema.');
        }
      }
    };
    const load = () => {
      void loadKind('screen');
      void loadKind('window');
    };
    void load();
    void desktop.info().then((i) => alive && setSystemAudio(i.systemAudio));
    // Miniaturas "ao vivo": atualiza a cada 3 s enquanto o seletor está aberto.
    const id = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [desktop]);

  const update = (patch: Partial<typeof prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    localStorage.setItem(PREF_KEY, JSON.stringify(next));
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await call.startScreen({ ...prefs, audio: prefs.audio && systemAudio, sourceId: selected });
      onClose();
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name !== 'NotAllowedError' && name !== 'AbortError') setError('Não foi possível capturar essa tela.');
      else if (!desktop) onClose();
      setBusy(false);
    }
  };

  const shown = (sources ?? []).filter((s) => s.kind === tab);
  const [w, h] = prefs.resolution === 'native' ? [2560, 1440] : RES_SIZE[prefs.resolution];
  const mbps = (videoBitrateKbps(w, h, prefs.fps, prefs.mode) / 1000).toFixed(prefs.resolution === '720' ? 1 : 0);

  return (
    <Modal title="Compartilhar tela" onClose={onClose} wide={!!desktop}>
      {desktop && (
        <div className="border-b border-line px-6 pt-4 pb-5">
          <div className="mb-4 w-72">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'screen', label: <><Monitor size={15} /> Telas</> },
                { value: 'window', label: <><AppWindow size={15} /> Janelas</> },
              ]}
            />
          </div>
          {sources === null ? (
            <div className="grid h-52 place-items-center text-muted">
              <Loader2 className="animate-spin" />
            </div>
          ) : (
            <div className="grid max-h-[42vh] grid-cols-3 gap-3 overflow-y-auto pr-1">
              {shown.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  onDoubleClick={() => {
                    setSelected(s.id);
                    void start();
                  }}
                  className={cx(
                    'overflow-hidden rounded-xl border-2 bg-panel-2 text-left transition-all',
                    selected === s.id ? 'border-accent shadow-[0_0_0_4px_var(--accent-soft)]' : 'border-transparent hover:border-line',
                  )}
                >
                  <div className="aspect-video bg-black">
                    {s.thumbnail && <img src={s.thumbnail} alt="" className="size-full object-contain" draggable={false} />}
                  </div>
                  <div className="flex items-center gap-2 px-2.5 py-2">
                    {s.icon && <img src={s.icon} alt="" className="size-4" />}
                    <span className="truncate text-xs font-medium">{s.name}</span>
                  </div>
                </button>
              ))}
              {shown.length === 0 && (
                <p className="col-span-3 py-10 text-center text-sm text-muted">{listError ?? 'Nada pra mostrar aqui.'}</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-5 px-6 py-5">
        <div className="col-span-2">
          <div className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Resolução</div>
          <Segmented
            value={prefs.resolution}
            onChange={(resolution) => update({ resolution })}
            options={(['720', '1080', '1440', '2160', 'native'] as Resolution[]).map((r) => ({ value: r, label: RES_LABEL[r] }))}
          />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Quadros por segundo</div>
          <Segmented
            value={prefs.fps}
            onChange={(fps) => update({ fps })}
            options={[
              { value: 15, label: '15' },
              { value: 30, label: '30' },
              { value: 60, label: '60' },
            ]}
          />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Otimizar para</div>
          <Segmented
            value={prefs.mode}
            onChange={(mode) => update({ mode })}
            options={[
              { value: 'motion', label: <><Gamepad2 size={15} /> Movimento</> },
              { value: 'detail', label: <><Type size={15} /> Texto</> },
            ]}
          />
        </div>
        <div className="col-span-2 flex items-center justify-between gap-4 rounded-xl border border-line bg-panel-2 px-4 py-2.5">
          <span>
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <Volume2 size={15} /> Áudio do computador
            </span>
            <span className="block text-xs text-muted">
              {systemAudio ? 'Jogo, vídeo, música… (use fone de ouvido)' : 'Disponível só no Windows'}
            </span>
          </span>
          <Toggle checked={prefs.audio && systemAudio} disabled={!systemAudio} onChange={(audio) => update({ audio })} />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-line bg-panel-2/50 px-6 py-4">
        <span className="text-xs text-muted">
          Até ~{mbps} Mb/s por amigo. {prefs.resolution === '2160' && 'Precisa de internet boa de upload.'}
          {error && <span className="ml-2 font-medium text-danger">{error}</span>}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={start} disabled={busy || (!!desktop && !selected)}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <MonitorUp size={16} />}
            Transmitir
          </Button>
        </div>
      </div>
    </Modal>
  );
}
