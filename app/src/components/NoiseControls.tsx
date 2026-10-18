import { useEffect, useRef, useState } from 'react';
import { audio } from '../lib/audio';
import { call } from '../lib/call';
import { settings, type NoiseMode } from '../lib/settings';
import { useStore } from '../lib/store';
import { Select, Toggle, cx } from './ui';

const METER_MIN_DB = -80;
const METER_MAX_DB = 0;
const THRESHOLD_MIN_DB = -80;
const THRESHOLD_MAX_DB = -10;
const RANGE_MUTE = 100;

const MODES: { value: NoiseMode; label: string; hint: string }[] = [
  { value: 'off', label: 'Desligada', hint: 'Seu microfone como ele é.' },
  { value: 'browser', label: 'Padrão (navegador)', hint: 'Leve. Tira chiado e ruído constante.' },
  { value: 'rnnoise', label: 'IA · RNNoise', hint: 'Rede neural no seu PC. Tira teclado, ventilador e ruído de fundo.' },
  { value: 'gtcrn', label: 'IA · GTCRN (mais nova)', hint: 'Rede neural mais recente; voz mais natural com ruído forte. Usa um pouco mais de CPU.' },
];

const pct = (db: number) => `${((Math.min(METER_MAX_DB, Math.max(METER_MIN_DB, db)) - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB)) * 100}%`;

/** Lê o nível do microfone em dB: do portão (na chamada) ou de um teste próprio (fora dela). */
function useMicLevel() {
  const [state, setState] = useState({ levelDb: -100, thresholdDb: NaN, open: true, live: false });
  const deviceId = useStore(settings, (s) => s.inputDeviceId);
  useEffect(() => {
    let raf = 0;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    const buf = new Float32Array(1024);
    let smooth = -100;
    let alive = true;

    const tick = () => {
      const g = audio.gateState;
      if (g) {
        setState({ levelDb: g.levelDb, thresholdDb: g.thresholdDb, open: g.open, live: true });
      } else if (analyser) {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length);
        const db = rms > 1e-5 ? 20 * Math.log10(rms) : -100;
        smooth = db > smooth ? db : smooth + (db - smooth) * 0.2;
        setState({ levelDb: smooth, thresholdDb: NaN, open: true, live: false });
      }
      raf = requestAnimationFrame(tick);
    };

    // Fora da chamada não existe portão rodando: abre o mic só pra medir.
    if (!audio.gateState) {
      void navigator.mediaDevices
        .getUserMedia({ audio: deviceId !== 'default' ? { deviceId: { exact: deviceId } } : true })
        .then((s) => {
          if (!alive) {
            for (const t of s.getTracks()) t.stop();
            return;
          }
          stream = s;
          ctx = new AudioContext();
          analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          ctx.createMediaStreamSource(s).connect(analyser);
        })
        .catch(() => {});
    }
    tick();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      for (const t of stream?.getTracks() ?? []) t.stop();
      void ctx?.close();
    };
  }, [deviceId]);
  return state;
}

