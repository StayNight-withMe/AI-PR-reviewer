# STATUS — pr-review-mcp
Обновлено: 2026-11-24. Внесённые ниже изменения пока НЕ закоммичены, пуш НЕ делался.
Ветка: `feature/review-threads-and-ui-hardening`.

## Проверка Visual Studio 2026-11-24
- Кандидат `0.1.11` собран (`npm run build:vsix:vs`); полный `npm run test:all` завершился с кодом 0. Путь к пакету: `editors/visualstudio/bin/Release/net48/PrReview.VisualStudio.vsix`.
- Кнопка на стандартной панели подтверждена в изолированном профиле `PrReviewTest`: команда `PRReview.PRReview` (id 256) доступна, контрол `PR Review` на панели `Standard` виден и включён. Пользователь подтвердил, что кнопка открывает вкладку ревью. Для проверки ставился отдельный пакет с идентификатором `PrReview.VisualStudio.Dev`, чтобы не конфликтовать с машинной копией.
- Ширина WebView2 и отсутствие обрезки diff на этой сборке в IDE ещё не измерены; раскладка 655/1000/1440 px покрыта браузерным тестом `tests/layout-regression.mjs` (26/26: без бокового скролла, без внутренней обрезки панели, перенос длинных строк, дерево скрывается, сайдбар рядом на широком экране).
- Установка `/admin /rootSuffix:PrReviewTest` заменила общемашинную копию на `0.1.10`. Попытка отката затронула обычный профиль: удалена пользовательская `0.1.9`, а машинная `0.1.10` осталась. Восстановление не выполнялось. Не запускать установщик повторно без согласования области изменений. Журналы: `isolated-install-admin.log` и `uninstall-machine.log` в `Z:\system\temp\pr-review-ide`.

## Публикация в GitHub из страницы ревью 2026-11-24
- Кнопка `Publish to GitHub` в диалоге Submit работает только для ревью pull request и только из полного вида PR; локальный submit остаётся отдельной кнопкой `Submit locally`.
- Для PR по умолчанию выбран вердикт `Comment`, чтобы заметки не блокировали PR случайно.
- Повторный клик не дублирует уже отправленные комментарии; при отказе GitHub диалог остаётся открытым с текстом и комментариями, причина показывается, кнопка снова активна.
- Отметка «опубликовано» хранится вместе с комментарием на сервере: переоткрытое ревью не предлагает отправить то же самое повторно.
- Ревью закрепляется за `commit_id` PR head: push во время ревью не делает все комментарии «устаревшими».
- PR диффится от merge-base: если main ушёл вперёд, его собственные коммиты больше не показываются как удаления PR, и номера строк совпадают с GitHub.
- Устаревший комментарий (строка изменилась) не отправляется инлайном — GitHub отклонил бы всё ревью с 422; его текст уходит в тело. Комментарии сверх лимита 100 тоже переносятся в тело, ничего не теряется.
- Скриншоты в комментариях остаются в локальном ревью: GitHub принимает только текст.
- Проверено: `npm run test:pr:ui` — 13/13, `test:publish` — 13/13, `test:pr` — все, включая merge-base; полный `npm run test:all` — код 0.
- Сверка с реальным GitHub: `cli/go-gh#320` — совпали head SHA `8106ea9`, файл `.github/workflows/codeql-analysis.yml` и `+2/−2`. Реальная отправка ревью в чужой PR не выполнялась.

## Отступ дерева файлов
- Стандартный `Tree indent (px)` теперь `4` (было `16`): `DEFAULT_INDENT`, начальное состояние страницы, CSS-фолбэк и подсказка в поле. Покрыто `tests/settings-persistence.mjs` и `tests/regressions.mjs`.

## Цель
Довести pr-review-mcp до полноценного продукта: UI и логика ревью (resolve,
outdated, связь ревью), цикл «человек → нейронка → снова», настоящие интеграции
в IDE (VS Code, Visual Studio, JetBrains) — не только через MCP-агента.
Пользователь требует: работать и тестировать без лишних вопросов, визуально
(реальный редактор/браузер, не только тесты), не оставлять мусора (окна, temp),
не пушить и не релизить без явной просьбы.

## Коммиты (сверху вниз)
```
adb2d69 test: prevent Visual Studio assembly shadowing
8035ad2 fix: avoid Visual Studio assembly shadowing in the VSIX
667c22f feat: test the VS Code extension inside a real editor
6e70d1e fix: keep the header one line in a narrow tab
c8bddf0 fix: find a base in a repository that has no remote
7dd612a fix: ship the engine inside the JetBrains plugin
1a65dcc feat: build an installable Visual Studio package
f846e00 fix: keep a comment's state explicit, and cover the whole review cycle
45c9d6d fix: make resolved and outdated comments agree with what the page shows
9fb9de2 fix: wire the layout switch, keep the sidebar on narrow screens
ae331e9 + ранее — backend, безопасность, треды, публикация, UI-фиксы
```

