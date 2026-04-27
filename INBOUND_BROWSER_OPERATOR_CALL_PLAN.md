# Inbound Browser Operator Call Plan

Цель: довести входящий звонок до сценария, где оператор в браузере видит входящий вызов, может снять трубку, отклонить вызов и завершить активный разговор.

Этот документ описывает только входящий поток. Исходящие звонки и outbound PSTN trunk здесь не рассматриваются.

---

## 1. Текущий факт

Сейчас входящий PSTN/SIP звонок уже доходит до Fonoster:

```text
Twilio/PSTN/SIP provider
-> Routr
-> Fonoster apiserver
-> voice-runtime
-> telephony-bridge
-> Onelink route decision
```

Последние исправления уже закрывают безопасный reject:

```text
Onelink returns reject
-> telephony-bridge normalizes answer=false
-> voice-runtime hangs up without answering
```

Но полноценного операторского браузерного приема еще нет, потому что не хватает WebRTC/SIP agent-а в браузере и маршрута Onelink на этого agent-а.

---

## 2. Целевой входящий поток

### 2.1 Общая цепочка

```text
1. Клиент звонит на DID номер
2. Провайдер доставляет SIP INVITE в Fonoster/Routr
3. Fonoster запускает runtime app
4. voice-runtime отправляет session_started в telephony-bridge
5. telephony-bridge спрашивает Onelink, куда вести звонок
6. Onelink выбирает online оператора
7. voice-runtime делает dial на SIP/WebRTC agent оператора
8. Браузер оператора получает incoming call
9. Оператор нажимает Answer или Decline
10. При Answer звонок соединяется
11. При Hangup разговор завершается
12. Все события пишутся в Onelink
```

### 2.2 Участники

```text
PSTN/SIP provider
  Доставляет внешний входящий звонок.

Routr
  SIP routing, REGISTER, INVITE, BYE, WebRTC/SIP signaling.

Fonoster apiserver
  Создает voice client, управляет media/session.

voice-runtime
  Runtime app, который принимает решение bridge и исполняет answer/dial/hangup.

telephony-bridge
  Адаптер между Fonoster и Onelink.

Onelink backend
  Бизнес-роутинг, статусы операторов, карточка звонка, события.

Onelink browser widget
  SIP.js/WebRTC softphone оператора.
```

---

## 3. Что значит "снять трубку"

В браузерном сценарии есть два разных "answer":

### 3.1 Answer PSTN leg

Это ответ внешнему звонящему клиенту. Его выполняет `voice-runtime` через Fonoster voice API.

```text
voice-runtime -> voice.answer()
```

В операторском сценарии этот answer должен происходить только когда мы действительно начинаем соединение с оператором, а не при reject.

### 3.2 Answer browser agent leg

Это действие оператора в браузере.

```text
browser widget receives incoming SIP INVITE
operator clicks Answer
sip.js accepts WebRTC session
```

То есть оператор "снимает трубку" в браузере, а runtime уже держит/мостит внешний leg.

---

## 4. Что значит "остановка"

Нужно поддержать три варианта остановки:

### 4.1 Отклонить до ответа

Оператор видит входящий, но нажимает Decline.

Ожидаемое поведение:

```text
browser widget rejects agent leg
voice-runtime получает busy/failed/no-answer
voice-runtime завершает PSTN leg
Onelink получает rejected/session_completed
```

### 4.2 Завершить активный разговор

Оператор уже ответил и нажимает Hangup.

Ожидаемое поведение:

```text
browser widget sends BYE
Fonoster/Routr завершает agent leg
voice-runtime/session получает завершение
PSTN leg тоже закрывается
Onelink получает session_completed
```

### 4.3 Клиент сам положил трубку

Звонящий клиент завершает звонок первым.

Ожидаемое поведение:

```text
PSTN/SIP provider sends BYE/CANCEL
Fonoster завершает runtime/media
browser agent leg закрывается
Onelink получает session_completed
UI оператора сбрасывает active call
```

---

## 5. Что надо сделать в Fonoster

### 5.1 Создать SIP/WebRTC domain

Нужен domain для браузерных операторов.

Пример целевой модели:

```text
domain: agents.vconsult.kz
transport: WSS/WebRTC enabled
```

Проверить:

```text
Routr принимает REGISTER от browser SIP client
Routr принимает INVITE на agent AOR
rtprelay/rtpengine корректно обрабатывает WebRTC media
```

### 5.2 Создать credentials для оператора

Каждый оператор должен иметь SIP credentials.

Пример:

```text
username: agent-101
password: generated secret
domain: agents.vconsult.kz
```

Секреты нельзя отдавать напрямую из Rails UI без короткоживущего bootstrap token.

### 5.3 Создать Fonoster agent

