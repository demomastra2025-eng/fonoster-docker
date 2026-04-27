# План расширения Onelink на базе `fonoster-pack` для полной мощности

Цель: превратить текущую интеграцию Onelink + Fonoster в полноценную production-платформу связи с масштабируемым
телефоническим контуром, AI-помощником, наблюдаемостью и операционной устойчивостью.

---

## 1) Концепция интеграции

### Принятые принципы
- **Onelink = control-plane** (сценарии, номера, агенты, SLA, инциденты, аналитика).
- **`fonoster-pack` = execution-plane** (телефонический runtime, маршрутизация, media-цепочки, AI-стэки).
- **Язык команд CRM -> Fonoster bridge — Onelink-совместимый `telephony/*` API**, не ad-hoc бизнес-эндпоинты.
- **Язык live callbacks Fonoster bridge -> Onelink — `/internal/voice/inbound/*`**, пока это фактический runtime-контракт.
- **Event-first архитектура**: все значимые изменения звонка пишем в единый event bus / ingestion.
- **Fallback не как опция, а как default-стратегия** (DB/кэш + degraded mode + health checks).

### Компоненты `fonoster-pack`, которые должны стать обязательными
1. `fonoster-docker/telephony-bridge`
2. `fonoster-docker/voice-runtime`
3. `fonoster-docs` (только для живой архитектурной и API документации)
4. При необходимости `fonoster` core-сервисы (SIP, роутинг, хранилище, security-слой)
5. `fonoster-docker/compose*` как единый стек запуска

### Почему не `fonoster_new` как primary
- `fonoster_new` полезен как источник отдельных модулей и идей, но для телематики Onelink сразу в прод его core integration layer
не закрывает полностью.

---

## 2) Что мы получаем уже сейчас из `fonoster-pack`

### Что уже есть
- Совместимый слой Onelink API, подтвержденный live bridge: `/healthz`, `/telephony/capabilities`,
  `/telephony/resources/summary`, `/telephony/applications`, `/telephony/numbers/*`, `/telephony/trunks`,
  `/telephony/agents`, `/telephony/agents/:agentRef/enabled`, `/telephony/calls/*`,
  `/telephony/ai/toggle`, `/telephony/webphone/token`.
- `/telephony/webphone/token` существует в bridge, но current Onelink behavior помечает Fonoster как outside-browser;
  webphone/operator browser UI остается future/exploration, не текущим production path.
- `voice-runtime`, который:
  - запрашивает route через `/internal/voice/inbound/route`
  - исполняет базовый flow (`reject`, `operator`, `app/ai`)
  - отсылает события обратно через `/internal/voice/inbound/event`.
- Механизмы надёжности (retry/backoff, timeout handling, degraded режим по внешнему контуру).
- Документация и планы:
  - bridge/telephony docs
  - onelink-native integration plan
  - bridge-vs-native matrix
  - API contracts

### Ограничения, которые надо закрыть
- Текущий Onelink dev backend доступен, но для `+18623964686` все еще возвращает `number_not_bound`.
- В Fonoster сейчас нет `agents` и `domains`, поэтому production SIP/Webphone operator route пока не готов.
- В `.env` есть fallback AI ref `5c0a2ddf-1f6b-4d35-bf89-e4f8f1c3b2ab`, но в текущем Fonoster resource summary такого application нет.
- Live контейнер `telephony-bridge` пересобран из локального проекта и содержит расширенный event-stream API, но для Onelink CRM handoff считать актуальными только endpoint'ы из `ONELINK_BRIDGE_API_CONTRACT.md`.
- Runtime/event ingestion должен нормализовать raw dial statuses в current Onelink statuses:
  `ANSWER -> answered`, `NOANSWER -> no-answer`, `BUSY -> busy`, `FAILED -> failed`, `CANCEL -> failed`.
- Не весь runtime-поток AI/app полностью отшлифован под production.
- Конфиги и секреты требуют нормализации (env hygiene).
- Частичная или историческая терминология (`chatwoot` naming) в клиентских модулях telephony-bridge.
- Нужна строгая договорённость по observability и idempotency событий.

### Live status на 2026-04-19
- `telephony-bridge` запущен и видит Onelink: `onelink.configured=true`.
- Remote bridge proxy для Onelink/Rails: `https://bridge.75.119.131.165.sslip.io`.
- `GET /healthz` открыт, telephony command endpoints требуют Fonoster `TELEPHONY_BRIDGE_SHARED_SECRET`.
- `/internal/voice/inbound/*` через remote bridge proxy не открыт; это внутренний контур `voice-runtime -> telephony-bridge`.
- Текущие ресурсы Fonoster: `applications=2`, `numbers=1`, `trunks=1`, `agents=0`, `domains=0`.
- Текущий номер: `+18623964686`, `number_ref=d451bbe2-53d8-4458-bd0e-d811d85f57e0`.
- Runtime app: `96fc259c-6bcd-4cbf-bb7d-d2c51f248934`.
- Demo app: `74fec1f6-48e8-436c-8147-9176a5da4fa4`.
- Trunk: `a299c0e0-150b-4fc9-9a58-f44bb3634324`.
- Главный blocker: Onelink должен привязать номер к telephony channel, чтобы route больше не возвращал `number_not_bound`.

