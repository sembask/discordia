// Teclas de atalho configuráveis.
//
// Um atalho é guardado como texto: modificadores + a tecla FÍSICA
// (KeyboardEvent.code, então funciona igual em qualquer layout de teclado),
// ex.: "Ctrl+Shift+KeyM", "ControlRight" (só o Ctrl da direita) ou "Mouse4"
// (botão lateral do mouse).
//
// Dentro da janela quem escuta é o próprio app. No app instalado, um processo
// auxiliar também escuta o teclado do sistema todo, então os atalhos valem com
// o jogo em primeiro plano (inclusive "apertar pra falar").

import { settings } from './settings';
import { DEFAULT_HOTKEYS, type HotkeyAction, type HotkeyMap } from './hotkey-map';

export { DEFAULT_HOTKEYS, type HotkeyAction, type HotkeyMap };

export interface HotkeyInfo {
  id: HotkeyAction;
  label: string;
  hint: string;
  /** Segurar (vale enquanto a tecla está apertada) em vez de apertar uma vez. */
  hold?: boolean;
}

export const HOTKEY_ACTIONS: HotkeyInfo[] = [
  { id: 'toggleMute', label: 'Ligar/desligar microfone', hint: 'Muta e desmuta.' },
  { id: 'toggleDeafen', label: 'Ensurdecer', hint: 'Para de ouvir todo mundo (e muta).' },
  { id: 'pushToTalk', label: 'Apertar pra falar', hint: 'Com o modo "apertar pra falar" ligado, o microfone só abre enquanto segura.', hold: true },
  { id: 'pushToMute', label: 'Segurar pra mutar', hint: 'Fica mudo só enquanto segura (pra tossir, falar com alguém em casa…).', hold: true },
  { id: 'toggleScreen', label: 'Compartilhar / parar tela', hint: 'Abre a escolha de tela, ou para se já estiver transmitindo.' },
  { id: 'toggleChat', label: 'Abrir/fechar chat', hint: 'Mostra ou esconde o painel do chat.' },
  { id: 'musicPlayPause', label: 'Música: tocar/pausar', hint: 'Pausa ou continua a música da sala.' },
  { id: 'musicSkip', label: 'Música: pular', hint: 'Passa pra próxima música da fila.' },
];

const MODS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
type Mod = (typeof MODS)[number];

const MODIFIER_CODES: Record<string, Mod> = {
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl',
  AltLeft: 'Alt',
  AltRight: 'Alt',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  MetaLeft: 'Meta',
  MetaRight: 'Meta',
};

export interface Binding {
  mods: Set<Mod>;
  key: string;
}

export function parseBinding(text: string | null | undefined): Binding | null {
  if (!text) return null;
  const parts = text.split('+').filter(Boolean);
  const key = parts.pop();
  if (!key) return null;
  return { mods: new Set(parts.filter((p): p is Mod => (MODS as readonly string[]).includes(p))), key };
}

export function formatBinding(mods: Iterable<Mod>, key: string): string {
  const set = new Set(mods);
  return [...MODS.filter((m) => set.has(m) && MODIFIER_CODES[key] !== m), key].join('+');
}

const isMac = /Mac/i.test(navigator.platform);

const KEY_NAMES: Record<string, string> = {
  Space: 'Espaço',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Escape: 'Esc',
  CapsLock: 'Caps Lock',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backquote: "'",
  Minus: '-',
  Equal: '=',
  BracketLeft: '´',
  BracketRight: '[',
  Backslash: ']',
  Semicolon: 'Ç',
  Quote: '~',
  Comma: ',',
  Period: '.',
  Slash: ';',
  IntlBackslash: '\\',
  IntlRo: '/',
  ControlLeft: 'Ctrl esquerdo',
  ControlRight: 'Ctrl direito',
  ShiftLeft: 'Shift esquerdo',
  ShiftRight: 'Shift direito',
  AltLeft: 'Alt',
  AltRight: 'Alt Gr',
  MetaLeft: isMac ? '⌘' : 'Win',
  MetaRight: isMac ? '⌘ direito' : 'Win direito',
  Mouse3: 'Botão do meio',
  Mouse4: 'Mouse lateral 1',
  Mouse5: 'Mouse lateral 2',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  PrintScreen: 'Print Screen',
  ScrollLock: 'Scroll Lock',
  NumLock: 'Num Lock',
};

