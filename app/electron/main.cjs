// Processo principal do Electron: cria a janela, libera microfone/captura de
// tela e entrega a fonte (tela ou janela) que o usuário escolheu no seletor
// do próprio app.

const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  session,
  shell,
  nativeTheme,
  systemPreferences,
} = require('electron');
const path = require('node:path');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const TITLE_BAR_HEIGHT = 40;

const THEMES = {
  dark: { background: '#0b0c10', overlay: '#0b0c10', symbol: '#c9cdd8' },
  light: { background: '#f4f5f9', overlay: '#f4f5f9', symbol: '#3b4152' },
};

/** Fonte escolhida no seletor, consumida pelo próximo getDisplayMedia. */
let pendingSource = null;
let win = null;

// Uma instância só: abrir de novo traz a janela existente pra frente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// A chamada não pode engasgar com a janela minimizada ou atrás de um jogo.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

/**
 * Lista telas e janelas em chamadas SEPARADAS: em alguns sistemas a listagem
 * de janelas falha e, numa chamada só, levaria as telas junto.
 */
let captureQueue = Promise.resolve();

/** Uma consulta de captura por vez: chamadas simultâneas podem voltar vazias. */
function queued(fn) {
  const run = captureQueue.then(fn, fn);
  captureQueue = run.catch(() => {});
  return run;
}

async function listSources(types, options = {}) {
  const sources = [];
  for (const type of types) {
    try {
      sources.push(...(await queued(() => desktopCapturer.getSources({ ...options, types: [type] }))));
    } catch (err) {
      console.warn(`[captura] falha ao listar ${type}`, err);
    }
  }
  return sources;
}

/** Acha a fonte escolhida; tenta algumas vezes antes de desistir. */
async function findSource(chosen) {
  const type = chosen && chosen.id.startsWith('window:') ? 'window' : 'screen';
  for (let attempt = 0; attempt < 3; attempt++) {
    const sources = await listSources([type]);
    const source = chosen ? sources.find((s) => s.id === chosen.id) : sources[0];
    if (source) return source;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

function themeColors(theme) {
  return THEMES[theme] || (nativeTheme.shouldUseDarkColors ? THEMES.dark : THEMES.light);
}

function createWindow() {
  const colors = themeColors();
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'Discordia',
    backgroundColor: colors.background,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    ...(IS_MAC
      ? { trafficLightPosition: { x: 14, y: 13 } }
      : { titleBarOverlay: { color: colors.overlay, symbolColor: colors.symbol, height: TITLE_BAR_HEIGHT } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Links do chat abrem no navegador do sistema, nunca dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (DEV_URL && url.startsWith(DEV_URL)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

function setupPermissions() {
  const ses = session.defaultSession;
  const allowed = new Set(['media', 'display-capture', 'clipboard-sanitized-write', 'notifications', 'fullscreen', 'speaker-selection']);
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  // O app mostra o próprio seletor (com miniaturas). Quando o renderer chama
  // getDisplayMedia, entregamos a fonte que ele escolheu antes.
  ses.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const chosen = pendingSource;
      pendingSource = null;
      try {
        const source = await findSource(chosen);
        if (!source) {
          callback({});
          return;
        }
        // Áudio do sistema: só o Windows tem captura de loopback.
        callback(chosen && chosen.audio && IS_WIN ? { video: source, audio: 'loopback' } : { video: source });
      } catch (err) {
        console.error('[captura] falhou ao listar fontes', err);
        callback({});
      }
    },
    { useSystemPicker: false },
  );
}

function setupIpc() {
  ipcMain.handle('screen:sources', async (_event, kind) => {
    const types = kind === 'screen' || kind === 'window' ? [kind] : ['screen', 'window'];
    const sources = await listSources(types, {
      thumbnailSize: { width: 480, height: 270 },
      fetchWindowIcons: true,
    });
    return sources
      .filter((s) => s.name !== 'Discordia' || s.id.startsWith('screen:'))
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.id.startsWith('screen:') ? 'screen' : 'window',
        thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
        icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
      }));
  });

  ipcMain.handle('screen:select', (_event, id, audio) => {
    pendingSource = { id: String(id), audio: !!audio };
  });

  ipcMain.on('window:theme', (_event, theme) => {
    if (!win || IS_MAC) return;
    const colors = themeColors(theme);
    win.setBackgroundColor(colors.background);
    try {
      win.setTitleBarOverlay({ color: colors.overlay, symbolColor: colors.symbol, height: TITLE_BAR_HEIGHT });
    } catch {
      // Linux sem suporte a overlay: ignora.
    }
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    systemAudio: IS_WIN,
  }));
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(async () => {
  if (IS_MAC) {
    try {
      await systemPreferences.askForMediaAccess('microphone');
    } catch {
      // Usuário pode negar; o app segue só ouvindo.
    }
  }
  setupPermissions();
  setupIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!IS_MAC) app.quit();
});