---

## 3) Целевой функционал (“вся мощь” Fonoster для Onelink)

### Блок A. Базовая телефония (обязательно)
1. Входящие/исходящие вызовы с полным lifecycle.
2. Интегрированная маршрутизация по:
   - номеру/контексту
   - тэгу канала
   - приоритету и бизнес-политике
3. Роутинг в:
   - живого оператора
   - очередь/IVR
   - AI-резолвер
4. SIP/WebRTC/Webphone единый ingress/egress.

### Блок B. Надёжность и качество
1. Retry/Timeout на каждом сетевом hop.
2. Failover между провайдерами/телефонными транками.
3. Fallback-режимы:
   - no-bridge (local route)
   - degraded mode с минимально допустимыми сценариями.
4. Health checks + self-healing:
   - отдельный readiness/liveness endpoint
   - watchdog для call runtime.

### Блок C. Контроль и наблюдаемость
1. Полная телеметрия:
   - вызов: start/ring/answer/hold/bridge/handoff/termination
   - route decision latency
   - reason отказа и fallback.
2. KPI:
   - ASR (answer success rate)
   - FSR (first service rate), AHT/Achieved Hold/Abandon
   - p95/p99 latency по маршрутизации и event delivery.
3. Коррелируемые trace-id по всем leg call events.
4. Alerting:
   - аномалии по MOS/латентности
   - деградация внешних webhook
   - накопление queue backlog.

### Блок D. AI- и голосовые сценарии
1. STT/TTS пайплайн в runtime.
2. ASR транскрипция + sentiment/keyword triggers (опционально).
3. Handoff AI → оператор с передачей контекста.
4. Сценарии pre-processing (проверка клиента, квалификация, запись).
5. Пост-обработка разговора:
   - конспект
   - summary в карточку клиента.

### Блок E. Расширение каналов
1. Телефония + callback flows + missed-call recovery.
2. IVR-флоу по скриптам.
3. Конференции/переводы:
   - warm/hard transfer
   - conference bridge
4. Запись разговоров и безопасное хранение/хранение по retention policy.

### Блок F. Enterprise и безопасность
1. RBAC для админ/операторов/техников.
2. Маскирование PII в логах.
3. Secrets management (KMS/Vault/env vaulting).
4. Аудит:
   - кто изменил route policy
   - кто изменил AI режим
   - кто экспортировал/слушал запись.

---

## 4) Роадмап внедрения (по этапам)

## Этап 0 — Hardening фундамента (1–2 недели)
1. Стандартизировать контракты между Onelink и `telephony-bridge`.
2. Убрать неявные зависимости на исторические неймспейсы в коде адаптера (chatwoot-следы).
3. Привязать Onelink telephony channel к текущему номеру `+18623964686` и убрать `number_not_bound` для bound number.
4. Исправить fallback AI ref: либо создать app `5c0a2ddf-1f6b-4d35-bf89-e4f8f1c3b2ab`, либо заменить env на реально существующий app ref.
5. Подготовить конфиги и секреты:
   - отдельный `.env` профайл
   - secret injection
   - ротация token/webphone creds.
6. Настроить базовый observability baseline:
   - structured logs
   - request ids
   - correlation for inbound/outbound.

**Критерии приёмки:**
- один стабильный запуск compose локально
- один сквозной вызов inbound успешно проходит до решения маршрута
- есть event запись в onelink ingestion.
- Onelink route для `+18623964686` больше не возвращает `number_not_bound`.

## Этап 1 — Production telephony core (2–4 недели)
1. Закрепить и покрыть contract tests для live-блоков:
   - `/telephony/calls/outbound`
   - `/telephony/numbers/:ref/route`
   - внутренние `/internal/voice/inbound/*`.
2. Пересобрать и проверить `telephony-bridge`, если нужен расширенный event-stream API из локальных исходников.
3. Поднять:
   - persistent dialplan
   - очереди и статусы занятости
   - retry/failover.
4. Интегрировать `readiness` и `capabilities`.
5. Реализовать безопасный storage для записей и webhook outbox.

**Критерии приёмки:**
- 95% успешных маршрутов в течение тестового трафика
- idempotent обработка повторных событий
- корректная обработка disconnect/error path без потери вызова.