/** Letra que a tecla tem no teclado da pessoa (o navegador sabe o layout). */
let layout: Map<string, string> | null = null;
(navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard
  ?.getLayoutMap?.()
  .then((m) => (layout = m))
  .catch(() => {});

function keyName(code: string): string {
  const printed = layout?.get(code);
  if (printed && printed.trim() && !code.startsWith('Numpad') && code !== 'Space') return printed.toUpperCase();
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (code.startsWith('Numpad')) {
    const rest = code.slice(6);
    const sym: Record<string, string> = { Add: '+', Subtract: '-', Multiply: '*', Divide: '/', Decimal: ',', Enter: 'Enter' };
    return `Num ${sym[rest] ?? rest}`;
  }
  return code;
}

const MOD_NAMES: Record<Mod, string> = { Ctrl: isMac ? '⌃' : 'Ctrl', Alt: isMac ? '⌥' : 'Alt', Shift: 'Shift', Meta: isMac ? '⌘' : 'Win' };

/** Texto pra mostrar: "Ctrl + Shift + M". */
export function bindingLabel(text: string | null | undefined): string {
  const b = parseBinding(text);
  if (!b) return 'Nenhum';
  return [...MODS.filter((m) => b.mods.has(m)).map((m) => MOD_NAMES[m]), keyName(b.key)].join(' + ');
}

/** Botões do mouse que dá pra usar (o esquerdo e o direito não). */
export function mouseCode(button: number): string | null {
  return ({ 1: 'Mouse3', 3: 'Mouse4', 4: 'Mouse5' } as Record<number, string>)[button] ?? null;
}

function modsOf(e: KeyboardEvent | MouseEvent): Set<Mod> {
  const m = new Set<Mod>();
  if (e.ctrlKey) m.add('Ctrl');
  if (e.altKey) m.add('Alt');
  if (e.shiftKey) m.add('Shift');
  if (e.metaKey) m.add('Meta');
  return m;
}

/**
 * O evento casa com o atalho? Tecla sozinha (sem modificador) aceita qualquer
 * modificador junto: assim "apertar pra falar" continua funcionando com o
 * Shift apertado pra correr no jogo. Combinações exigem os mesmos modificadores.
 */
export function matches(b: Binding, code: string, mods: Set<Mod>): boolean {
  if (b.key !== code) return false;
  if (MODIFIER_CODES[b.key] || b.mods.size === 0) return true;
  return MODS.every((m) => b.mods.has(m) === mods.has(m));
}

function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.tagName) return false;
  return el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes((el as HTMLInputElement).type));
}

/** Atalho que não atrapalha quem está digitando no chat. */
function safeWhileTyping(b: Binding): boolean {
  return b.mods.has('Ctrl') || b.mods.has('Alt') || b.mods.has('Meta') || /^F\d+$/.test(b.key) || b.key.startsWith('Mouse') || !!MODIFIER_CODES[b.key];
}

// ------------------------------------------------------------------ gerenciador

type Phase = 'down' | 'up';
type Handler = (phase: Phase) => void;

export interface GlobalStatus {
  /** hook = escuta o sistema todo (inclusive segurar); shortcut = só atalhos de apertar; off = só com a janela em foco. */
  mode: 'hook' | 'shortcut' | 'off';
  /** Ações que não deu pra registrar fora da janela (outro programa usa a tecla, por exemplo). */
  failed: HotkeyAction[];
}

class Hotkeys {
  private handlers = new Map<HotkeyAction, Set<Handler>>();
  /** Ações seguradas agora, por origem (janela e sistema). */
  private held = new Map<HotkeyAction, Set<string>>();
  private recording = 0;
  status: GlobalStatus = { mode: 'off', failed: [] };
  private statusListeners = new Set<(s: GlobalStatus) => void>();

  constructor() {
    window.addEventListener('keydown', (e) => this.onKey(e, 'down'), true);
    window.addEventListener('keyup', (e) => this.onKey(e, 'up'), true);
    window.addEventListener('mousedown', (e) => this.onMouse(e, 'down'), true);
    window.addEventListener('mouseup', (e) => this.onMouse(e, 'up'), true);
    // Soltou a tecla com a janela fora de foco: não deixa o microfone preso aberto.
    window.addEventListener('blur', () => this.releaseSource('window'));
    window.discordia?.onHotkey?.((id, phase) => this.fire(id as HotkeyAction, phase, 'global'));
    let last = '';
    settings.subscribe(() => {
      const s = settings.get();
      const key = JSON.stringify([s.hotkeys, s.globalHotkeys]);
      if (key !== last) {
        last = key;
        void this.syncGlobal();
      }
    });
    void this.syncGlobal();
  }

  bindings(): HotkeyMap {
    return { ...DEFAULT_HOTKEYS, ...settings.get().hotkeys };
  }

