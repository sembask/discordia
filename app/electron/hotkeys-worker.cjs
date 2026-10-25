// Processo auxiliar que escuta teclado e mouse do SISTEMA TODO (pra os atalhos
// valerem com o jogo em primeiro plano, inclusive "apertar pra falar").
//
// Roda separado do app de propósito: se a biblioteca nativa falhar (Wayland,
// permissão negada no macOS, driver estranho), só este processo cai e o app
// segue funcionando com os atalhos simples.
//
// Privacidade: só avisa o app quando uma tecla configurada como atalho é
// apertada ou solta. Nenhuma outra tecla sai daqui.

const { uIOhook, UiohookKey: K } = require('uiohook-napi');

const MODS = ['Ctrl', 'Alt', 'Shift', 'Meta'];
const MODIFIER_CODES = {
  ControlLeft: [K.Ctrl],
  ControlRight: [K.CtrlRight],
  AltLeft: [K.Alt],
  AltRight: [K.AltRight],
  ShiftLeft: [K.Shift],
  ShiftRight: [K.ShiftRight],
  MetaLeft: [K.Meta],
  MetaRight: [K.MetaRight],
};
// Teclado numérico com Num Lock desligado manda outro código (Windows).
const NUMPAD_ALT = {
  Numpad0: 'NumpadInsert',
  Numpad1: 'NumpadEnd',
  Numpad2: 'NumpadArrowDown',
  Numpad3: 'NumpadPageDown',
  Numpad4: 'NumpadArrowLeft',
  Numpad6: 'NumpadArrowRight',
  Numpad7: 'NumpadHome',
  Numpad8: 'NumpadArrowUp',
  Numpad9: 'NumpadPageUp',
  NumpadDecimal: 'NumpadDelete',
};
const MOUSE = { Mouse3: 3, Mouse4: 4, Mouse5: 5 };

/** Código da tecla no navegador (KeyboardEvent.code) → códigos do uiohook. */
function keycodesOf(code) {
  if (MODIFIER_CODES[code]) return MODIFIER_CODES[code];
  let name = code;
  if (/^Key[A-Z]$/.test(code)) name = code.slice(3);
  else if (/^Digit\d$/.test(code)) name = code.slice(5);
  const out = [];
  if (K[name] !== undefined) out.push(K[name]);
  if (NUMPAD_ALT[code] && K[NUMPAD_ALT[code]] !== undefined) out.push(K[NUMPAD_ALT[code]]);
  return out;
}

let bindings = [];
const held = new Set();
let running = false;

function parse({ id, binding }) {
  const parts = binding.split('+').filter(Boolean);
  const key = parts.pop();
  const mods = new Set(parts.filter((p) => MODS.includes(p)));
  return {
    id,
    key,
    mods,
    lenient: mods.size === 0 || !!MODIFIER_CODES[key],
    keycodes: MOUSE[key] ? [] : keycodesOf(key),
    button: MOUSE[key] ?? null,
  };
}

function modsMatch(b, e) {
  if (b.lenient) return true;
  const now = { Ctrl: e.ctrlKey, Alt: e.altKey, Shift: e.shiftKey, Meta: e.metaKey };
  return MODS.every((m) => b.mods.has(m) === !!now[m]);
}

function emit(id, phase) {
  process.parentPort.postMessage({ type: 'hotkey', id, phase });
}

function down(match, e) {
  for (const b of bindings) {
    if (!match(b) || !modsMatch(b, e)) continue;
    // Tecla segurada repete o evento: avisa só a primeira vez.
    if (held.has(b.id)) continue;
    held.add(b.id);
    emit(b.id, 'down');
  }
}

function up(match) {
  for (const b of bindings) {
    if (!match(b) || !held.has(b.id)) continue;
    held.delete(b.id);
    emit(b.id, 'up');
  }
}

uIOhook.on('keydown', (e) => down((b) => b.keycodes.includes(e.keycode), e));
uIOhook.on('keyup', (e) => up((b) => b.keycodes.includes(e.keycode)));
uIOhook.on('mousedown', (e) => down((b) => b.button === e.button, e));
uIOhook.on('mouseup', (e) => up((b) => b.button === e.button));

process.parentPort.on('message', ({ data }) => {
  if (data?.type !== 'set') return;
  // Atalho que sumiu enquanto estava segurado: solta.
  const next = (data.list ?? []).map(parse).filter((b) => b.keycodes.length || b.button);
  for (const id of held) {
    if (!next.some((b) => b.id === id)) {
      held.delete(id);
      emit(id, 'up');
    }
  }
  bindings = next;
  try {
    if (bindings.length && !running) {
      uIOhook.start();
      running = true;
    } else if (!bindings.length && running) {
      uIOhook.stop();
      running = false;
    }
    process.parentPort.postMessage({ type: 'ready', listening: running });
  } catch (err) {
    process.parentPort.postMessage({ type: 'error', message: String(err?.message ?? err) });
  }
});