## Состояние интеграций
### VS Code — ГОТОВО (главное достижение сессии)
- Настоящий тест в реальном VS Code: `editors/vscode/test/extension.test.mjs`
  + `.vscode-test.cjs` (официальный `@vscode/test-cli`, одноразовый workspace,
  `useInstallation` на `Z:\VSCode`). 6/6 проходят: команды зарегистрированы,
  `prReview.open` открывает webview-таб с диффом (files: 1), комментарий со
  страницы попадает в общий thread store со сниппетом, агент резолвит через
  `setCommentsResolved`, после переоткрытия комментарий resolved,
  `prReview.close` гасит страницу и убирает таб, пакет содержит движок.
- `npm run test:editors:vscode` = vscode-test; `test:editors:vscode:package` =
  `test-in-editor.mjs` (vsix в одноразовый профиль `--extensions-dir`, движок из
  установленной копии, без окон). 6/6.
- `prReview.open` возвращает `ReviewInfo`. Опция `prReview.autoOpen` (default
  false), `"activationEvents": ["onStartupFinished"]`.
- Живой скриншот: `Z:\system\temp\pr-review-ide\vscode-review.png` — вкладка
  `Review: feature/pricing (+2 / -1)` рендерится: шапка, Files changed, дифф
  cart.ts, коммиты, сайдбар REVIEW.

### Visual Studio — пакет проверен в живом Visual Studio
- `build-vsix.mjs` собирает установочный .vsix без workload. Исправлены реальные
  баги VSIX: VSCT теперь компилируется через VSSDK targets, CTO merge попадает
  в managed `.resources` (Visual Studio не читает raw `Menus.ctmenu`), VSIX
  manifest указывает DLL как `Microsoft.VisualStudio.VsPackage`, а пакет
  регистрируется для background autoload при открытом solution.
- Сборка использует полный .NET SDK через `dotnet msbuild` (системный SDK на
  этой машине неполный), VSIX: 58 файлов, ~1007 KB, движок внутри, конфликтов
  сборки DLL с IDE 0. Путь:
  `editors/visualstudio/bin/Release/net48/PrReview.VisualStudio.vsix`.
- Живая проверка: Visual Studio 18 Insiders, реальный solution с веткой
  `feature/review-threads-and-ui-hardening`; команда VSCT зарегистрирована и
  вызвана через DTE, tool window `PR Review` открыт в центральной вкладке,
  bundled Node server отвечает HTTP 200, страница отрендерена в WebView2:
  список файлов, дерево, диффы и `Submit review`. Скриншот:
  `Z:\system\temp\pr-review-ide\vs-review-final-clean.png`.
- Причина, по которой вкладка долго оставалась пустой («Starting the embedded
  browser…»): `ToolWindowPane` строит UI один раз из `Content`, заданного в
  конструкторе. Подмена `Content` на `WebView2` после создания frame ничего не
  перехостит — окно продолжало показывать исходный `TextBlock`, а WebView2 так и
  не попадал в visual tree, не получал HWND и не инициализировался. Теперь
  `Content` — постоянный `Grid` с подсказкой и WebView2, переключается только
  `Visibility` (браузер показывается до установки `Source`, иначе у скрытого
  контрола нет HWND).
- `WebView2Loader.dll` не копируется в папку расширения: перед стартом браузера
  `Common7/IDE/PrivateAssemblies` добавляется в `PATH`, откуда WebView2 и берёт
  host-provided runtime. Сами `Microsoft.Web.WebView2.*.dll` в VSIX не кладутся,
  если они есть в IDE: своя копия WPF-обёртки другой версии ломала инициализацию.
- Ошибки WebView2 и навигации больше не тонут: они показываются в самом окне
  вместо бесконечной подсказки.
- Репозиторий для ревью определяется через solution/project/selection с
  поддержкой `PR_REVIEW_REPO` override (нужен для DTE-фикстуры и полезен для
  автоматизации).
- IDE: `C:\Program Files\Microsoft Visual Studio\18\Insiders` (devenv, VSIXInstaller,
  расширение установлено в профиль `C:\Users\Rog`).

### Настройки страницы больше не «сбрасываются» (0.1.3)
- Причина: файл настроек лежал в `artifactsRoot()` = `os.tmpdir()/pr-review-mcp`,
  а TEMP у VS, терминала и планировщика разный — каждый запуск читал свой пустой
  файл, и размер дерева/тема/diff-режим возвращались к дефолту. Вдобавок тесты
  писали и удаляли этот же файл, то есть стирали настройки пользователя.
