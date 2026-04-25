const { app, BrowserWindow, ipcMain, powerSaveBlocker, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { ensureManagedServiceRunning, stopManagedService } = require('./managed-service');
const { ACTIONS, GLOBAL_SHORTCUTS } = require('./shortcuts');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');

let mainWindow;
let blockerId = null;
let torrServerRuntime = null;

const userDataRoot = path.join(app.getPath('home'), '.openclaw', 'workspace', '.tv-electron-mvp-user-data');
app.setPath('userData', userDataRoot);

const localAppsDir = path.join(app.getPath('home'), '.openclaw', 'workspace', '.tv-local-apps');
const localLampaDir = path.join(localAppsDir, 'lampa');
const localLampaPidFile = path.join(localAppsDir, 'lampa-server.pid');
const localLampaLogFile = path.join(localAppsDir, 'lampa-server.log');
const localLampaPort = 8099;
const localLampaUrl = `http://127.0.0.1:${localLampaPort}/`;
const torrServerPort = 8090;
const torrServerUrl = `http://127.0.0.1:${torrServerPort}/`;
const shortcutLogFile = path.join(userDataRoot, 'shortcut-events.log');
const viewerLogFile = path.join(userDataRoot, 'viewer-events.log');
const windowModeFile = path.join(userDataRoot, 'window-mode.json');
const DEBUG_SHORTCUTS = false;

function getResourcePath(...segments) {
  if (app.isPackaged) return path.join(process.resourcesPath, ...segments);
  return path.join(__dirname, ...segments);
}

function getLocalLampaService() {
  return {
    name: 'Lampa',
    command: 'python3',
    args: ['-m', 'http.server', String(localLampaPort), '--directory', localLampaDir],
    cwd: localAppsDir,
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
  fs.mkdirSync(localAppsDir, { recursive: true });
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

function getWindowDebugState(win) {
  if (!win) return { hasWindow: false };
  const bounds = win.getBounds();
  return {
    hasWindow: true,
    fullscreen: win.isFullScreen(),
    focused: win.isFocused(),
    visible: win.isVisible(),
    minimized: win.isMinimized(),
    kiosk: win.isKiosk(),
    simpleFullscreen: win.isSimpleFullScreen ? win.isSimpleFullScreen() : undefined,
    bounds,
  };
}

function applyFullscreenState(win, fullscreen) {
  if (!win) return;
  appendShortcutLog('apply-fullscreen-state:before', { requested: fullscreen, ...getWindowDebugState(win) });
  win.setAutoHideMenuBar(Boolean(fullscreen));
  win.setMenuBarVisibility(!fullscreen);
  if (fullscreen) {
    win.show();
    win.focus();
    win.setFullScreen(true);
  } else {
    win.setFullScreen(false);
    win.setBounds({ x: 0, y: 0, width: 1600, height: 900 });
    win.show();
    win.focus();
  }
  appendShortcutLog('apply-fullscreen-state:after', { requested: fullscreen, ...getWindowDebugState(win) });
}

function appendShortcutLog(event, payload = {}) {
  if (!DEBUG_SHORTCUTS && !String(event).startsWith('global-shortcut-register')) return;
  appendJsonLog(shortcutLogFile, { event, ...payload });
}

function appendJsonLog(file, payload = {}) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...payload }) + '\n', 'utf8');
  } catch {}
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
  shutdownOwnedServices();
  app.exit(code);
}

function relaunchApp() {
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
  }
}

function registerGlobalShortcuts() {
  GLOBAL_SHORTCUTS.forEach(({ accelerator, action }) => {
    const ok = globalShortcut.register(accelerator, () => handleShortcutAction(action, accelerator));
    appendShortcutLog('global-shortcut-register', { accelerator, action, ok });
  });
}

function createWindow() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const externalDisplay = screen.getAllDisplays().find((d) => !d.internal);
  const mode = readWindowMode();
  const fullscreen = mode.fullscreen !== false;

  mainWindow = new BrowserWindow({
    title: 'Lampa Wrapper',
    x: externalDisplay ? externalDisplay.bounds.x : undefined,
    y: externalDisplay ? externalDisplay.bounds.y : undefined,
    width: externalDisplay ? externalDisplay.bounds.width : 1600,
    height: externalDisplay ? externalDisplay.bounds.height : 900,
    show: true,
    frame: !fullscreen,
    autoHideMenuBar: fullscreen,
    backgroundColor: '#000000',
    fullscreen,
    kiosk: false,
    simpleFullscreen: false,
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
    mainWindow.setBounds({ x: 80, y: 80, width: 1600, height: 900 });
    mainWindow.center();
    mainWindow.show();
    mainWindow.focus();
  }
  mainWindow.on('leave-full-screen', () => {
    appendShortcutLog('window-leave-full-screen', { ...getWindowDebugState(mainWindow) });
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (blockerId === null || !powerSaveBlocker.isStarted(blockerId)) {
    blockerId = powerSaveBlocker.start('prevent-display-sleep');
  }
}

app.whenReady().then(() => {
  ensureLocalLampaRunning();
  ensureTorrServerRunning();
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
    shutdownOwnedServices();
    app.quit();
  });
  ipcMain.handle('app:toggle-fullscreen', () => {
    return toggleFullscreenMode({ source: 'ipc' });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
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
