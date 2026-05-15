const { app, BrowserWindow, ipcMain, powerSaveBlocker, screen, session, globalShortcut, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const { ensureManagedServiceRunning, stopManagedService } = require('./managed-service');
const { cleanObsoleteProfileData } = require('./profile-cleanup');
const { ACTIONS, GLOBAL_SHORTCUTS } = require('./shortcuts');
const { getIinaMediaUrl, isExternalPlayerUrl } = require('./external-protocols');

const disableGpuAcceleration = process.env.TV_ELECTRON_DISABLE_GPU === '1'
  || process.argv.includes('--disable-gpu-rendering');

if (disableGpuAcceleration) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
}

let mainWindow;
let tray = null;
let blockerId = null;
let torrServerRuntime = null;
let cleanupInProgress = false;
let isQuitting = false;
let externalPlayerMonitor = null;
let externalPlayerWindowHidden = false;

const userDataRoot = path.join(app.getPath('home'), '.openclaw', 'workspace', '.tv-electron-mvp-user-data');
app.setPath('userData', userDataRoot);
const gotSingleInstanceLock = app.requestSingleInstanceLock();

const localLampaDir = getResourcePath('lampa');
const localLampaPidFile = path.join(userDataRoot, 'lampa-server.pid');
const localLampaLogFile = path.join(userDataRoot, 'logs', 'lampa-server.log');
const localLampaPort = 8099;
const localLampaUrl = `http://127.0.0.1:${localLampaPort}/`;
const torrServerPort = 8090;
const torrServerUrl = `http://127.0.0.1:${torrServerPort}/`;
const browserPartitions = ['persist:lampa', 'persist:youtube', 'persist:kinopoisk'];
const iinaAppPath = '/Applications/IINA.app';
const shortcutLogFile = path.join(userDataRoot, 'shortcut-events.log');
const viewerLogFile = path.join(userDataRoot, 'viewer-events.log');
const windowModeFile = path.join(userDataRoot, 'window-mode.json');
const DEBUG_SHORTCUTS = false;
const ALWAYS_LOG_EVENT_PREFIXES = [
  'app-',
  'global-shortcut-register',
  'external-player-',
  'tray-',
  'window-',
  'hide-main-window',
  'show-main-window',
];

function getResourcePath(...segments) {
  if (app.isPackaged) return path.join(process.resourcesPath, ...segments);
  return path.join(__dirname, ...segments);
}

function getAppAssetPath(...segments) {
  return path.join(__dirname, 'assets', ...segments);
}