- Теперь: `settingsPath()` → `PR_REVIEW_SETTINGS_DIR` → `PR_REVIEW_ARTIFACTS_DIR`
  (явно заданный sandbox) → `%LOCALAPPDATA%\pr-review\ui-settings.json`
  (`stableUserRoot()`), то есть путь не зависит от TEMP.
- Старый файл из temp переносится один раз (`migrateLegacySettings`), BOM в
  ручной правке не ломает чтение.
- Тесты изолированы: `settings-unit`/`settings-persistence` пишут в свой sandbox,
  остальные используют `PR_REVIEW_ARTIFACTS_DIR` фикстуры — реальные настройки
  машины они не трогают (`tests/bad-input.mjs` больше не зависит от пустого файла).
- Выбор layout-кнопки в тулбаре (split/unified) сохраняется device-wide и
  восстанавливается после перезагрузки — покрыто `settings-persistence`.
- Живая проверка: сервер из установленного бандла, TEMP=`…\AppData\Local\Temp`
  → POST `treeWidth=437` → перезапуск с TEMP=`Z:\system\temp` → GET отдаёт `437`.

### JetBrains — код готов, ЖИВАЯ СБОРКА НЕВОЗМОЖНА
- Движок внутри плагина (7dd612a), распаковка jar в temp в `ReviewServer.kt`.
- На машине НЕТ JDK и Gradle — jar не собрать и не проверить.

### Zed / Neovim / Sublime / Emacs — контрактные, без движка внутри
- Используют общий `src/cli.js` напрямую (task в Zed, MCP для агента; в Neovim
  `require("pr-review")` + `:PrReview`). Пакет им не нужен. Покрыты
  `tests/editors.mjs` (проверки текста конфигов/скриптов на общий контракт).

## Логика (всё готово и покрыто тестами)
- Resolve: MCP → review.json/review.md → thread store → страница. Единая точка
  изменения состояния: `src/models/resolve-store.js`.
- Outdated: комментарий устаревает, если изменились строки, на которые он
  написан (включая незакоммиченные правки); file-комментарии и комментарии на
  удалённой стороне не устаревают.
- Группировка тредов между ревью; полный цикл человек→агент→человек
  (`tests/logic-cycle.mjs`).
- Фикс `defaultBase` (c8bddf0): в репозитории без remote база резолвилась в
  несуществующий `origin/HEAD` → пустое ревью. Теперь локальные кандидаты
  `main`/`master`/`dev` (`GIT.LOCAL_BASE_CANDIDATES` в `src/config.js`),
  текущая ветка пропускается. Тесты: «a repository without a remote still
  reviews its branch», «a head branch is never used as its own base».

## UI-фиксы этой сессии
- Перенос «+2 / -1» в шапке (6e70d1e): статистика — один неразрывный
  `span.stat-pair` в `src/render.js` + `.stat-pair` в `styles.css`.
- `.spacer` в шапке `flex: 0 0 0` (рос до половины строки, сжимал ветку и
  уводил статистику на вторую строку); мета-строка — nowrap с обрезкой ветки
  (`.meta-branch`, title-тултип). Регрессия в `tests/ui-suite.mjs`:
  «the additions and deletions stay on one line when the tab is narrow»
  (измеряет tops `.stat-add`/`.stat-del` при 4 ширинах).

## Результаты тестов (последний полный прогон)
- `npm run test` — 64/64.
- `npm run test:logic` (resolve/outdated/grouping/cycle) — всё pass.
- `npm run test:editors` — всё pass (включая новый check shadowing).
- `npm run test:ui:suite` — 48/48.
- `npm run test:editors:vscode` — 6/6 (vscode-test).
- `npm run test:editors:vscode:package` — 6/6.
- `npm run test:threads`, `test:pr:ui`, `test:resolve` — pass.
- Полный батчер: `npm run test && test:logic && test:editors && test:threads &&
  test:pr:ui && test:resolve` — всё exit=0.

## Ключевые файлы
- `src/models/commits.js` — `defaultBase` с локальными кандидатами.
- `src/config.js` — `LOCAL_BASE_CANDIDATES`, `BASE_CANDIDATES`.
- `src/render.js` — разметка шапки (stat-pair, meta-branch).
- `src/assets/styles.css` — стили шапки.
- `src/models/resolve-store.js` — единая точка resolve/reopen.
- `editors/vscode/test/extension.test.mjs`, `editors/vscode/.vscode-test.cjs` —
  настоящий тест VS Code.