Agent должен быть включен и связан с domain/credentials.

Пример целевого AOR:

```text
sip:agent-101@agents.vconsult.kz
```

Нужные поля:

```text
enabled=true
maxContacts=1
domainRef=<domain_ref>
credentialsRef=<credentials_ref>
```

### 5.4 Проверить SIP REGISTER

Минимальный критерий:

```text
Routr logs show REGISTER from agent-101
operator status in Onelink becomes online/registered
```

### 5.5 Проверить direct dial на agent

До интеграции с Onelink надо проверить, что Fonoster может позвонить агенту:

```text
voice-runtime or test app -> dial("agent-101")
browser receives incoming call
operator can answer
audio works both ways
operator can hangup
```

---

## 6. Что надо сделать в browser widget

Основа уже есть в Fonoster dashboard:

```text
/root/fonoster-pack/fonoster/mods/dashboard/src/applications/hooks/use-sip.ts
```

Там используется:

```text
sip.js Web.SimpleUser
SIP over WebSocket
browser microphone
remote audio element
extra SIP headers
```

Нужно вынести это в Onelink widget/operator console.

### 6.1 Bootstrap

При открытии Onelink оператор должен получить короткоживущий webphone token.

Response должен содержать:

```json
{
  "username": "agent-101",
  "domain": "agents.vconsult.kz",
  "displayName": "Operator 101",
  "signalingServer": "wss://<fonoster-host>/ws",
  "targetAor": "sip:agent-101@agents.vconsult.kz",
  "token": "short-lived-connect-token",
  "expiresAt": "2026-04-20T12:00:00Z"
}
```

### 6.2 Connect/Register

Widget должен:

```text
1. запросить microphone permission
2. создать SIP.js SimpleUser
3. подключиться к signalingServer
4. зарегистрироваться как agent AOR
5. отправить Onelink статус operator_registered
```

UI состояния:

```text
offline
connecting
registered
registration_failed
```

### 6.3 Incoming ringing

При входящем INVITE:

```text
widget shows incoming call panel
plays ringtone locally
shows caller number
shows ingress number/channel
starts ring timeout timer
```

UI:

```text
Incoming call
Caller: +77066318623
Buttons: Answer / Decline
```

### 6.4 Answer

При Answer:

```text
stop ringtone
accept SIP/WebRTC session
attach remote stream to audio element
set state active
emit operator_answered event to Onelink
```

UI:

```text
active call timer
mute button
hangup button
connection quality indicator
```

### 6.5 Decline

При Decline:

```text
stop ringtone
reject incoming SIP session
set state registered/idle
emit operator_declined event to Onelink
```

### 6.6 Hangup

При Hangup:

```text
send SIP BYE
stop local/remote media tracks
clear active call state
emit operator_hangup event to Onelink
```

### 6.7 Cleanup

При закрытии страницы:

```text
hangup active session if any
disconnect SIP user
stop media tracks
set operator offline or stale-after-heartbeat
```

---

## 7. Что надо сделать в Onelink backend

### 7.1 Хранить операторские статусы

Минимальные статусы:

```text
offline
available
ringing
busy
wrap_up
unreachable
```

### 7.2 Хранить agent AOR

У каждого оператора должна быть связь:

```text
onelink_user_id -> fonoster_agent_ref -> sip_aor
```

Пример:

```json
{
  "user_id": 42,
  "agent_ref": "agent_ref_101",
  "sip_aor": "sip:agent-101@agents.vconsult.kz",
  "status": "available"
}
```

### 7.3 Route decision для входящего звонка

Когда `telephony-bridge` вызывает Onelink:

```http
POST /internal/voice/inbound/route
```

Onelink должен выбрать оператора и вернуть:

```json
{
  "action": "operator",
  "agent_aor": "sip:agent-101@agents.vconsult.kz",
  "reason": "available_operator_selected"
}
```

Важно: нельзя возвращать runtime app ref:

```text
96fc259c-6bcd-4cbf-bb7d-d2c51f248934
```

Это вызывает защитный reject:

```text
recursive_runtime_app_ref
```

### 7.4 Резервный route

Если операторов нет:

```json
{
  "action": "reject",
  "reason": "no_available_operator"
}
```

или, позже:

```json
{
  "action": "app",
  "app_ref": "REAL_AI_APP_REF",
  "reason": "fallback_to_ai"
}
```

### 7.5 Event ingestion

Onelink должен принимать события идемпотентно:

```text
session_started
decision_received
dial_status
answered
rejected
session_completed
session_failed
operator_answered
operator_declined
operator_hangup
```

Повторные события не должны давать 500.

---

## 8. Что надо сделать в telephony-bridge

### 8.1 Уже есть

