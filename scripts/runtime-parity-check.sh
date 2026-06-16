#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

sha_host() {
  local path="$1"
  [[ -f "$path" ]] && sha256sum "$path" | awk '{print $1}' || printf 'MISSING'
}

sha_container() {
  local service="$1" path="$2" cid
  cid="$(docker compose ps -q "$service" 2>/dev/null || true)"
  [[ -n "$cid" ]] || { printf 'NO_CONTAINER'; return; }
  docker exec "$cid" sha256sum "$path" 2>/dev/null | awk '{print $1}' || printf 'MISSING'
}

compare_file() {
  local service="$1" host_path="$2" container_path="$3" hs cs verdict
  hs="$(sha_host "$host_path")"
  cs="$(sha_container "$service" "$container_path")"
  verdict=DIFF
  [[ "$hs" == "$cs" ]] && verdict=SAME
  printf '%s|%s->%s|host=%s|container=%s|%s\n' "$service" "$host_path" "$container_path" "$hs" "$cs" "$verdict"
}

compare_hash() {
  local service="$1" cid running current verdict
  cid="$(docker compose ps -q "$service" 2>/dev/null || true)"
  [[ -n "$cid" ]] || { printf '%s|NO_CONTAINER\n' "$service"; return; }
  running="$(docker inspect "$cid" --format '{{ index .Config.Labels "com.docker.compose.config-hash" }}' 2>/dev/null || true)"
  current="$(docker compose config --hash "$service" 2>/dev/null | awk '{print $2}' || true)"
  verdict=DIFF
  [[ -n "$current" && "$running" == "$current" ]] && verdict=SAME
  printf '%s|running_hash=%s|current_hash=%s|%s\n' "$service" "$running" "$current" "$verdict"
}

echo '=== image/bind runtime file parity ==='
compare_file telephony-bridge telephony-bridge/src/server.js /app/src/server.js
compare_file telephony-bridge telephony-bridge/src/config.js /app/src/config.js
compare_file telephony-bridge telephony-bridge/package.json /app/package.json
compare_file telephony-bridge telephony-bridge/package-lock.json /app/package-lock.json
compare_file telephony-bridge telephony-bridge/src/sipuniGateway.js /app/src/sipuniGateway.js
compare_file voice-runtime voice-runtime/src/runtime.js /app/src/runtime.js
compare_file voice-runtime voice-runtime/package.json /app/package.json
compare_file asterisk asterisk/config/extensions.conf /etc/asterisk/extensions.conf
compare_file asterisk asterisk/config/pjsip_sipuni.conf /etc/asterisk/pjsip_sipuni.conf
compare_file asterisk asterisk/run-sipuni.sh /run.sh
compare_file routr config/routr-patches/connect/service.js /service/node_modules/@routr/connect/dist/service.js
compare_file routr config/routr-patches/connect/router.js /service/node_modules/@routr/connect/dist/router.js
compare_file routr config/routr-patches/connect/handlers/register.js /service/node_modules/@routr/connect/dist/handlers/register.js
compare_file routr config/routr-patches/location/location.js /service/node_modules/@routr/location/dist/location.js

echo '=== compose config hash parity ==='
for svc in telephony-bridge voice-runtime apiserver routr asterisk; do
  compare_hash "$svc"
done

echo '=== git summary ==='
git status --short --branch --untracked-files=all