  on(id: HotkeyAction, fn: Handler): () => void {
    let set = this.handlers.get(id);
    if (!set) this.handlers.set(id, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  isHeld(id: HotkeyAction): boolean {
    return (this.held.get(id)?.size ?? 0) > 0;
  }

  onStatus(fn: (s: GlobalStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  /** Grava um atalho novo: enquanto isso, nenhum atalho dispara. */
  async record(): Promise<string | null> {
    this.recording += 1;
    for (const id of this.held.keys()) this.releaseSource('window', id);
    await this.syncGlobal();
    try {
      return await new Promise<string | null>((resolve) => {
        let pendingModifier: string | null = null;
        const done = (value: string | null) => {
          window.removeEventListener('keydown', onDown, true);
          window.removeEventListener('keyup', onUp, true);
          window.removeEventListener('mousedown', onMouse, true);
          window.removeEventListener('contextmenu', stop, true);
          resolve(value);
        };
        const stop = (e: Event) => {
          e.preventDefault();
          e.stopImmediatePropagation();
        };
        const onDown = (e: KeyboardEvent) => {
          stop(e);
          if (e.repeat) return;
          if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) return done(null);
          // Modificador sozinho: só vale se for solto sem outra tecla (ex.: Ctrl direito pra falar).
          if (MODIFIER_CODES[e.code]) {
            pendingModifier = e.code;
            return;
          }
          done(formatBinding(modsOf(e), e.code));
        };
        const onUp = (e: KeyboardEvent) => {
          stop(e);
          if (pendingModifier && e.code === pendingModifier) done(pendingModifier);
        };
        const onMouse = (e: MouseEvent) => {
          const code = mouseCode(e.button);
          if (!code) return;
          stop(e);
          done(formatBinding(modsOf(e), code));
        };
        window.addEventListener('keydown', onDown, true);
        window.addEventListener('keyup', onUp, true);
        window.addEventListener('mousedown', onMouse, true);
        window.addEventListener('contextmenu', stop, true);
      });
    } finally {
      this.recording -= 1;
      await this.syncGlobal();
    }
  }

  /** Define o atalho de uma ação; se outra ação usava a mesma tecla, ela perde. Devolve quem perdeu. */
  assign(id: HotkeyAction, binding: string | null): HotkeyAction | null {
    const map = this.bindings();
    let stolen: HotkeyAction | null = null;
    if (binding) {
      for (const other of HOTKEY_ACTIONS) {
        if (other.id !== id && map[other.id] === binding) {
          map[other.id] = null;
          stolen = other.id;
        }
      }
    }
    map[id] = binding;
    settings.set({ hotkeys: map });
    return stolen;
  }

  resetDefaults() {
    settings.set({ hotkeys: { ...DEFAULT_HOTKEYS } });
  }

  private fire(id: HotkeyAction, phase: Phase, source: string) {
    if (this.recording) return;
    const info = HOTKEY_ACTIONS.find((a) => a.id === id);
    if (!info) return;
    if (info.hold) {
      let set = this.held.get(id);
      if (!set) this.held.set(id, (set = new Set()));
      const before = set.size > 0;
      if (phase === 'down') set.add(source);
      else set.delete(source);
      const after = set.size > 0;
      if (before === after) return;
      phase = after ? 'down' : 'up';
    } else if (phase !== 'down') {
      return;
    }
    for (const fn of this.handlers.get(id) ?? []) fn(phase);
  }

  private releaseSource(source: string, only?: HotkeyAction) {
    for (const [id, set] of this.held) {
      if (only && id !== only) continue;
      if (set.has(source)) this.fire(id, 'up', source);
    }
  }

  private onKey(e: KeyboardEvent, phase: Phase) {
    if (this.recording || (phase === 'down' && e.repeat)) return;
    const mods = modsOf(e);
    for (const [id, text] of Object.entries(this.bindings()) as [HotkeyAction, string | null][]) {
      const b = parseBinding(text);
      if (!b) continue;
      if (phase === 'up') {
        // Soltar a tecla principal encerra o "segurar", com qualquer modificador.
        if (b.key === e.code) this.fire(id, 'up', 'window');
        continue;
      }
      if (!matches(b, e.code, mods)) continue;
      if (typingIn(e.target) && !safeWhileTyping(b)) continue;
      if (!MODIFIER_CODES[b.key]) e.preventDefault();
      this.fire(id, 'down', 'window');
    }
  }

  private onMouse(e: MouseEvent, phase: Phase) {
    const code = mouseCode(e.button);
    if (!code || this.recording) return;
    const mods = modsOf(e);
    for (const [id, text] of Object.entries(this.bindings()) as [HotkeyAction, string | null][]) {
      const b = parseBinding(text);
      if (!b) continue;
      if (phase === 'up' ? b.key === code : matches(b, code, mods)) {
        // Botão lateral do mouse não pode virar "voltar página" no navegador.
        e.preventDefault();
        this.fire(id, phase, 'window');
      }
    }
  }

  /** Avisa o app instalado quais atalhos escutar fora da janela. */
  private async syncGlobal() {
    const bridge = window.discordia;
    if (!bridge?.setHotkeys) return;
    const s = settings.get();
    const enabled = s.globalHotkeys && !this.recording;
    const list = enabled
      ? HOTKEY_ACTIONS.map((a) => ({ id: a.id, binding: this.bindings()[a.id], hold: !!a.hold })).filter((x) => x.binding)
      : [];
    try {
      const status = (await bridge.setHotkeys(list as { id: string; binding: string; hold: boolean }[])) as unknown as GlobalStatus;
      if (this.recording && !enabled) return;
      this.status = enabled ? status : { mode: 'off', failed: [] };
      for (const fn of this.statusListeners) fn(this.status);
    } catch {
      // Versão antiga do app sem suporte: só atalhos dentro da janela.
    }
  }
}

export const hotkeys = new Hotkeys();

(window as unknown as { __discordiaHotkeys: Hotkeys }).__discordiaHotkeys = hotkeys;
