const params = new URLSearchParams(window.location.search);
const url = params.get('url') || 'about:blank';
const webview = document.getElementById('webview');
const urlLabel = document.getElementById('urlLabel');
const homeBtn = document.getElementById('homeBtn');
const backBtn = document.getElementById('backBtn');
const reloadBtn = document.getElementById('reloadBtn');
const loader = document.getElementById('loader');
const loaderText = loader.querySelector('.loader-text');

async function logViewerEvent(event, extra = {}) {
  try {
    await window.tvAPI.viewerLogEvent({
      event,
      requestedUrl: url,
      currentUrl: (() => {
        try { return webview.getURL(); } catch { return null; }
      })(),
      ...extra,
    });
  } catch (error) {
    console.warn('viewer log failed', error);
  }
}

function showLoader(text = 'Загрузка...') {
  loaderText.textContent = text;
  loader.classList.remove('hidden');
}

function hideLoader() {
  loader.classList.add('hidden');
}

webview.src = url;
urlLabel.textContent = url;
showLoader('Открываем страницу...');
setTimeout(() => logViewerEvent('viewer-init', { url }), 0);

homeBtn.addEventListener('click', () => window.tvAPI.goHome());
backBtn.addEventListener('click', () => webview.canGoBack() ? webview.goBack() : window.tvAPI.goHome());
reloadBtn.addEventListener('click', () => {
  showLoader('Обновляем страницу...');
  webview.reload();
});

window.addEventListener('keydown', (e) => {
  const ctrlOrCmd = e.ctrlKey || e.metaKey;
  if (ctrlOrCmd && e.key.toLowerCase() === 'h') {
    e.preventDefault();
    e.stopPropagation();
    window.tvAPI.goHome();
  } else if (ctrlOrCmd && e.key === '[') {
    e.preventDefault();
    e.stopPropagation();
    webview.canGoBack() ? webview.goBack() : window.tvAPI.goHome();
  } else if (ctrlOrCmd && e.key.toLowerCase() === 'r') {
    e.preventDefault();
    e.stopPropagation();
    showLoader('Обновляем страницу...');
    webview.reload();
  }
}, true);

webview.addEventListener('did-start-loading', () => {
  const current = webview.getURL() || url;
  urlLabel.textContent = current;
  showLoader('Загрузка...');
  logViewerEvent('did-start-loading', { currentUrl: current });
});

webview.addEventListener('dom-ready', async () => {
  try {
    const info = await webview.executeJavaScript(`
      (() => {
        const ua = navigator.userAgent;
        const isTv = /SMART-TV|Tizen|Web0S|Android TV|BRAVIA/i.test(ua);
        if (isTv) {
          try {
            Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0, configurable: true });
          } catch {}
          document.documentElement.classList.add('tv-user-agent');
        }
        return { ua, isTv, title: document.title, href: location.href };
      })();
    `, true);
    await logViewerEvent('dom-ready', info || {});
  } catch (error) {
    console.warn('viewer dom-ready injection failed', error);
    logViewerEvent('dom-ready-error', { error: String(error?.message || error) });
  }
  hideLoader();
});

webview.addEventListener('did-stop-loading', async () => {
  const current = webview.getURL() || url;
  urlLabel.textContent = current;
  hideLoader();
  let title = null;
  try { title = await webview.getTitle(); } catch {}
  logViewerEvent('did-stop-loading', { currentUrl: current, title });
});

webview.addEventListener('did-fail-load', (event) => {
  console.error('webview did-fail-load', event.errorCode, event.errorDescription, event.validatedURL);
  logViewerEvent('did-fail-load', {
    errorCode: event.errorCode,
    errorDescription: event.errorDescription,
    validatedURL: event.validatedURL,
  });
  showLoader(`Не удалось загрузить: ${event.errorDescription || 'ошибка сети'}`);
});

webview.addEventListener('did-navigate', (event) => {
  urlLabel.textContent = event.url || webview.getURL() || url;
  logViewerEvent('did-navigate', { url: event.url, isMainFrame: event.isMainFrame });
});

webview.addEventListener('did-navigate-in-page', (event) => {
  urlLabel.textContent = event.url || webview.getURL() || url;
  logViewerEvent('did-navigate-in-page', { url: event.url, isMainFrame: event.isMainFrame });
});

webview.addEventListener('page-title-updated', (event) => {
  logViewerEvent('page-title-updated', { title: event.title, explicitSet: event.explicitSet });
});
