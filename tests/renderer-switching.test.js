const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add: (...items) => items.forEach((item) => classes.add(item)),
    remove: (...items) => items.forEach((item) => classes.delete(item)),
    contains: (item) => classes.has(item),
    toggle: (item, force) => {
      const enabled = force === undefined ? !classes.has(item) : Boolean(force);
      if (enabled) classes.add(item);
      else classes.delete(item);
      return enabled;
    },
  };
}

function createElement(id, initialClasses = []) {
  return {
    id,
    attributes: {},
    classList: createClassList(initialClasses),
    listeners: {},
    textContent: '',
    addEventListener(event, listener) {
      this.listeners[event] = listener;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    focus() {
      this.focused = true;
    },
  };
}

function createWebview(id) {
  const element = createElement(id, ['hidden']);
  let src = '';
  element.loadedUrls = [];
  element.stopCalls = 0;
  Object.defineProperty(element, 'src', {
    get: () => src,
    set: (url) => {
      src = url;
      element.loadedUrls.push(url);
    },
  });
  element.stop = () => {
    element.stopCalls += 1;
  };
  return element;
}

function createRendererHarness() {
  let resolveLampa;
  const lampaReady = new Promise((resolve) => {
    resolveLampa = resolve;
  });
  const elements = {
    lampaWebview: createWebview('lampaWebview'),
    youtubeWebview: createWebview('youtubeWebview'),
    kinopoiskWebview: createWebview('kinopoiskWebview'),
    loader: createElement('loader'),
    errorBox: createElement('errorBox', ['hidden']),
    statusText: createElement('statusText'),
    errorText: createElement('errorText'),
    retryBtn: createElement('retryBtn'),
    restartBtn: createElement('restartBtn'),
    appMenu: createElement('appMenu', ['hidden']),
  };
  const tiles = ['lampa', 'youtube', 'kinopoisk'].map((appId) => ({
    ...createElement(`${appId}Tile`),
    dataset: { app: appId },
  }));
  const context = {
    console,
    document: {
      getElementById: (id) => elements[id],
      querySelectorAll: (selector) => (selector === '.app-menu-tile' ? tiles : []),
    },
    window: {
      addEventListener() {},
      tvAPI: {
        ensureLampa: () => lampaReady,
        onAppMenuToggle() {},
        quit: async () => {},
        restart: async () => {},
        toggleFullscreen: async () => {},
      },
      tvShortcuts: {
        ACTIONS: {
          QUIT: 'quit',
          TOGGLE_APP_MENU: 'toggle-app-menu',
          TOGGLE_FULLSCREEN: 'toggle-fullscreen',
        },
        getShortcutAction: () => null,
      },
    },
  };
  context.globalThis = context;

  const rendererPath = path.join(__dirname, '..', 'renderer.js');
  const source = `${fs.readFileSync(rendererPath, 'utf8')}\n` +
    'globalThis.__renderer = { apps, switchApp, get activeAppId() { return activeAppId; } };';
  vm.runInNewContext(source, context, { filename: rendererPath });

  return {
    apps: context.__renderer.apps,
    elements,
    resolveLampa,
    switchApp: context.__renderer.switchApp,
  };
}

test('switching apps closes the previous webview page', () => {
  const harness = createRendererHarness();

  harness.switchApp('kinopoisk');
  harness.switchApp('youtube');

  assert.equal(harness.apps.kinopoisk.loaded, false);
  assert.equal(harness.apps.kinopoisk.ready, false);
  assert.equal(harness.elements.kinopoiskWebview.stopCalls, 1);
  assert.deepEqual(
    harness.elements.kinopoiskWebview.loadedUrls,
    ['https://hd.kinopoisk.ru/', 'about:blank'],
  );
  assert.deepEqual(harness.elements.youtubeWebview.loadedUrls, ['https://www.youtube.com/']);
});

test('late Lampa startup does not open a hidden webview after switching away', async () => {
  const harness = createRendererHarness();

  harness.switchApp('youtube');
  harness.resolveLampa({ ok: true, url: 'http://127.0.0.1:8099/' });
  await Promise.resolve();

  assert.equal(harness.apps.lampa.loaded, false);
  assert.equal(harness.elements.lampaWebview.stopCalls, 0);
  assert.deepEqual(harness.elements.lampaWebview.loadedUrls, []);
});
