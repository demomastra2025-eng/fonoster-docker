# Fonoster API control for virtual PBX + live voice AI

`fonoster-control.js` is an API-first CLI that provisions and manages the Fonoster resources you need for an AI voice flow:

- voice runtime application (`EXTERNAL`)
- operator agent
- trunk (optional)
- inbound DID routing
- call/test-token helpers

The script is designed to work with the existing `.env` from `fonoster-docker` and uses `@fonoster/sdk` only.

## Install

```bash
cd /root/fonoster-docker/fonoster-apikeys-demo
npm install
```

## Credentials (choose one)

### API key (preferred)

- `FONOSTER_ACCESS_KEY_ID`
- `FONOSTER_ACCESS_KEY_SECRET`

or

- `TELEPHONY_BRIDGE_FONOSTER_ACCESS_KEY_ID`
- `TELEPHONY_BRIDGE_FONOSTER_ACCESS_KEY_SECRET`

### Owner credentials fallback

- `FONOSTER_USERNAME` + `FONOSTER_PASSWORD`
- or `TELEPHONY_BRIDGE_FONOSTER_USERNAME` + `TELEPHONY_BRIDGE_FONOSTER_PASSWORD`

Endpoint:

- `FONOSTER_API_ENDPOINT` (fallback `TELEPHONY_BRIDGE_FONOSTER_ENDPOINT`, default `envoy:8449`)

## Core workflow

```bash
npm run bootstrap
npm run status
```

`bootstrap` will:

1. create/update voice application
2. create/update operator agent
3. create/update trunk (if trunk vars are present)
4. create/update number with route (`ai` or `operator`)

## Useful commands

```bash
npm run route:ai         # route current number to AI app
npm run route:operator   # route current number to operator aor
npm run route:clear      # clear explicit app/operator route on current number
npm run call            # create outbound call from --from to --to
npm run token           # create test webphone token
```

## Important env variables

- `VOICE_RUNTIME_APP_NAME`
- `VOICE_RUNTIME_APP_ENDPOINT`
- `VOICE_RUNTIME_APP_REF` (optional override)
- `VOICE_RUNTIME_STT_PRODUCT_REF`
- `VOICE_RUNTIME_TTS_PRODUCT_REF`
- `VOICE_RUNTIME_STT_LANGUAGE_CODE`
- `VOICE_RUNTIME_TTS_VOICE`
- `VOICE_RUNTIME_OPERATOR_AGENT_USERNAME`
- `VOICE_RUNTIME_OPERATOR_AGENT_AOR`
- `VOICE_RUNTIME_OPERATOR_AGENT_REF`
- `FONOSTER_TRUNK_NAME`
- `FONOSTER_TRUNK_INBOUND_URI`
- `FONOSTER_TRUNK_HOST`
- `FONOSTER_TRUNK_PORT`
- `INBOUND_DID`
- `INBOUND_ROUTE_MODE=ai|operator|clear`
- `CALL_FROM`
- `CALL_TO`

## Overrides by CLI flags

Any variable can be passed as `--key value` (or `--key=value`) and will override env.

Examples:

```bash
node ./fonoster-control.js bootstrap --auth-mode=apikey --number-route-mode=operator
node ./fonoster-control.js route --number-route-mode=clear --number-ref=00000000-0000-0000-0000-000000000000
node ./fonoster-control.js call --from=+15551234567 --to=+15557654321 --call-timeout=30
node ./fonoster-control.js token
```
