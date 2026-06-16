# Fonoster/Routr native diff review

Дата проверки: 2026-06-04

## Scope

Проверялись локальные рабочие проекты:

- `/root/fonoster-pack/fonoster` - основной исходный Fonoster.
- `/root/fonoster-pack/fonoster-library/routr` - локальный Routr, единственный реально используемый проект из `fonoster-library`.
- `/root/fonoster-pack/fonoster-docker` - интеграционный рабочий проект и место для проектных заметок.

Цель ревью: оценить изменения в Routr и Fonoster за весь локальный diff относительно исходной логики проектов: насколько реализация нативная для платформы, надежная, логичная, поддерживаемая и готовая к дальнейшему обновлению upstream.

## Upstream version check

### Fonoster

Локальное состояние:

- repo: `/root/fonoster-pack/fonoster`
- branch: `main`
- local HEAD: `53f3ae71b5b534db4ca199b22829fa9ffe756400`
- `git describe`: `v0.18.3-1-g53f3ae71b-dirty`
- `origin`: `git@github.com:demomastra2025-eng/fonoster.git`
- fork `origin` по `git ls-remote` показывает только `main` на `53f3ae71...`; upstream tags `v0.18.*` в fork не обнаружены.

Официальный upstream:

- repo: `https://github.com/fonoster/fonoster`
- GitHub tags page: https://github.com/fonoster/fonoster/tags
- GitHub API tags: https://api.github.com/repos/fonoster/fonoster/tags?per_page=5
- `v0.18.5` есть в tags и указывает на `73636664ac7eba6a8e432c31d057f9df0d5f6b7e`.
- official `main` по `git ls-remote` также на `73636664ac7eba6a8e432c31d057f9df0d5f6b7e`.
- Важно: `releases/latest` через GitHub API сейчас отдает `v0.17.1`, а не `v0.18.5`. Поэтому для сравнения версий надежнее смотреть tags и refs, а не только releases UI.

Вывод: локальный Fonoster/fork отстает от официального upstream по тегам минимум до `v0.18.5`. Перед обновлением нужно добавить отдельный `upstream` remote на `https://github.com/fonoster/fonoster.git`, fetch tags и сравнить локальные изменения с `v0.18.5`.

### Routr

Локальное состояние:

- repo: `/root/fonoster-pack/fonoster-library/routr`
- branch: `main`
- local HEAD: `ec76c580084bc47f43935ae8293e60ff27abceee`
- `git describe`: `v2.13.22-dirty`
- `origin`: `https://github.com/fonoster/routr.git`

Официальный upstream:

- repo: `https://github.com/fonoster/routr`
- GitHub tags page: https://github.com/fonoster/routr/tags
- GitHub API tags: https://api.github.com/repos/fonoster/routr/tags?per_page=6
- official `main`: `457b10495ffa8399119269d66cf7d9f7be1921cd`
- `v2.13.22`: `ec76c580084bc47f43935ae8293e60ff27abceee` - это база локального checkout.
- `v2.13.23`: `e1fa234eb246a3a55970e8df29ce31f890ffd862`
- `v2.14.0`: есть в tags; GitHub tree: https://github.com/fonoster/routr/tree/v2.14.0
- `vfix/wss-onnewsocket-recursion-hang`: `48cc10bb1a6060a1d23305dc6acf6f40b3410023`; GitHub latest release через API сейчас указывает именно на этот WSS-fix tag.

Вывод: локальный Routr стоит на `v2.13.22-dirty`, а upstream уже содержит более новые теги. Особенно важен `vfix/wss-onnewsocket-recursion-hang`, потому что локальные изменения тоже затрагивают WebSocket/WSS поведение. Его нужно изучить до слияния или переписывания локального Routr diff.

## Findings

### 1. High - Routr `Location.findRoutes` изменил контракт слишком глубоко

Файл: `/root/fonoster-pack/fonoster-library/routr/mods/location/src/location.ts`

Сейчас `findRoutes` для не-backend запросов выбирает один "лучший" route и возвращает только его. Это ломает старую семантику location service: вернуть все подходящие contacts/routes, а решение о выборе транспорта/канала держать на уровне routing/connect logic.

Почему это риск:

- В старом unit test `/root/fonoster-pack/fonoster-library/routr/mods/location/test/location.unit.test.ts` есть ожидание двух routes для одного AOR.
- Это изменение влияет не только на WebRTC peer routing, а на весь location lookup.
- Выбор "WS лучше UDP" стал частью общего storage/service слоя, хотя это policy конкретного transport path.
- Возможны регрессии для multi-contact, failover, parallel forking и обычных SIP clients.