function getWindowIconPath() {
  const candidates = [
    getAppAssetPath('icon.icns'),
    getAppAssetPath('icon-1024.png'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function getTrayIcon() {
  const candidates = [
    getAppAssetPath('icon.iconset', process.platform === 'darwin' ? 'icon_16x16@2x.png' : 'icon_32x32.png'),
    getAppAssetPath('icon.iconset', 'icon_32x32.png'),
    getAppAssetPath('icon-1024.png'),
    getWindowIconPath(),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const image = nativeImage.createFromPath(candidate);
    if (image.isEmpty()) continue;

    const size = process.platform === 'darwin' ? 18 : 24;
    const resized = image.resize({ width: size, height: size });
    if (process.platform === 'darwin') resized.setTemplateImage(true);
    return resized;
  }

  return nativeImage.createEmpty();
}

function getLocalLampaService() {
  return {
    name: 'Lampa',
    command: 'python3',
    args: ['-m', 'http.server', String(localLampaPort), '--directory', localLampaDir],
    cwd: localLampaDir,
    healthUrl: localLampaUrl,
    pidFile: localLampaPidFile,
    logFile: localLampaLogFile,
    requiredPaths: [path.join(localLampaDir, 'index.html')],
    waitAttempts: 10,
    waitMs: 300,
  };
}

function getTorrServerService() {
  const torrServerRoot = path.join(userDataRoot, 'torrserver');
  const logDir = path.join(userDataRoot, 'logs');
  const executablePath = getResourcePath('TorrServer');
  return {
    name: 'TorrServer',
    command: executablePath,
    args: [
      '--ip', '127.0.0.1',
      '--port', String(torrServerPort),
      '--path', torrServerRoot,
      '--logpath', path.join(logDir, 'torrserver.log'),
      '--weblogpath', path.join(logDir, 'torrserver-web.log'),
    ],
    cwd: path.dirname(executablePath),
    healthUrl: torrServerUrl,
    pidFile: path.join(userDataRoot, 'torrserver.pid'),
    logFile: path.join(logDir, 'torrserver-process.log'),
    requiredPaths: [executablePath],
    ensureDirs: [torrServerRoot, logDir],
    waitAttempts: 20,
    waitMs: 300,
  };
}

function ensureLocalLampaRunning() {
  fs.mkdirSync(userDataRoot, { recursive: true });
  return ensureManagedServiceRunning(getLocalLampaService()).result;
}

function ensureTorrServerRunning() {
  fs.mkdirSync(userDataRoot, { recursive: true });
  const { result, runtime } = ensureManagedServiceRunning(getTorrServerService());
  if (runtime?.ownsProcess) torrServerRuntime = runtime;
  appendShortcutLog('torrserver-ensure', result);
  return result;
}

function stopTorrServer() {
  const result = stopManagedService(torrServerRuntime);
  torrServerRuntime = null;
  appendShortcutLog('torrserver-stop', result);
  return result;
}

function useSimpleFullscreenMode() {
  return process.platform === 'darwin';
}

function isVisualFullscreen(win) {
  if (!win) return false;
  return win.isFullScreen() || Boolean(win.isSimpleFullScreen && win.isSimpleFullScreen());
}

function getWindowDebugState(win) {
  if (!win) return { hasWindow: false };
  const bounds = win.getBounds();
  const simpleFullscreen = win.isSimpleFullScreen ? win.isSimpleFullScreen() : undefined;
  return {
    hasWindow: true,
    fullscreen: win.isFullScreen(),
    visualFullscreen: win.isFullScreen() || Boolean(simpleFullscreen),
    focused: win.isFocused(),
    visible: win.isVisible(),
    minimized: win.isMinimized(),
    kiosk: win.isKiosk(),
    simpleFullscreen,
    bounds,
  };
}

function updateTrayMenu() {
  if (!tray) return;
  const hasVisibleWindow = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized());
  const fullscreen = readWindowMode().fullscreen !== false;
  const menu = Menu.buildFromTemplate([
    {
      label: hasVisibleWindow ? 'Свернуть в иконку' : 'Показать окно',
      click: () => {
        if (hasVisibleWindow) hideMainWindowToTray({ source: 'tray-menu' });
        else showMainWindow({ source: 'tray-menu' });
      },
    },
    {
      label: fullscreen ? 'Оконный режим' : 'На весь экран',
      click: () => toggleFullscreenMode({ source: 'tray-menu' }),
    },
    { type: 'separator' },
    { label: 'Перезапустить', click: () => relaunchApp() },
    {
      label: 'Выход',
      click: () => {
        isQuitting = true;
        shutdownOwnedServices();
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  if (tray) return tray;

  const icon = getTrayIcon();
  if (icon.isEmpty()) {
    appendShortcutLog('tray-create-empty-icon', {});
    return null;
  }

  tray = new Tray(icon);
  tray.setToolTip('Lampa Wrapper');
  tray.on('click', () => showMainWindow({ source: 'tray-click' }));
  tray.on('right-click', () => {
    updateTrayMenu();
    tray.popUpContextMenu();
  });
  updateTrayMenu();
  appendShortcutLog('tray-create', {});
  return tray;
}

function showMainWindow(logContext = {}) {
  appendShortcutLog('show-main-window:start', { ...logContext, ...getWindowDebugState(mainWindow) });

  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }

  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  restoreUsableWindowedBounds(mainWindow, logContext);
  if (process.platform === 'darwin') app.dock?.show();

  if (typeof mainWindow.moveTop === 'function') mainWindow.moveTop();
  mainWindow.focus();
  app.focus({ steal: true });

  if (readWindowMode().fullscreen !== false && !isVisualFullscreen(mainWindow)) {
    setTimeout(() => applyFullscreenState(mainWindow, true), 50);
  }

  updateTrayMenu();
  appendShortcutLog('show-main-window:end', { ...logContext, ...getWindowDebugState(mainWindow) });
}

function hideMainWindowToTray(logContext = {}) {
  appendShortcutLog('hide-main-window:start', { ...logContext, ...getWindowDebugState(mainWindow) });
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.hide();
  updateTrayMenu();
  appendShortcutLog('hide-main-window:end', { ...logContext, ...getWindowDebugState(mainWindow) });
}

function applyFullscreenState(win, fullscreen) {
  if (!win) return;
  appendShortcutLog('apply-fullscreen-state:before', { requested: fullscreen, ...getWindowDebugState(win) });
  win.setAutoHideMenuBar(Boolean(fullscreen));
  win.setMenuBarVisibility(!fullscreen);
  if (fullscreen) {
    win.show();
    if (useSimpleFullscreenMode() && typeof win.setSimpleFullScreen === 'function') {
      if (win.isFullScreen()) win.setFullScreen(false);
      win.setSimpleFullScreen(true);
    } else {
      win.setFullScreen(true);
    }
    win.focus();
  } else {
    if (typeof win.setSimpleFullScreen === 'function' && win.isSimpleFullScreen()) {
      win.setSimpleFullScreen(false);
    }
    if (win.isFullScreen()) win.setFullScreen(false);
    win.setBounds(getWindowedBounds());
    win.show();
    win.focus();
  }
  appendShortcutLog('apply-fullscreen-state:after', { requested: fullscreen, ...getWindowDebugState(win) });
  updateTrayMenu();
}

function appendShortcutLog(event, payload = {}) {
  if (!DEBUG_SHORTCUTS && !ALWAYS_LOG_EVENT_PREFIXES.some((prefix) => String(event).startsWith(prefix))) return;
  appendJsonLog(shortcutLogFile, { event, ...payload });
}

function appendJsonLog(file, payload = {}) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...payload }) + '\n', 'utf8');
  } catch {}
}

