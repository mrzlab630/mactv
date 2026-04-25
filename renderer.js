const LAMPA_URL = 'http://127.0.0.1:8099/';
const YOUTUBE_URL = 'https://www.youtube.com/';
const KINOPOISK_URL = 'https://hd.kinopoisk.ru/';
const EMPTY_PAGE_URL = 'about:blank';

const lampaWebview = document.getElementById('lampaWebview');
const youtubeWebview = document.getElementById('youtubeWebview');
const kinopoiskWebview = document.getElementById('kinopoiskWebview');
const loader = document.getElementById('loader');
const errorBox = document.getElementById('errorBox');
const statusText = document.getElementById('statusText');
const errorText = document.getElementById('errorText');
const retryBtn = document.getElementById('retryBtn');
const restartBtn = document.getElementById('restartBtn');
const appMenu = document.getElementById('appMenu');
const appMenuTiles = Array.from(document.querySelectorAll('.app-menu-tile'));
const { ACTIONS, getShortcutAction } = window.tvShortcuts;

const apps = {
  lampa: {
    id: 'lampa',
    name: 'Lampa',
    webview: lampaWebview,
    loaded: false,
    ready: false,
  },
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    webview: youtubeWebview,
    loaded: false,
    ready: false,
    url: YOUTUBE_URL,
  },
  kinopoisk: {
    id: 'kinopoisk',
    name: 'Кинопоиск',
    webview: kinopoiskWebview,
    loaded: false,
    ready: false,
    url: KINOPOISK_URL,
  },
};

let activeAppId = 'lampa';
let selectedMenuIndex = 0;
let lastMenuToggleAt = 0;
const MENU_COLUMNS = 2;

function activeApp() {
  return apps[activeAppId];
}

function hideWebviews() {
  Object.values(apps).forEach((app) => app.webview.classList.add('hidden'));
}

function showLoader(text) {
  statusText.textContent = text;
  loader.classList.remove('hidden');
  errorBox.classList.add('hidden');
  hideWebviews();
}

function showError(text) {
  errorText.textContent = text;
  loader.classList.add('hidden');
  errorBox.classList.remove('hidden');
  hideWebviews();
}

function showActiveWebview() {
  const app = activeApp();
  loader.classList.add('hidden');
  errorBox.classList.add('hidden');
  hideWebviews();
  app.webview.classList.remove('hidden');
  try { app.webview.focus(); } catch {}
}

function markLoading(appId) {
  apps[appId].ready = false;
  if (activeAppId === appId) showLoader(`Открываем ${apps[appId].name}...`);
}

function navigateWebview(app, url) {
  app.webview.src = url;
}

function closeAppPage(appId) {
  const app = apps[appId];
  if (!app) return;
  const hasPage = app.loaded || app.ready || Boolean(app.webview.src);

  app.loaded = false;
  app.ready = false;
  app.unloading = true;
  app.webview.classList.add('hidden');

  if (!hasPage) return;

  try { app.webview.stop(); } catch {}
  navigateWebview(app, EMPTY_PAGE_URL);
}

async function bootLampa() {
  if (activeAppId === 'lampa') showLoader('Проверяем локальную Lampa...');
  try {
    const state = await window.tvAPI.ensureLampa();
    if (!state?.ok) {
      if (activeAppId === 'lampa') showError(`Lampa недоступна: ${state?.reason || 'unknown error'}`);
      return;
    }

    if (activeAppId !== 'lampa') return;

    apps.lampa.url = state.url || LAMPA_URL;
    apps.lampa.unloading = false;
    apps.lampa.loaded = true;
    markLoading('lampa');
    navigateWebview(apps.lampa, apps.lampa.url);
  } catch (error) {
    console.error('boot failed', error);
    if (activeAppId === 'lampa') showError(String(error?.message || error));
  }
}

function loadWebApp(appId) {
  const app = apps[appId];
  if (!app.loaded) {
    app.unloading = false;
    app.loaded = true;
    markLoading(appId);
    navigateWebview(app, app.url);
    return;
  }

  if (app.ready) showActiveWebview();
  else showLoader(`Открываем ${app.name}...`);
}

function switchApp(appId) {
  if (!apps[appId]) return;
  const previousAppId = activeAppId;
  activeAppId = appId;
  closeAppMenu();
  if (previousAppId !== appId) closeAppPage(previousAppId);

  if (appId === 'lampa') {
    if (apps.lampa.ready) showActiveWebview();
    else if (apps.lampa.loaded) showLoader('Открываем Lampa...');
    else bootLampa();
    return;
  }

  loadWebApp(appId);
}