Оценка: не нативно для Routr. Нужно вернуть прежний контракт `findRoutes`, а WS preference вынести в Connect/router path или в явный scoped helper/flag.

### 2. High - WS REGISTER удаляет все contacts по AOR

Файл: `/root/fonoster-pack/fonoster-library/routr/mods/connect/src/handlers/register.ts`

В WS REGISTER обработке используется `locationService.removeRoutes({ aor })` перед добавлением нового route. Это очищает все contacts для AOR, а не только старые WebSocket contacts.

Почему это риск:

- Один WebRTC peer может удалить UDP/TCP/TLS регистрацию того же identity.
- Multi-device registration становится ненадежной.
- Поведение registrar становится несимметричным: WS registration агрессивно чистит состояние шире своего транспорта.

Оценка: логика понятна как workaround против stale WS contacts, но реализация слишком широкая. Нужно удалять только stale WS/WSS route, желательно по contact URI, received/source или route id.

### 3. Medium/High - ACK/BYE WS routing построен на эвристике To/From

Файл: `/root/fonoster-pack/fonoster-library/routr/mods/connect/src/service.ts`

Для `ACK`/`BYE` добавлена эвристика, которая ищет route через `To/From` headers, если `req.getDestination()` не дает destination. Это закрывает практическую проблему dialog-routing, но решение хрупкое.

Почему это риск:

- `To/From` не являются надежным routing key после установления dialog.
- В SIP dialog для in-dialog requests правильнее опираться на route set, Contact, dialog state, transaction/dialog layer.
- При transfer/reinvite/proxy path можно получить неверную сторону dialog.

Оценка: workaround может быть полезен, но его нужно зафиксировать тестами на реальные ACK/BYE сценарии и по возможности заменить на более SIP-native dialog/contact based routing.

### 4. Medium - app handoff registry в памяти плохо масштабируется

Файлы:

- `/root/fonoster-pack/fonoster/mods/apiserver/src/voice/handlers/dial/appHandoffRegistry.ts`
- `/root/fonoster-pack/fonoster/mods/apiserver/src/voice/VoiceClientImpl.ts`
- `/root/fonoster-pack/fonoster/mods/apiserver/src/voice/handlers/ExternalMediaHandler.ts`

Идея app handoff реализована нативно относительно Fonoster: через existing voice dispatcher, ARI/Stasis, gRPC события и ExternalMedia. Но registry живет в памяти процесса.

Почему это риск:

- Handoff потеряется при рестарте apiserver.
- Несколько apiserver instances не будут видеть состояние друг друга.
- Нужна строгая очистка при hangup/error/timeout, иначе будет state leak.

Оценка: как first implementation это логично. Для production лучше перевести state в Redis/NATS/KV или другой shared lifecycle-aware storage, особенно если предполагается HA.

### 5. Medium - `DialStatus` proto и TypeScript payload расходятся

Файлы:

- `/root/fonoster-pack/fonoster/mods/common/src/protos/voice.proto`
- `/root/fonoster-pack/fonoster/mods/apiserver/src/voice/handlers/dial/appHandoffRegistry.ts`

Код отправляет в `DialStatus` поля вроде:

- `cancelDeltaMs`
- `cancelAfterFirstAudioInDeltaMs`
- `cancelAfterFirstAudioOutDeltaMs`

В proto они не закреплены как часть `DialStatus`. Даже если runtime сейчас пропускает object shape, контракт SDK/gRPC получается неявным.

Почему это риск:

- generated clients могут не видеть эти поля.
- другие языки SDK потеряют данные.
- типы и документация расходятся с реальным событием.

Оценка: нужно либо добавить поля в proto и regenerated SDK, либо убрать их из payload и оставить только в internal logs/metadata.

### 6. Medium - generated Prisma artifacts попали в diff

Файлы:

- `/root/fonoster-pack/fonoster/mods/identity/src/generated/@prisma/client/index.js`
- `/root/fonoster-pack/fonoster/mods/identity/src/generated/@prisma/client/*`

В diff есть generated Prisma client changes, включая локальный абсолютный путь `/root/fonoster-pack/fonoster/...` и обновление client version `6.19.1 -> 6.19.2`. Также есть большой untracked native query engine binary.

Почему это риск:

- Такие файлы шумят review и могут быть OS-specific.
- Абсолютные локальные пути не должны попадать в репозиторий.
- Native binary в source tree может сломать portability.

Оценка: удалить generated artifacts из пользовательского diff, если проект не держит их осознанно в git. Перегенерировать в build/install step.

### 7. Low/Medium - OneLink-specific fallback зашит в core Fonoster path

Файл: `/root/fonoster-pack/fonoster/mods/apiserver/src/voice/recordingReadyNotifier.ts`

