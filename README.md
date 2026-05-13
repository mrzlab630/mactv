# Lampa Wrapper

Electron-приложение для macOS, которое запускает локальную Lampa в полноэкранной ТВ-оболочке и держит рядом сервисы, нужные для домашнего медиаплеера. Основной сценарий: включить Mac mini/ноутбук у телевизора, получить крупный интерфейс с Lampa, YouTube и Кинопоиском, управлять им с клавиатуры или пульта, а приложение оставить в tray.

## Что умеет приложение

- Поднимает локальную Lampa из каталога `~/.openclaw/workspace/.tv-local-apps/lampa` на `http://127.0.0.1:8099/`.
- Поднимает bundled `TorrServer` на `http://127.0.0.1:8090/` и останавливает только тот процесс, который запустило само.
- Открывает Lampa, YouTube и Кинопоиск в отдельных persistent webview-разделах.
- Даёт ТВ-меню приложений, стартовую подсказку по клавишам, очистку кэша и отдельный оконный/полноэкранный режим.
- Работает как single-instance приложение: повторный запуск показывает уже открытое окно.
- Создаёт tray-иконку с командами показать/скрыть окно, переключить fullscreen, перезапустить и выйти.
- Может поставить macOS LaunchAgent для автозапуска.

## Состав проекта

| Путь | Назначение |
| --- | --- |
| `main.js` | Main process Electron: окно, tray, single-instance, fullscreen, power-save blocker, IPC, глобальные горячие клавиши, запуск Lampa и TorrServer. |
| `index.html`, `renderer.js`, `styles.css` | Основной ТВ-интерфейс: webview-приложения, меню выбора, стартовая справка, перезагрузка и очистка кэша. |
| `preload.js` | Безопасный bridge между renderer и main process через `contextBridge`. |
| `shortcuts.js` | Общая карта действий и горячих клавиш для renderer и Electron `globalShortcut`. |
| `managed-service.js` | Универсальный запуск локального сервиса: проверка файлов, health-check через HTTP, pid-файл, лог, остановка owned process group. |
| `profile-cleanup.js` | Очистка кэшей Electron-профиля без удаления cookies, IndexedDB, Local Storage и других persistent данных. |
| `viewer.html`, `viewer.js` | Отдельный webview-viewer с кнопками домой/назад/обновить и логированием событий загрузки. |
| `scripts/autostart.js` | Установка, удаление и проверка LaunchAgent для автозапуска на macOS. |
| `TorrServer` | Bundled бинарник TorrServer для локального torrent/http сервиса. |
| `bin/v2ray`, `proxy-profiles/`, `proxy-runtime/` | Bundled V2Ray и конфиги proxy. Сейчас эти ресурсы попадают в сборку, но приложение не запускает V2Ray автоматически. |
| `assets/` | Иконки приложения и tray. |
| `tests/` | Node test suite для shortcuts, renderer switching, service manager и очистки профиля. |
| `PLAN.md` | Небольшой backlog: например, возврат Okko после решения DRM/Widevine. |

## Требования

- macOS.
- Node.js и npm.
- `python3`: используется для локального HTTP-сервера Lampa.
- `curl`: используется health-check логикой локальных сервисов.
- Локальная сборка Lampa с файлом `index.html` в каталоге `~/.openclaw/workspace/.tv-local-apps/lampa`.

Bundled бинарники `TorrServer` и `bin/v2ray` сейчас лежат как Mach-O x86_64. На Apple Silicon может понадобиться Rosetta.

## Установка для разработки

```sh
npm ci
```

Подготовьте локальную Lampa:

```sh
mkdir -p ~/.openclaw/workspace/.tv-local-apps/lampa
# положите файлы Lampa так, чтобы существовал:
# ~/.openclaw/workspace/.tv-local-apps/lampa/index.html
```

Запуск из исходников:

```sh
npm start
```

Если есть проблемы с GPU/compositing:

```sh
TV_ELECTRON_DISABLE_GPU=1 npm start
```

или:

```sh
npm start -- --disable-gpu-rendering
```