```text
POST /internal/voice/inbound/route
POST /internal/voice/inbound/event
Onelink route forward
Onelink event forward
safe reject answer=false
recursive runtime app guard
```

### 8.2 Нужно добавить/проверить

1. Прокидывать `account_id` в body события, если runtime не прислал account id.
2. Нормализовать operator route:

```json
{
  "action": "operator",
  "agentAor": "sip:agent-101@agents.vconsult.kz"
}
```

3. Логировать route decision с `agentAor`, но без секретов.
4. Не блокировать звонок, если event forward в Onelink упал.
5. Добавить отдельные reason codes для:

```text
no_available_operator
agent_unregistered
agent_declined
agent_no_answer
caller_cancelled
```

---

## 9. Что надо сделать в voice-runtime

### 9.1 Уже есть

Runtime умеет:

```text
reject
operator
app/ai
emit events
dial destination/agentAor
hangup without answer for reject answer=false
```

### 9.2 Нужно проверить для браузерного оператора

1. `operator` route с `agent_aor` корректно превращается в dial target.
2. Runtime не проигрывает TTS перед operator dial, если это не нужно.
3. Dial status от agent leg корректно мапится:

```text
RINGING -> ringing
ANSWER -> answered
BUSY -> busy
NOANSWER -> no-answer
CANCEL -> failed
FAILED -> failed
COMPLETED -> completed
```

4. При agent decline/no-answer внешний PSTN leg завершается корректно.
5. При browser BYE звонок завершается на обеих сторонах.

### 9.3 Возможное улучшение

Для operator route лучше иметь явные события:

```text
operator_ringing
operator_answered
operator_declined
operator_no_answer
operator_hangup
```

Если Fonoster не дает такие события напрямую, их можно вывести из dial statuses.

---

## 10. Состояния звонка в Onelink UI

Минимальная state machine:

```text
idle
-> ringing
-> answering
-> active
-> ending
-> ended
```

Альтернативные ветки:

```text
ringing -> declined -> ended
ringing -> missed -> ended
ringing -> caller_cancelled -> ended
active -> operator_hangup -> ended
active -> caller_hangup -> ended
active -> failed -> ended
```

### 10.1 Ringing

Показывать:

```text
caller number
ingress number
channel
queue/route reason
answer button
decline button
```

### 10.2 Active

Показывать:

```text
call timer
mute/unmute
hangup
customer card
notes
event status
```

### 10.3 Ended

Показывать:

```text
duration
hangup cause
outcome
post-call notes
```

---

## 11. API между widget и Onelink

### 11.1 Получить webphone token

```http
POST /api/telephony/webphone/session
Authorization: Bearer <onelink_user_session>
```

Response:

```json
{
  "username": "agent-101",
  "domain": "agents.vconsult.kz",
  "displayName": "Operator 101",
  "signalingServer": "wss://<fonoster-host>/ws",
  "aor": "sip:agent-101@agents.vconsult.kz",
  "token": "short-lived-token",
  "expiresAt": "2026-04-20T12:00:00Z"
}
```

### 11.2 Обновить статус оператора

```http
POST /api/telephony/operators/me/status
```

Request:

```json
{
  "status": "available"
}
```

### 11.3 События widget

```http
POST /api/telephony/webphone/events
```

Request:

```json
{
  "event_type": "operator_answered",
  "call_ref": "8461ab63-bb21-42b4-b2e2-5cb92021da7d",
  "agent_aor": "sip:agent-101@agents.vconsult.kz",
  "occurred_at": "2026-04-20T12:00:00Z"
}
```

События должны быть идемпотентны по ключу:

```text
event_type + call_ref + agent_aor + occurred_at bucket/idempotency_key
```

---

## 12. SIP/WebRTC детали

### 12.1 Browser transport

Браузер не говорит обычный UDP/TCP SIP. Нужен:

```text
SIP over WebSocket Secure
WebRTC media
TLS/HTTPS origin
microphone permission
ICE/STUN/TURN
```

### 12.2 Media

Минимально:

```text
audio only
opus/pcmu compatibility
rtpengine/rtprelay for WebRTC <-> RTP
```

### 12.3 Network

Для production почти всегда нужен TURN:

```text
STUN helps discover public address
TURN relays media when NAT/firewall blocks direct path
```

Без TURN часть операторов будет видеть звонок, но без звука.

---

## 13. Безопасность

1. Не отдавать постоянный SIP пароль в frontend.
2. Webphone session token должен быть короткоживущим.
3. Token должен быть привязан к:

```text
workspace/account
operator user
agent aor
expiration
allowed signaling host
```

4. Все signaling/media endpoints должны быть TLS/WSS.
5. Логи не должны содержать SIP password, bearer token, shared secret.
6. Operator status нельзя менять без Onelink auth.
7. Route decision должен проверять, что agent принадлежит текущему account.