function spawnDetached(command, args, event, payload = {}) {
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });

    child.on('error', (error) => {
      appendShortcutLog(`${event}-failed`, {
        ...payload,
        error: String(error?.message || error),
      });
    });

    child.unref();
    return true;
  } catch (error) {
    appendShortcutLog(`${event}-failed`, {
      ...payload,
      error: String(error?.message || error),
    });
    return false;
  }
}

function execFileResult(command, args, timeout = 3000) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout }, (error, stdout = '') => {
      resolve({
        ok: !error,
        stdout: String(stdout).trim(),
        error,
      });
    });
  });
}

function resumeMacApp(appName, source) {
  if (process.platform !== 'darwin') return;

  appendShortcutLog('external-player-resume', { source, appName });
  spawnDetached('/usr/bin/pkill', ['-CONT', '-x', appName], 'external-player-resume', { source, appName });
}

function activateMacApp(appName, source) {
  if (process.platform !== 'darwin') return;

  appendShortcutLog('external-player-activate', { source, appName });
  spawnDetached('/usr/bin/osascript', [
    '-e',
    `tell application ${JSON.stringify(appName)} to activate`,
    '-e',
    `tell application "System Events" to if exists process ${JSON.stringify(appName)} then set frontmost of process ${JSON.stringify(appName)} to true`,
  ], 'external-player-activate', { source, appName });
}