## Сборка

```sh
npm run build:mac
```

Сборка использует `electron-builder` и target `dir`; результат появляется в `dist/`. В package включаются JS/HTML/CSS файлы, иконки, `TorrServer`, `bin/`, `proxy-profiles/` и `proxy-runtime/config.base.json`.

После сборки можно перенести `.app` в `/Applications`, если нужен системный запуск и автозапуск через LaunchAgent.

## Автозапуск

По умолчанию скрипт ждёт приложение здесь:

```text
/Applications/Lampa Wrapper.app
```

Установить LaunchAgent:

```sh
npm run autostart:install
```

Установить LaunchAgent для другого пути:

```sh
node scripts/autostart.js install "/path/to/Lampa Wrapper.app"
```

Проверить статус:

```sh
npm run autostart:status
```

Удалить автозапуск:

```sh
npm run autostart:remove
```

LaunchAgent хранится в `~/Library/LaunchAgents/com.stepan.lampawrapper.plist`, логи автозапуска пишутся в `~/Library/Logs/Lampa Wrapper/`.

## Как использовать

При старте приложение:

1. Очищает устаревшие кэши и старый раздел `okko`.
2. Проверяет локальную Lampa на `127.0.0.1:8099`; если её нет, запускает `python3 -m http.server` из `~/.openclaw/workspace/.tv-local-apps/lampa`.
3. Проверяет TorrServer на `127.0.0.1:8090`; если его нет, запускает bundled `TorrServer`.
4. Открывает полноэкранное окно с Lampa.

Горячие клавиши:

| Клавиша | Действие |
| --- | --- |
| `F8` или `Shift+8` | Открыть/закрыть меню приложений. |
| `F9` или `Shift+9` | Выйти из приложения. |
| `F10` или `Shift+0` | Переключить полноэкранный и оконный режим. |
| `F5` | Перезагрузить активную webview-страницу. |
| `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight` | Навигация по меню приложений. |
| `Enter` | Выбрать пункт меню. |
| `Esc` | Закрыть меню или стартовую подсказку. |

Пункты меню приложений:

- `Lampa`
- `YouTube`
- `Кинопоиск`
- `Очистить кэш`

При переключении приложений предыдущая webview-страница закрывается и уводится на `about:blank`, чтобы снизить нагрузку и не оставлять фоновое воспроизведение.

## Runtime-данные и логи

Основной Electron-профиль хранится в:

```text
~/.openclaw/workspace/.tv-electron-mvp-user-data
```

Внутри него находятся:

- `window-mode.json` - сохранённый режим окна.
- `shortcut-events.log` - служебные события приложения, tray и горячих клавиш.
- `viewer-events.log` - события загрузки отдельного viewer.
- `torrserver.pid` - pid запущенного TorrServer, если он был создан приложением.
- `logs/torrserver*.log` - логи TorrServer.

Локальная Lampa и её pid/log лежат отдельно:

```text
~/.openclaw/workspace/.tv-local-apps/lampa
~/.openclaw/workspace/.tv-local-apps/lampa-server.pid
~/.openclaw/workspace/.tv-local-apps/lampa-server.log
```

## Тесты

```sh
npm test
```

Покрыты:

- соответствие горячих клавиш действиям;
- переключение webview-приложений и очистка кэша в renderer;
- запуск и остановка managed services;
- безопасная очистка кэшей профиля.

## Диагностика

- `Lampa недоступна: missing-files` означает, что не найден `~/.openclaw/workspace/.tv-local-apps/lampa/index.html`.
- Если Lampa или TorrServer не стартуют, проверьте, не заняты ли порты `8099` и `8090`.
- Если окно не открывается корректно на внешнем дисплее, переключите режим `F10`/`Shift+0`; приложение сбрасывает непригодные оконные bounds.
- Если webview ведёт себя нестабильно после обновлений Electron, используйте `Очистить кэш` в меню приложений.
- Для проблем рендера попробуйте запуск с `TV_ELECTRON_DISABLE_GPU=1`.