function GateMeter() {
  const s = useStore(settings, (x) => x);
  const live = useMicLevel();
  const threshold = s.gateAuto && Number.isFinite(live.thresholdDb) ? live.thresholdDb : s.gateThresholdDb;
  const passing = !s.gateEnabled || (live.live ? live.open : live.levelDb >= threshold);
  const dragging = useRef(false);

  return (
    <div>
      <div className="relative h-7">
        <div className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 overflow-hidden rounded-full bg-panel-2">
          {s.gateEnabled && <div className="absolute inset-y-0 left-0 bg-danger/15" style={{ width: pct(threshold) }} />}
          <div
            className={cx('absolute inset-y-0 left-0 rounded-full', passing ? 'bg-gradient-to-r from-success to-accent' : 'bg-faint')}
            style={{ width: pct(live.levelDb), transition: 'width 50ms linear' }}
          />
        </div>
        {s.gateEnabled && (
          <div className="pointer-events-none absolute top-0 bottom-0 w-0.5 -translate-x-1/2 rounded bg-fg" style={{ left: pct(threshold) }} />
        )}
        {s.gateEnabled && !s.gateAuto && (
          <input
            type="range"
            aria-label="Limite do portão em dB"
            min={METER_MIN_DB}
            max={METER_MAX_DB}
            step={1}
            value={s.gateThresholdDb}
            onPointerDown={() => (dragging.current = true)}
            onPointerUp={() => (dragging.current = false)}
            onChange={(e) => {
              const v = Math.min(THRESHOLD_MAX_DB, Math.max(THRESHOLD_MIN_DB, Number(e.target.value)));
              call.setGate({ gateThresholdDb: v });
            }}
            className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
          />
        )}
      </div>
      <div className="flex justify-between text-[10px] whitespace-nowrap text-faint tabular-nums">
        <span>{METER_MIN_DB} dB</span>
        <span>0 dB</span>
      </div>
      <div className={cx('mt-0.5 text-xs font-medium tabular-nums', passing ? 'text-success' : 'text-muted')}>
        Nível {Math.max(-99, Math.round(live.levelDb))} dB
        {s.gateEnabled && ` · limite ${Math.round(threshold)} dB${s.gateAuto ? ' (auto)' : ''}`}
        {s.gateEnabled && (passing ? ' · passando' : ' · cortando')}
      </div>
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span>
        <span className="block text-sm font-medium">{title}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

function DbSlider({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-xs font-semibold text-muted">
        <span>{label}</span>
        <span className="tabular-nums">{format(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
    </label>
  );
}

/** Supressão de ruído (modo) + portão de ruído em dB, com medidor ao vivo. */
export function NoiseControls({ compact }: { compact?: boolean }) {
  const s = useStore(settings, (x) => x);
  const mode = MODES.find((m) => m.value === s.noiseMode) ?? MODES[1];

  const setMode = (noiseMode: NoiseMode) => {
    settings.set({ noiseMode });
    if (call.store.get().status !== 'idle') void call.acquireMic();
  };

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div>
        <div className="mb-1.5 text-xs font-semibold text-muted">Supressão de ruído</div>
        <Select
          value={s.hifi ? 'off' : s.noiseMode}
          onChange={(v) => setMode(v as NoiseMode)}
          options={MODES.map((m) => ({ value: m.value, label: m.label }))}
        />
        <p className="mt-1 text-xs text-faint">{s.hifi ? 'Desligada no modo alta fidelidade.' : mode.hint}</p>
      </div>

      <div className="space-y-3 rounded-xl border border-line p-3">
        <Row title="Portão de ruído" hint={compact ? undefined : 'Corta tudo que fica abaixo do limite (respiração, teclado, TV ao fundo).'}>
          <Toggle checked={s.gateEnabled} onChange={(v) => call.setGate({ gateEnabled: v })} />
        </Row>
        <GateMeter />
        {s.gateEnabled && (
          <>
            <Row title="Limite automático" hint="Mede o ruído do seu ambiente e põe o limite logo acima.">
              <Toggle checked={s.gateAuto} onChange={(v) => call.setGate({ gateAuto: v })} />
            </Row>
            {!s.gateAuto && (
              <DbSlider
                label="Limite (arraste na barra também)"
                value={s.gateThresholdDb}
                min={THRESHOLD_MIN_DB}
                max={THRESHOLD_MAX_DB}
                format={(v) => `${v} dB`}
                onChange={(v) => call.setGate({ gateThresholdDb: v })}
              />
            )}
            <DbSlider
              label="Redução abaixo do limite"
              value={s.gateRangeDb}
              min={6}
              max={RANGE_MUTE}
              format={(v) => (v >= RANGE_MUTE ? 'silenciar' : `−${v} dB`)}
              onChange={(v) => call.setGate({ gateRangeDb: v })}
            />
            <DbSlider
              label="Fecha depois de"
              value={s.gateHoldMs}
              min={50}
              max={1000}
              step={10}
              format={(v) => `${v} ms`}
              onChange={(v) => call.setGate({ gateHoldMs: v })}
            />
          </>
        )}
      </div>
    </div>
  );
}
