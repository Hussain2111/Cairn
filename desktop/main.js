// Desktop shell.
//
// Cairn is a static site with no backend, so the desktop app is the same files
// in a window of their own. The only real decisions here are how those files
// are served and where the data ends up.
//
// They are served over a custom `cairn://` scheme rather than `file://` for one
// reason that matters: storage. `file://` has an opaque origin, so localStorage
// is unavailable or per-file, and localStorage is where every thread, question
// and gym set lives. A registered standard scheme gives a stable origin —
// `cairn://app` — that never changes across app versions or install paths, so
// yesterday's data is still there tomorrow. It also keeps ES modules working,
// which `file://` does not.

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, protocol, screen, shell } from 'electron';
import { contentTypeFor, resolveAsset } from '../scripts/assets.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEME = 'cairn';
const HOST = 'app';
const ORIGIN = `${SCHEME}://${HOST}`;
const START_URL = `${ORIGIN}/index.html`;
const REPO_URL = 'https://github.com/hussain2111/Cairn';

const DEFAULT_BOUNDS = { width: 1180, height: 820 };

// `standard` gives the scheme an origin (and therefore storage); `secure` puts
// it on the same footing as https, so nothing is treated as mixed content.
// Service workers are left off — the app only registers one over http, and
// there is nothing for it to do when every asset is already local.
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

// --- window state -----------------------------------------------------------
//
// Kept next to the data rather than in it: where the window was is a property
// of this machine, not of the plan.

const stateFile = () => join(app.getPath('userData'), 'window-state.json');

async function readWindowState() {
  try {
    const saved = JSON.parse(await readFile(stateFile(), 'utf8'));
    return visibleBounds(saved);
  } catch {
    return { ...DEFAULT_BOUNDS };
  }
}

/**
 * A saved position is only usable if a display still covers it. Unplugging the
 * second monitor otherwise reopens the window somewhere you cannot reach it.
 */
function visibleBounds(saved) {
  const { x, y, width, height, maximized } = saved || {};
  const bounds = {
    width: Number.isFinite(width) ? Math.max(640, width) : DEFAULT_BOUNDS.width,
    height: Number.isFinite(height) ? Math.max(480, height) : DEFAULT_BOUNDS.height,
    maximized: maximized === true,
  };
  if (!Number.isFinite(x) || !Number.isFinite(y)) return bounds;

  const onScreen = screen.getAllDisplays().some(({ workArea }) => {
    return (
      x + bounds.width > workArea.x &&
      y + bounds.height > workArea.y &&
      x < workArea.x + workArea.width &&
      y < workArea.y + workArea.height
    );
  });
  return onScreen ? { ...bounds, x, y } : bounds;
}

async function saveWindowState(window) {
  if (!window || window.isDestroyed()) return;
  const { x, y, width, height } = window.isNormal() ? window.getBounds() : window.getNormalBounds();
  const payload = JSON.stringify({ x, y, width, height, maximized: window.isMaximized() });
  try {
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(stateFile(), payload);
  } catch {
    // Losing the window position is not worth failing a quit over.
  }
}

// --- asset protocol ---------------------------------------------------------

function serveAssets() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== HOST) return new Response('Not found', { status: 404 });

    const file = resolveAsset(ROOT, url.pathname);
    if (!file) return new Response('Not found', { status: 404 });

    try {
      const body = await readFile(file);
      return new Response(body, {
        status: 200,
        headers: { 'content-type': contentTypeFor(file), 'cache-control': 'no-cache' },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// --- menu -------------------------------------------------------------------
//
// There is no Undo or Redo item, and that is deliberate. Cairn handles ⌘Z and
// ⌘⇧Z itself — undo is how you take back a deleted thread, not just a typo —
// and a menu accelerator is consumed by the menu before the page ever sees the
// key. Claiming ⌘Z here would replace the app's undo with a text-field undo.
// Leaving it out keeps the desktop app behaving exactly like the browser one.

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [{ role: 'pasteAndMatchStyle' }] : []),
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }]),
      ],
    },
    {
      role: 'help',
      submenu: [{ label: 'Cairn on GitHub', click: () => shell.openExternal(REPO_URL) }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- window -----------------------------------------------------------------

let mainWindow = null;

async function createWindow() {
  const { maximized, ...bounds } = await readWindowState();

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 640,
    minHeight: 480,
    // The theme is applied by a script in the document head, so waiting for the
    // first paint is what stops a white flash in front of a dark window.
    show: false,
    backgroundColor: '#0e1116',
    title: 'Cairn',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The renderer is the unmodified web app: it needs nothing from Node, so
      // there is no preload script to expose anything to it.
      spellcheck: true,
    },
  });

  if (maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Anything that is not the app itself belongs in the real browser: reading
  // links, a job posting in a pipeline record, a docs page on a task.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(ORIGIN)) return;
    event.preventDefault();
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
  });

  let savePending = null;
  const rememberBounds = () => {
    clearTimeout(savePending);
    savePending = setTimeout(() => saveWindowState(mainWindow), 400);
  };
  mainWindow.on('resize', rememberBounds);
  mainWindow.on('move', rememberBounds);
  mainWindow.on('close', () => {
    clearTimeout(savePending);
    saveWindowState(mainWindow);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(START_URL);
}

// --- lifecycle --------------------------------------------------------------
//
// One instance only. Two windows over one localStorage would trip the app's own
// "another tab has changed this data" conflict banner, which exists for browser
// tabs the shell cannot control — here it can simply not happen.

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    serveAssets();
    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