function setMenuSelection(index) {
  selectedMenuIndex = (index + appMenuTiles.length) % appMenuTiles.length;
  appMenuTiles.forEach((tile, tileIndex) => {
    const selected = tileIndex === selectedMenuIndex;
    tile.classList.toggle('selected', selected);
    tile.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
  appMenuTiles[selectedMenuIndex].focus();
}

function syncMenuSelection(index) {
  selectedMenuIndex = index;
  appMenuTiles.forEach((tile, tileIndex) => {
    const selected = tileIndex === selectedMenuIndex;
    tile.classList.toggle('selected', selected);
    tile.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
}

function openAppMenu() {
  selectedMenuIndex = Math.max(0, appMenuTiles.findIndex((tile) => tile.dataset.app === activeAppId));
  appMenu.classList.remove('hidden');
  appMenu.setAttribute('aria-hidden', 'false');
  setMenuSelection(selectedMenuIndex);
}

function closeAppMenu() {
  appMenu.classList.add('hidden');
  appMenu.setAttribute('aria-hidden', 'true');
  try { activeApp().webview.focus(); } catch {}
}

function toggleAppMenu() {
  const now = Date.now();
  if (now - lastMenuToggleAt < 200) return;
  lastMenuToggleAt = now;

  if (appMenu.classList.contains('hidden')) openAppMenu();
  else closeAppMenu();
}

function handleMenuKey(e) {
  if (appMenu.classList.contains('hidden')) return false;

  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    e.stopPropagation();
    setMenuSelection(selectedMenuIndex - 1);
    return true;
  }

  if (e.key === 'ArrowRight') {
    e.preventDefault();
    e.stopPropagation();
    setMenuSelection(selectedMenuIndex + 1);
    return true;
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    e.stopPropagation();
    setMenuSelection(selectedMenuIndex - MENU_COLUMNS);
    return true;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    e.stopPropagation();
    setMenuSelection(selectedMenuIndex + MENU_COLUMNS);
    return true;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    switchApp(appMenuTiles[selectedMenuIndex].dataset.app);
    return true;
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeAppMenu();
    return true;
  }

  return false;
}

function bindWebview(appId) {
  const app = apps[appId];
  app.webview.addEventListener('did-start-loading', () => {
    if (app.unloading) {
      app.ready = false;
      return;
    }
    markLoading(appId);
  });

  app.webview.addEventListener('did-stop-loading', () => {
    if (app.unloading) {
      app.ready = false;
      return;
    }
    app.ready = true;
    if (activeAppId === appId) showActiveWebview();
  });

  app.webview.addEventListener('did-fail-load', (event) => {
    if (app.unloading) return;
    if (event.errorCode === -3) return;
    console.error(`${app.name} did-fail-load`, event);
    if (activeAppId === appId) {
      showError(`${app.name}: ${event.errorDescription || 'load failed'} (${event.errorCode})`);
    }
  });
}

retryBtn.addEventListener('click', () => {
  const app = activeApp();
  app.loaded = false;
  app.ready = false;
  if (activeAppId === 'lampa') bootLampa();
  else loadWebApp(activeAppId);
});

restartBtn.addEventListener('click', async () => {
  await window.tvAPI.restart();
});

appMenuTiles.forEach((tile, index) => {
  tile.addEventListener('click', () => switchApp(tile.dataset.app));
  tile.addEventListener('focus', () => syncMenuSelection(index));
});

function logKeyEvent(kind, e) {
  console.log(`[shortcut] ${kind}`, { key: e.key, code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey });
}

window.tvAPI.onAppMenuToggle(toggleAppMenu);

window.addEventListener('keydown', async (e) => {
  logKeyEvent('keydown', e);
  const action = getShortcutAction(e);

  if (handleMenuKey(e)) return;

  if (action === ACTIONS.TOGGLE_APP_MENU) {
    e.preventDefault();
    e.stopPropagation();
    toggleAppMenu();
    return;
  }
  if (action === ACTIONS.QUIT) {
    e.preventDefault();
    e.stopPropagation();
    await window.tvAPI.quit();
    return;
  }
  if (action === ACTIONS.TOGGLE_FULLSCREEN) {
    e.preventDefault();
    e.stopPropagation();
    await window.tvAPI.toggleFullscreen();
    return;
  }
  if (e.key === 'F5') activeApp().webview.reload();
}, true);

window.addEventListener('keyup', (e) => {
  logKeyEvent('keyup', e);
}, true);

Object.keys(apps).forEach(bindWebview);
bootLampa();