async function isMacAppRunning(appName) {
  const result = await execFileResult('/usr/bin/pgrep', ['-x', appName], 2000);
  return result.ok;
}

async function getMacAppWindowCount(appName) {
  const script = [
    'tell application "System Events"',
    `if exists process ${JSON.stringify(appName)} then`,
    `return count of windows of process ${JSON.stringify(appName)}`,
    'else',
    'return -1',
    'end if',
    'end tell',
  ].join('\n');
  const result = await execFileResult('/usr/bin/osascript', ['-e', script], 3000);
  if (!result.ok) return null;

  const count = Number.parseInt(result.stdout, 10);
  return Number.isNaN(count) ? null : count;
}

function restoreWindowAfterExternalPlayer(appName, reason, source) {
  if (externalPlayerMonitor) {
    clearInterval(externalPlayerMonitor);
    externalPlayerMonitor = null;
  }

  if (!externalPlayerWindowHidden || isQuitting) return;

  externalPlayerWindowHidden = false;
  appendShortcutLog('external-player-restore-wrapper', { source, appName, reason });
  showMainWindow({ source: `external-player-${reason}`, appName });
}

function monitorExternalPlayer(appName, source) {
  if (externalPlayerMonitor) clearInterval(externalPlayerMonitor);

  const startedAt = Date.now();

  externalPlayerMonitor = setInterval(async () => {
    const elapsed = Date.now() - startedAt;
    const running = await isMacAppRunning(appName);

    if (!running) {
      restoreWindowAfterExternalPlayer(appName, 'process-ended', source);
      return;
    }

    const windowCount = await getMacAppWindowCount(appName);

    if (windowCount === 0 && elapsed > 8000) {
      restoreWindowAfterExternalPlayer(appName, 'window-closed', source);
    }
  }, 2000);
}

function hideWindowForExternalPlayer(appName, source) {
  if (process.platform !== 'darwin') return;
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;

  externalPlayerWindowHidden = true;
  appendShortcutLog('external-player-hide-wrapper', { source, appName, ...getWindowDebugState(mainWindow) });
  mainWindow.hide();
  updateTrayMenu();
}

function openUrlWithMacApp(appName, mediaUrl, source) {
  appendShortcutLog('external-player-open-app', { source, appName, url: mediaUrl });

  if (appName === 'IINA') hideWindowForExternalPlayer(appName, source);

  const launched = spawnDetached('/usr/bin/open', ['-a', appName, mediaUrl], 'external-player-open-app', {
    source,
    appName,
    url: mediaUrl,
  });

  if (launched) {
    setTimeout(() => resumeMacApp(appName, source), 1500);

    if (appName === 'IINA' && process.platform === 'darwin') {
      setTimeout(() => activateMacApp(appName, source), 600);
      setTimeout(() => activateMacApp(appName, source), 2500);
      monitorExternalPlayer(appName, source);
    }
  } else if (appName === 'IINA') {
    restoreWindowAfterExternalPlayer(appName, 'launch-failed', source);
  }

  return launched;
}

function openExternalPlayerUrl(rawUrl, source = 'unknown') {
  if (!isExternalPlayerUrl(rawUrl)) return false;

  const iinaMediaUrl = getIinaMediaUrl(rawUrl);
  if (process.platform === 'darwin' && iinaMediaUrl && fs.existsSync(iinaAppPath)) {
    openUrlWithMacApp('IINA', iinaMediaUrl, source);
    return true;
  }

  appendShortcutLog('external-player-open', { source, url: rawUrl });
  shell.openExternal(rawUrl).catch((error) => {
    appendShortcutLog('external-player-open-failed', {
      source,
      url: rawUrl,
      error: String(error?.message || error),
    });
  });

  return true;
}

function isLampaAppUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.hostname === 'lampa.mx' || url.hostname.endsWith('.lampa.mx');
  } catch {
    return false;
  }
}