- `editors/vscode/test-in-editor.mjs` — проверка упакованного .vsix без окон.
- `editors/visualstudio/build-vsix.mjs` — сборка VSIX с проверкой shadowing.
- `editors/visualstudio/ReviewToolWindow.cs`, `PrReviewPackage.cs` — решение
  как источник репо, CommandName.
- `tests/unit.mjs` (64), `tests/ui-suite.mjs` (48), `tests/editors.mjs`.
- Скрипты сессии: `Z:\system\temp\pr-review-ide\` (shot-vscode.ps1,
  capture-window.ps1, vs-live.ps1 — DTE-автоматизация VS).

## PITFALLS (важно для следующей сессии)
1. **Бандл движка**: после ЛЮБЫХ правок в `src/` гонять `npm run bundle:server`,
   иначе редакторы работают против стухшей копии в `editors/*/server/`.
2. Путь `Z:\Alpha Dev\pr-review-mcp` с пробелом: аргументы вроде
   `--extensionDevelopmentPath` требуют ЯВНЫХ КАВЫЧЕК, иначе расширение
   молча не активируется.
3. `C:\opencode_cache ` (с пробелом в конце) — PowerShell ломается на
   Set-Location; Node через process.chdir работает.
4. В VS Code-расширении ДВА файла core.js (`server/src/core.js` и
   `server/src/assets/core.js`) — упаковщики не должны матчить по имени.
5. Логи PowerShell в UTF-16 с NUL: читать в Node
   `Buffer.toString('utf16le').replace(/\0/g,'')`.
6. VSIXInstaller: `/q /a <vsix>` установка, `/q /u:PrReview.VisualStudio
   /shutdownprocesses` удаление. `/admin` кладёт в каталог администратора
   (`Common7\IDE\Extensions`).
7. Не запускать devenv/VS Code без необходимости — тестовые окна мешали
   пользователю. Если нужно — сначала убедиться, что нет старых процессов
   (`Get-Process devenv, Code`).
8. Зацикленный CLI-проверочный процесс: `node src/cli.js` живёт вечно
   (setInterval keepalive) — для проверки запускать Start-Process, читать
   строку READY, убивать процесс.

## Следующие шаги (по приоритету)
1. **JetBrains**: нужен JDK + Gradle — тогда собрать jar и проверить
   распаковку/запуск (блок чисто инструментальный).
2. **Stress/edge-тесты** (обещано, не начато):
   - `hljs-bundle.js` — audit TODO/мин в парсерах (длинные строки, спецсимволы).
   - git edge cases: пустые коммиты, мусор в stderr, пустой diff.
   - render.js: экстремально длинные имена файлов/веток.
3. **VS Code дальше**: `simpleBrowser` и `external` режимы showIn — проверить
   вживую; `autoOpen` — живьём.
4. Пуш ветки — только по явной просьбе.

## Что НЕ трогать
- Пуш, релизы — без явной команды.
- `C:\Program Files\Microsoft Visual Studio\18\Insiders` — после любых
  экспериментов с установкой проверять, что `PrReview.VisualStudio.dll`
  там нет (или есть и это намеренно), и что IDE запускается без ошибок.
- Текущая установка PrReview в IDE: УДАЛЕНА (проверено: 0 файлов).

## Обновление 2026-11-21 — автономные headless UI-тесты
- `tests/regressions.mjs` теперь полностью автономен: собственная git-фикстура,
  bare remote, `MODE.RANGE`, случайный порт (`port: 0`), изолированный
  `PR_REVIEW_ARTIFACTS_DIR`, cleanup в `finally`. Результат: **49/49 PASS**.
- Последний падавший чек исправлен фикстурой: `IViewerTag` объявлен первым в
  `src/models.cs` и реализован в неизменённом `src/unchanged.cs`, поэтому у
  первого `.sym-link` есть определение и usage в другом файле.
- `tests/e2e.mjs` и `tests/e2e-extra.mjs` больше не требуют внешний сервер на
  порту 5454. Общая новая фикстура `tests/e2e-fixture.mjs` создаёт >50 файлов,
  C#-символы, viewer-файлы, context-expander, >10 изменённых строк и 4 коммита;
  сервер запускается на случайном порту, артефакты и репозиторий удаляются в
  `finally`. Результаты: **33/33 PASS** и **27/27 PASS**.
- Тесты оставляют только системные процессы OpenCode/Premiere и обычный
  Firefox пользователя. Headless Firefox, geckodriver и старые `serve-5454.js`
  после прогона убиты; временные `rust_mozprofile*` удалены.
- Временные диагностические `tests/diag*-regressions.mjs` удалены.
- Push не выполнялся.
