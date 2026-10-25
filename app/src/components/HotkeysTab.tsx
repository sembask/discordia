import { useEffect, useState } from 'react';
import { Keyboard, RotateCcw, X } from 'lucide-react';
import { HOTKEY_ACTIONS, bindingLabel, hotkeys, type GlobalStatus, type HotkeyAction } from '../lib/hotkeys';
import { isWeb, settings } from '../lib/settings';
import { useStore } from '../lib/store';
import { Button, Segmented, Slider, Toggle, cx } from './ui';

/** Modo de entrada do microfone: aberto (detecção de voz) ou apertar pra falar. */
export function InputModeControl({ compact = false }: { compact?: boolean }) {
  const ptt = useStore(settings, (s) => s.pushToTalk);
  const key = useStore(settings, (s) => s.hotkeys.pushToTalk);
  return (
    <div className="space-y-1.5">
      {!compact && <div className="text-sm font-semibold">Modo do microfone</div>}
      <Segmented
        value={ptt ? 'ptt' : 'open'}
        onChange={(v) => settings.set({ pushToTalk: v === 'ptt' })}
        options={[
          { value: 'open', label: 'Aberto' },
          { value: 'ptt', label: 'Apertar pra falar' },
        ]}
      />
      {ptt && (
        <div className={cx('text-xs', key ? 'text-muted' : 'font-medium text-warning')}>
          {key ? `Segure ${bindingLabel(key)} pra falar.` : 'Escolha a tecla em Configurações → Atalhos.'}
        </div>
      )}
    </div>
  );
}

export function HotkeysTab() {
  const map = useStore(settings, (s) => s.hotkeys);
  const s = useStore(settings, (x) => x);
  const [recording, setRecording] = useState<HotkeyAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<GlobalStatus>(hotkeys.status);
  useEffect(() => hotkeys.onStatus(setStatus), []);

  const record = async (id: HotkeyAction) => {
    setNotice(null);
    setRecording(id);
    const binding = await hotkeys.record();
    setRecording(null);
    if (!binding) return;
    const stolen = hotkeys.assign(id, binding);
    if (stolen) {
      const name = HOTKEY_ACTIONS.find((a) => a.id === stolen)?.label;
      setNotice(`${bindingLabel(binding)} estava em “${name}” e foi movido pra cá.`);
    }
  };

  const globalText = isWeb
    ? 'No navegador os atalhos só funcionam com a aba do Discordia aberta e em foco. Baixe o app pra usar com o jogo aberto.'
    : !s.globalHotkeys
      ? 'Desligado: os atalhos só funcionam com a janela do Discordia em foco.'
      : status.mode === 'hook'
        ? 'Funcionando com qualquer janela em foco (inclusive jogos), inclusive "apertar pra falar" e botões laterais do mouse.'
        : status.mode === 'shortcut'
          ? 'Fora da janela só funcionam atalhos de apertar uma vez. "Apertar pra falar", "segurar pra mutar" e botões do mouse funcionam só com o Discordia em foco.'
          : 'Configure um atalho pra ele valer fora da janela.';

  return (
    <div className="space-y-5">
      <InputModeControl />

      {s.pushToTalk && (
        <Slider
          label="Atraso ao soltar"
          value={s.pttReleaseMs}
          min={0}
          max={1000}
          step={10}
          format={(v) => `${Math.round(v)} ms`}
          onChange={(v) => settings.set({ pttReleaseMs: Math.round(v) })}
        />
      )}

      <div className="flex items-center justify-between gap-6">
        <div>
          <div className="text-sm font-semibold">Atalhos com outra janela em foco</div>
          <div className="text-xs text-muted">{globalText}</div>
        </div>
        {!isWeb && <Toggle checked={s.globalHotkeys} onChange={(v) => settings.set({ globalHotkeys: v })} />}
      </div>

      <div className="overflow-hidden rounded-2xl border border-line">
        {HOTKEY_ACTIONS.map((a, i) => {
          const failed = !isWeb && s.globalHotkeys && status.failed.includes(a.id) && !!map[a.id];
          return (
            <div key={a.id} className={cx('flex items-center gap-3 px-4 py-3', i > 0 && 'border-t border-line')} data-hotkey={a.id}>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{a.label}</div>
                <div className="text-xs text-muted">{a.hint}</div>
                {failed && <div className="text-xs text-warning">Outro programa já usa essa tecla: aqui ela só vale com o Discordia em foco.</div>}
              </div>
              <button
                onClick={() => (recording ? undefined : void record(a.id))}
                className={cx(
                  'min-w-36 rounded-xl border px-3 py-2 text-sm font-semibold transition',
                  recording === a.id
                    ? 'animate-pulse border-accent bg-accent-soft text-accent'
                    : map[a.id]
                      ? 'border-line bg-panel-2 text-fg hover:border-accent'
                      : 'border-dashed border-line text-faint hover:border-accent hover:text-fg',
                )}
                title="Clique e aperte a tecla (ou combinação, ou botão lateral do mouse). Esc cancela."
              >
                {recording === a.id ? 'Aperte a tecla…' : bindingLabel(map[a.id])}
              </button>
              <button
                onClick={() => hotkeys.assign(a.id, null)}
                disabled={!map[a.id] || !!recording}
                title="Tirar atalho"
                aria-label={`Tirar atalho de ${a.label}`}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-hover hover:text-fg disabled:invisible"
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>

      {notice && <div className="rounded-lg bg-accent-soft px-3 py-2 text-xs font-medium text-accent">{notice}</div>}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-xs text-faint">
          <Keyboard size={13} /> Clique num atalho e aperte a tecla. Esc cancela.
        </div>
        <Button variant="ghost" onClick={() => hotkeys.resetDefaults()} disabled={!!recording}>
          <RotateCcw size={14} /> Restaurar padrões
        </Button>
      </div>
    </div>
  );
}