function getPreferredLampaTorrentPlayer() {
  if (process.platform === 'darwin' && fs.existsSync(iinaAppPath)) return 'iina';
  return '';
}

function buildLampaTorrentPlayerScript(player) {
  return `
(() => {
  const preferred = ${JSON.stringify(player)};
  const key = 'player_torrent';
  const marker = 'tv_electron_default_player_torrent';

  const apply = () => {
    const storage = window.Lampa && window.Lampa.Storage;
    const current = storage && typeof storage.field === 'function'
      ? String(storage.field(key) || '')
      : String(window.localStorage.getItem(key) || '');

    if (current && current !== 'inner' && current !== 'lampa') {
      return { changed: false, current };
    }

    if (storage && typeof storage.set === 'function') storage.set(key, preferred);
    else window.localStorage.setItem(key, preferred);

    window.localStorage.setItem(marker, preferred);
    return { changed: true, player: preferred };
  };

  if (window.Lampa && window.Lampa.Storage) return apply();

  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (window.Lampa && window.Lampa.Storage) {
      window.clearInterval(timer);
      apply();
    }
    else if (attempts >= 80) window.clearInterval(timer);
  }, 250);

  return { scheduled: true, player: preferred };
})();
`;
}

function configureLampaTorrentPlayer(contents, source) {
  if (contents.isDestroyed()) return;

  const url = contents.getURL();
  const preferredPlayer = getPreferredLampaTorrentPlayer();
  if (!preferredPlayer || !isLampaAppUrl(url)) return;

  contents.executeJavaScript(buildLampaTorrentPlayerScript(preferredPlayer))
    .then((result) => {
      if (!result?.changed && !result?.scheduled) return;

      appendShortcutLog('external-player-default', {
        source,
        url,
        player: preferredPlayer,
        result,
      });
    })
    .catch((error) => {
      appendShortcutLog('external-player-default-failed', {
        source,
        url,
        player: preferredPlayer,
        error: String(error?.message || error),
      });
    });
}

function getNavigationUrl(detailsOrUrl) {
  if (typeof detailsOrUrl === 'string') return detailsOrUrl;
  return detailsOrUrl?.url || '';
}

function attachExternalPlayerHandlers(contents) {
  contents.on('will-navigate', (event, url) => {
    if (openExternalPlayerUrl(url, 'will-navigate')) event.preventDefault();
  });

  contents.on('will-frame-navigate', (event, details) => {
    if (openExternalPlayerUrl(getNavigationUrl(details), 'will-frame-navigate')) event.preventDefault();
  });

  contents.on('dom-ready', () => {
    configureLampaTorrentPlayer(contents, 'dom-ready');
  });

  contents.on('did-finish-load', () => {
    configureLampaTorrentPlayer(contents, 'did-finish-load');
  });

  if (typeof contents.setWindowOpenHandler === 'function') {
    contents.setWindowOpenHandler(({ url }) => {
      if (openExternalPlayerUrl(url, 'window-open')) return { action: 'deny' };
      return { action: 'allow' };
    });
  }
}

function readWindowMode() {
  try {
    if (fs.existsSync(windowModeFile)) {
      return JSON.parse(fs.readFileSync(windowModeFile, 'utf8'));
    }
  } catch {}
  return { fullscreen: true };
}

function writeWindowMode(fullscreen) {
  fs.mkdirSync(path.dirname(windowModeFile), { recursive: true });
  fs.writeFileSync(windowModeFile, JSON.stringify({ fullscreen: Boolean(fullscreen) }, null, 2), 'utf8');
}

function recreateWindowWithFullscreen(fullscreen) {
  writeWindowMode(fullscreen);
  if (mainWindow) {
    const oldWindow = mainWindow;
    mainWindow = null;
    try { oldWindow.destroy(); } catch {}
  }
  createWindow();
}