`recording_ready` notifier использует default app ref с OneLink-смыслом. Это удобно для текущей интеграции, но менее нативно для upstream Fonoster.

Почему это риск:

- Core module начинает знать о конкретном downstream workflow.
- При переносе на upstream или multi-tenant deployments fallback может отправлять события не туда.

Оценка: лучше сделать это конфигурацией на workspace/app level или явным integration adapter в `fonoster-docker`.

## Positive observations

- Основная Fonoster voice integration идет по нативным точкам расширения: ARI/Stasis, ExternalMedia, gRPC Voice API, VoiceDispatcher handlers.
- `AudioSocket` parser в `/root/fonoster-pack/fonoster/mods/streams/src/AudioSocket.ts` реализован аккуратно: buffered TCP framing, защита от partial frames и noise до magic header.
- `httpBridge` для recording download стал надежнее: лучше обработаны URL/headers/streaming path.
- `recording_ready` как voice event логически вписывается в voice event model, если убрать hardcoded downstream defaults.
- Текущая app handoff модель концептуально правильная: один call leg может быть передан в app flow без имитации внешнего SIP клиента.

## Verification performed

Fonoster targeted build прошел:

```bash
npm run build --workspace=@fonoster/common
npm run build --workspace=@fonoster/streams
npm run build --workspace=@fonoster/voice
npm run build --workspace=@fonoster/apiserver
```

Fonoster targeted tests прошли: `29 passing`.

Покрытые тестовые группы:

- `mods/apiserver/test/voice/VoiceDispatcher.test.ts`
- `mods/apiserver/test/voice/answerHandler.test.ts`
- `mods/apiserver/test/voice/createVoiceClient.test.ts`
- `mods/apiserver/test/voice/dialHandler.test.ts`
- `mods/apiserver/test/voice/hangupHandler.test.ts`
- `mods/apiserver/test/voice/recordingReadyNotifier.test.ts`
- `mods/streams/test/AudioSocket.test.ts`
- `mods/voice/test/dial.test.ts`

Routr build/test локально не выполнен: в `/root/fonoster-pack/fonoster-library/routr` нет `node_modules`, `tsc` отсутствует. Но по коду и старым unit expectations виден контрактный риск в `Location.findRoutes`.

## Recommended actions

1. Routr: откатить изменение общего контракта `Location.findRoutes`; WS preference вынести ближе к Connect/router.
2. Routr: заменить `removeRoutes({ aor })` на scoped удаление только stale WS/WSS contacts.
3. Routr: перед доработкой изучить upstream `vfix/wss-onnewsocket-recursion-hang` и понять, закрывает ли он часть нашей WSS проблемы лучше и нативнее.
4. Routr: добавить tests для WS REGISTER, multi-contact AOR, PEER_TO_AGENT route selection, ACK/BYE in-dialog behavior.
5. Fonoster: синхронизировать `DialStatus` proto/SDK с фактическим payload или убрать незафиксированные поля.
6. Fonoster: вынести app handoff registry из process memory, если нужен HA/multi-instance deployment.
7. Fonoster: убрать generated Prisma artifacts/native binary из diff.
8. Fonoster integration: убрать OneLink-specific default из core path и перенести в конфиг/adapter.
9. Upstream update: сначала добавить official remotes и сравнить refs, не делать прямой pull поверх dirty tree.

## Suggested update commands

Для Fonoster:

```bash
cd /root/fonoster-pack/fonoster
git remote add upstream https://github.com/fonoster/fonoster.git
git fetch upstream --tags
git log --oneline --left-right --cherry-pick HEAD...refs/tags/v0.18.5
```

Для Routr:

```bash
cd /root/fonoster-pack/fonoster-library/routr
git fetch origin --tags
git log --oneline --left-right --cherry-pick HEAD...refs/tags/v2.13.23
git log --oneline --left-right --cherry-pick HEAD...refs/tags/v2.14.0
git show --stat refs/tags/vfix/wss-onnewsocket-recursion-hang
```

## Overall assessment

Fonoster-side изменения в целом выглядят архитектурно нативно: они используют правильные platform hooks и не превращают интеграцию в внешний SIP hack. Основные риски там относятся к production lifecycle, контрактам SDK/proto и загрязнению diff generated artifacts.

Routr-side изменения решают реальные проблемы WebRTC/WS routing, но сейчас они слишком глубоко меняют общую семантику registrar/location layer. Это менее нативно для Routr и несет больший риск регрессий. Перед продолжением лучше подтянуть и изучить upstream WSS fix, затем переписать локальную WS логику как scoped extension, а не как изменение базового `findRoutes` contract.