## Этап 2 — AI-увеличение ценности (2–3 недели)
1. Доработать `voice-runtime` для стабильной AI-ветки.
2. Включить STT/TTS провайдеры через feature flags.
3. Создать или выбрать реальный AI application ref, отличный от runtime app ref.
4. Реализовать handoff AI ↔ оператор.
5. Добавить post-call summary в Onelink CRM-сущности.

**Критерии приёмки:**
- AI сценарий проходит не менее 2 типов скрипта
- передача контекста не теряется при handoff
- метрики качества распознавания отображаются в дашборде.

## Этап 3 — Расширение функций и каналов (3–4 недели)
1. IVR + transfer + conference + call recording.
2. Callback и missed-call recovery.
3. Улучшение operator console: reason codes, active calls panel, whisper/coaching.
4. Экспорт отчётов и SLA-дашборды.

**Критерии приёмки:**
- все сценарии из целевых бизнес-пользований закрыты и документированы
- отчёты по AHT/ответу/разрыву доступны в BI-формате.

## Этап 4 — Enterprise hardening (3–6 недель)
1. Полный RBAC + audit trails.
2. Compliance: retention, удаление данных, masking PII.
3. Capacity planning, autoscale и chaos testing.
4. DR/backup/recovery и runbook 24x7.

**Критерии приёмки:**
- отказоустойчивый запуск после сценария деградации infra
- подтвержденный DR-run с RPO/RTO в рамках политик.

---

## 5) Карта файлов/зон (быстрый старт разработки)

## В `onelink`
- `app/services/telephony/*` — orchestration, синхронизация маршрутизации, событий, readiness.
- `app/controllers/telephony/*` — REST endpoints для bridge.
- `app/services/events*` — ingestion и дедупликация событий.
- `app/jobs/*` — asynchronous delivery, callback retries.
- `app/models/*` — сущности звонков, агентов, маршрутов, сессий.

## В `fonoster-pack/fonoster-docker/telephony-bridge`
- `telephony-bridge/src/server.js` — public и internal API mapping.
- `telephony-bridge/src/routeDecision.js` — бизнес-правила маршрутизации.
- `telephony-bridge/src/chatwoot.js` — адаптер внешнего control-plane (нужно переименовать/доработать под onelink).
- `telephony-bridge/src/routeCache.js` — кэш маршрутов/решений.
- `telephony-bridge/src/config.js` — production-safe config.

## В `fonoster-pack/fonoster-docker/voice-runtime`
- `voice-runtime/src/index.js` — lifecycle в inbound pipeline.
- `voice-runtime/src/{services,scripts}` (или эквивалентные модули) — расширение AI/operator/queue сценариев.

---

## 6) Риски и меры снижения

### Риски
1. Несовпадение контрактов событий и статусов.
2. Двойная маршрутизация из-за race-условий.
3. Потеря событий при рестарте runtime.
4. Растущая нагрузка на DB при polling-цепях.
5. Недостаточно стабильные AI latency и расходы.

### Митигирование
1. Версионирование API контрактов и contract tests.
2. Идемпотентные ключи по `callSid + eventId`.
3. Outbox + retry queue + persistence на критичных событиях.
4. Кэш + selective polling + метрики.
5. AI feature flags + cost guardrails + circuit breaker.

---

## 7) Предложение по метрикам успеха через 8–12 недель

1. >99% успешного принятия inbound маршрутов.
2. `p95` latency inbound route < 250 мс (без AI), < 800 мс (с AI).
3. Не менее 2x рост покрытия сценариев относительно текущего состояния.
4. Падение ручной операционной рутинной обработки на 30–40%.
5. Наличие еженедельного отчёта uptime/quality для менеджмента.

---

## 8) Немедленные next-steps (1 неделя)

1. Зафиксировать owners по 3 линиям:
   - Onelink integration
   - `telephony-bridge` hardening
   - runtime + AI stack
2. В Onelink создать/обновить telephony channel для `+18623964686`:
   - `number_ref=d451bbe2-53d8-4458-bd0e-d811d85f57e0`
   - `app_ref=96fc259c-6bcd-4cbf-bb7d-d2c51f248934`
   - `trunk_ref=a299c0e0-150b-4fc9-9a58-f44bb3634324`
   - `ai_app_ref=null` до создания реального AI app
   - `operator_agent_aor=null` до создания Fonoster agents/domains
   - persisted routing mode не должен использовать `clear`; `clear` допустим только как bridge fallback/reset payload.
3. Подготовить single source документацию по endpoint mapping (Onelink ↔ bridge ↔ runtime).
4. Поднять staging с `fonoster-pack` и включить end-to-end smoke:
   - inbound call
   - outbound call
   - route fallback
   - event ingestion.
5. Выделить backlog P0 и запланировать delivery sprintами.