function toggleFullscreenMode(logContext = {}) {
  appendShortcutLog('toggle-fullscreen:start', { ...logContext, ...getWindowDebugState(mainWindow) });
  const nextFullscreen = !(readWindowMode().fullscreen !== false);
  recreateWindowWithFullscreen(nextFullscreen);
  const result = { ok: true, fullscreen: nextFullscreen, ...getWindowDebugState(mainWindow) };
  appendShortcutLog('toggle-fullscreen:end', { ...logContext, ...result });
  return result;
}

function shutdownOwnedServices() {
  stopTorrServer();
}

function quitImmediately(code = 0) {
  isQuitting = true;
  shutdownOwnedServices();
  app.exit(code);
}

function relaunchApp() {
  isQuitting = true;
  shutdownOwnedServices();
  app.relaunch();
  app.exit(0);
}

function handleShortcutAction(action, accelerator) {
  appendShortcutLog('global-shortcut', { accelerator, action, ...getWindowDebugState(mainWindow) });
  if (action === ACTIONS.QUIT) {
    try {
      if (mainWindow) mainWindow.destroy();
    } catch {}
    quitImmediately(0);
    return;
  }
  if (action === ACTIONS.TOGGLE_FULLSCREEN) {
    toggleFullscreenMode({ accelerator, source: 'global-shortcut' });
    return;
  }
  if (action === ACTIONS.TOGGLE_APP_MENU && mainWindow) {
    mainWindow.webContents.send('app-menu:toggle');
  }
}

function registerGlobalShortcuts() {
  GLOBAL_SHORTCUTS.forEach(({ accelerator, action }) => {
    const ok = globalShortcut.register(accelerator, () => handleShortcutAction(action, accelerator));
    appendShortcutLog('global-shortcut-register', { accelerator, action, ok });
  });
}

function getPreferredDisplay() {
  return screen.getAllDisplays().find((d) => !d.internal) || screen.getPrimaryDisplay();
}

function getWindowedBounds() {
  const display = getPreferredDisplay();
  const area = display.workArea;
  const width = Math.min(1600, area.width);
  const height = Math.min(900, area.height);

  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

function boundsIntersect(first, second) {
  return first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y;
}

function hasUsableWindowedBounds(bounds) {
  if (!bounds || bounds.width < 640 || bounds.height < 360) return false;
  return screen.getAllDisplays().some((display) => boundsIntersect(bounds, display.workArea));
}

function restoreUsableWindowedBounds(win, logContext = {}) {
  if (!win || win.isDestroyed() || readWindowMode().fullscreen !== false) return;

  const currentBounds = win.getBounds();
  if (hasUsableWindowedBounds(currentBounds)) return;

  const nextBounds = getWindowedBounds();
  appendShortcutLog('window-reset-bounds', { ...logContext, currentBounds, nextBounds });
  win.setBounds(nextBounds);
}

function createWindow() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const display = getPreferredDisplay();
  const displayArea = fullscreen => fullscreen ? display.bounds : getWindowedBounds();
  const mode = readWindowMode();
  const fullscreen = mode.fullscreen !== false;
  const simpleFullscreen = fullscreen && useSimpleFullscreenMode();
  const bounds = displayArea(fullscreen);

  mainWindow = new BrowserWindow({
    title: 'Lampa Wrapper',
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 640,
    minHeight: 360,
    icon: getWindowIconPath(),
    show: true,
    frame: !fullscreen,
    autoHideMenuBar: fullscreen,
    backgroundColor: '#000000',
    fullscreen: fullscreen && !simpleFullscreen,
    kiosk: false,
    simpleFullscreen,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    }
  });

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (!input) return;
    if (input.type === 'keyDown' || input.type === 'rawKeyDown' || input.type === 'keyUp') {
      appendShortcutLog('before-input-event', {
        type: input.type,
        key: input.key,
        code: input.code,
        isAutoRepeat: input.isAutoRepeat,
        shift: input.shift,
        control: input.control,
        alt: input.alt,
        meta: input.meta,
      });
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.focus();
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (fullscreen) setTimeout(() => applyFullscreenState(mainWindow, true), 300);
  else {
    restoreUsableWindowedBounds(mainWindow, { source: 'create-window' });
    mainWindow.show();
    mainWindow.focus();
  }
  mainWindow.on('leave-full-screen', () => {
    appendShortcutLog('window-leave-full-screen', { ...getWindowDebugState(mainWindow) });
    updateTrayMenu();
  });
  mainWindow.on('minimize', (event) => {
    if (!tray || isQuitting) return;
    event.preventDefault();
    hideMainWindowToTray({ source: 'window-minimize' });
  });
  mainWindow.on('close', (event) => {
    if (!tray || isQuitting) return;
    event.preventDefault();
    hideMainWindowToTray({ source: 'window-close' });
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    updateTrayMenu();
  });

  if (blockerId === null || !powerSaveBlocker.isStarted(blockerId)) {
    blockerId = powerSaveBlocker.start('prevent-display-sleep');
  }

  updateTrayMenu();
}

