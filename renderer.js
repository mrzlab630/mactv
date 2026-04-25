const LAMPA_URL = 'http://127.0.0.1:8099/';

const webview = document.getElementById('webview');
const loader = document.getElementById('loader');
const errorBox = document.getElementById('errorBox');
const statusText = document.getElementById('statusText');
const errorText = document.getElementById('errorText');
const retryBtn = document.getElementById('retryBtn');
const restartBtn = document.getElementById('restartBtn');
const { ACTIONS, getShortcutAction } = window.tvShortcuts;

function showLoader(text) {
  statusText.textContent = text;
  loader.classList.remove('hidden');
  errorBox.classList.add('hidden');
  webview.classList.add('hidden');
}

function showError(text) {
  errorText.textContent = text;
  loader.classList.add('hidden');
  errorBox.classList.remove('hidden');
  webview.classList.add('hidden');
}

function showWebview() {
  loader.classList.add('hidden');
  errorBox.classList.add('hidden');
  webview.classList.remove('hidden');
}

async function boot() {
  showLoader('Проверяем локальную Lampa...');
  try {
    const state = await window.tvAPI.ensureLampa();
    if (!state?.ok) {
      showError(`Lampa недоступна: ${state?.reason || 'unknown error'}`);
      return;
    }

    showLoader(`Открываем ${state.url || LAMPA_URL}`);
    webview.src = state.url || LAMPA_URL;
  } catch (error) {
    console.error('boot failed', error);
    showError(String(error?.message || error));
  }
}

webview.addEventListener('dom-ready', () => {
  showWebview();
});

webview.addEventListener('did-fail-load', (event) => {
  if (event.errorCode === -3) return;
  console.error('webview did-fail-load', event);
  showError(`${event.errorDescription || 'load failed'} (${event.errorCode})`);
});

retryBtn.addEventListener('click', boot);
restartBtn.addEventListener('click', async () => {
  await window.tvAPI.restart();
});

function logKeyEvent(kind, e) {
  console.log(`[shortcut] ${kind}`, { key: e.key, code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey });
}

window.addEventListener('keydown', async (e) => {
  logKeyEvent('keydown', e);
  const action = getShortcutAction(e);
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
  if (e.key === 'F5') webview.reload();
}, true);

window.addEventListener('keyup', (e) => {
  logKeyEvent('keyup', e);
}, true);

boot();