---

## 14. Наблюдаемость

Нужны единые correlation поля:

```text
call_ref
request_id
twilio_call_sid or provider_call_id
ingress_number
caller_number
agent_aor
account_id
route_reason
```

Логи должны отвечать на вопросы:

```text
дошел ли SIP INVITE
какой route decision вернул Onelink
какому agent звонили
получил ли browser INVITE
нажал ли оператор Answer
кто завершил звонок
почему звонок не соединился
```

---

## 15. Тестовый план

### 15.1 Unit/contract

1. Onelink route returns operator:

```json
{
  "action": "operator",
  "agent_aor": "sip:agent-101@agents.vconsult.kz"
}
```

2. Bridge normalizes to runtime decision:

```json
{
  "action": "operator",
  "agentAor": "sip:agent-101@agents.vconsult.kz"
}
```

3. Reject without `answer:true` remains:

```json
{
  "action": "reject",
  "answer": false
}
```

### 15.2 Manual SIP registration

```text
open Onelink operator UI
allow microphone
connect webphone
verify REGISTER in Routr logs
verify operator available in Onelink
```

### 15.3 Incoming answer

```text
call +18623964686 from phone
browser shows incoming call
operator clicks Answer
two-way audio works
Onelink call state active
operator clicks Hangup
Onelink call state ended
```

Expected events:

```text
session_started
decision_received
dial_status ringing
answered/operator_answered
session_completed
```

### 15.4 Incoming decline

```text
call +18623964686
browser shows incoming call
operator clicks Decline
caller leg ends
Onelink call state declined/ended
```

Expected events:

```text
session_started
decision_received
dial_status ringing
operator_declined
session_completed
```

### 15.5 Caller cancel

```text
call +18623964686
before operator answers, caller hangs up
browser ringing stops
Onelink call state caller_cancelled/ended
```

### 15.6 No operator available

```text
all operators offline
call +18623964686
Onelink returns reject no_available_operator
runtime hangs up without answer
```

### 15.7 Operator browser closed

```text
operator closes tab
status becomes offline after heartbeat TTL
new calls do not route to that agent
```

---

## 16. Приемочные критерии MVP

MVP считается готовым, когда:

1. Оператор открывает Onelink и становится `available`.
2. Browser widget успешно регистрируется как SIP/WebRTC agent.
3. Входящий PSTN звонок появляется в UI оператора как ringing.
4. Оператор может нажать Answer.
5. После Answer есть двусторонний звук.
6. Оператор может нажать Hangup.
7. Оператор может нажать Decline до ответа.
8. Если клиент положил трубку, UI оператора очищает звонок.
9. Onelink получает все lifecycle events без 500 на дублях.
10. Reject не отвечает на звонок и не запускает TTS.
11. `recursive_runtime_app_ref` больше не используется как нормальный route.

---

## 17. Порядок реализации

### Шаг 1. Fonoster WebRTC agent foundation

```text
create domain
create credentials
create agent
verify REGISTER
verify direct browser INVITE
```

### Шаг 2. Onelink webphone bootstrap

```text
backend endpoint for webphone session
short-lived token
operator <-> agent mapping
operator status model
```

### Шаг 3. Browser widget MVP

```text
sip.js connect/register
incoming call panel
answer
decline
hangup
media cleanup
heartbeat
```

### Шаг 4. Route operator from inbound

```text
Onelink route selects available operator
returns action=operator agent_aor
bridge normalizes
runtime dials agent
```

### Шаг 5. End-to-end event consistency

```text
session_started
decision_received
operator_ringing/dial_status
operator_answered/answered
operator_declined
operator_hangup
session_completed
```

### Шаг 6. Hardening

```text
TURN
reconnect
duplicate events
race handling
browser tab close
operator busy protection
observability
```

---

## 18. Что не делать

1. Не пытаться принимать входящий звонок из CRM по `call_ref` через admin API. Answer происходит внутри voice runtime/session.
2. Не возвращать runtime app ref как target для route.
3. Не хранить постоянный SIP пароль в localStorage.
4. Не запускать TTS на reject.
5. Не считать REGISTER достаточным: надо отдельно проверить audio.
6. Не считать inbound готовым, пока не проверены Answer, Decline и Hangup.

---

## 19. Короткая формула

Чтобы принимать входящие звонки с кнопками "снять трубку" и "остановить":

```text
Browser operator must be a SIP/WebRTC agent.
Onelink must route inbound calls to that agent.
voice-runtime must dial that agent.
Browser widget must handle incoming INVITE with Answer/Decline/Hangup.
Onelink must persist every lifecycle event idempotently.
```