function startApp() {
  cleanObsoleteProfileData(userDataRoot);

  app.on('web-contents-created', (_event, contents) => {
    attachExternalPlayerHandlers(contents);
  });

  app.on('second-instance', () => {
    appendShortcutLog('app-second-instance', { ...getWindowDebugState(mainWindow) });
    showMainWindow({ source: 'second-instance' });
  });

  app.whenReady().then(() => {
    ensureLocalLampaRunning();
    ensureTorrServerRunning();
    createTray();
    createWindow();

    registerGlobalShortcuts();

    ipcMain.handle('lampa:ensure-running', () => ensureLocalLampaRunning());
    ipcMain.handle('app:get-shortcut-log-file', () => shortcutLogFile);
    ipcMain.handle('app:go-home', () => {
      if (mainWindow) mainWindow.loadFile('index.html');
      return { ok: true };
    });
    ipcMain.handle('viewer:log-event', (_event, payload = {}) => {
      appendJsonLog(viewerLogFile, payload);
      return { ok: true };
    });
    ipcMain.handle('app:restart', () => {
      relaunchApp();
    });
    ipcMain.handle('app:quit', () => {
      isQuitting = true;
      shutdownOwnedServices();
      app.quit();
    });
    ipcMain.handle('app:toggle-fullscreen', () => {
      return toggleFullscreenMode({ source: 'ipc' });
    });
    ipcMain.handle('app:clear-cache', async () => {
      if (cleanupInProgress) {
        return { ok: false, reason: 'cleanup-in-progress', removed: 0, errors: [] };
      }

      cleanupInProgress = true;
      try {
        await Promise.all(browserPartitions.map((partition) => session.fromPartition(partition).clearCache()));
        const results = cleanObsoleteProfileData(userDataRoot);
        const errors = results.filter((result) => result.error);
        return {
          ok: errors.length === 0,
          clearedPartitions: browserPartitions.length,
          removed: results.filter((result) => result.removed).length,
          errors,
        };
      } finally {
        cleanupInProgress = false;
      }
    });

    app.on('activate', () => {
      showMainWindow({ source: 'app-activate' });
    });
  });

  app.on('before-quit', () => {
    isQuitting = true;
    appendShortcutLog('app-before-quit', { ...getWindowDebugState(mainWindow) });
    shutdownOwnedServices();
  });

  app.on('will-quit', () => {
    appendShortcutLog('app-will-quit', {});
    shutdownOwnedServices();
    globalShortcut.unregisterAll();
  });

  app.on('window-all-closed', () => {
    if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
      powerSaveBlocker.stop(blockerId);
      blockerId = null;
    }
    if (process.platform !== 'darwin') app.quit();
  });
}

if (!gotSingleInstanceLock) {
  app.exit(0);
} else {
  startApp();
}
