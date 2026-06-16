#!/usr/bin/env bash
set -euo pipefail
SINCE="${1:-15m}"
echo "== time =="
date -Is
echo

echo "== containers =="
docker compose ps apiserver asterisk routr rtpengine voice-runtime telephony-bridge envoy

echo

echo "== live routing =="
docker exec fonoster-docker-postgres-1 sh -lc 'psql -U "$POSTGRES_USER" -d routr -P pager=off -c "select tel_url,aor_link,extra_headers,updated_at from numbers order by updated_at desc;"'
docker exec fonoster-docker-postgres-1 sh -lc 'psql -U "$POSTGRES_USER" -d fonoster -P pager=off -c "select ref,name,type,endpoint,updated_at from applications order by updated_at desc;"'

echo

echo "== asterisk channels/registration =="
docker exec fonoster-docker-asterisk-1 asterisk -rx 'core show channels concise' || true
docker exec fonoster-docker-asterisk-1 asterisk -rx 'pjsip show registrations' || true

echo

echo "== recent errors/warnings =="
for c in fonoster-docker-apiserver-1 fonoster-docker-asterisk-1 fonoster-docker-voice-runtime-1 fonoster-docker-telephony-bridge-1 fonoster-docker-routr-1; do
  echo "--- $c ---"
  docker logs --since "$SINCE" "$c" 2>&1 | grep -Ei 'error|warn|exception|unhandled|ECONNRESET|Channel not found|hangup failed|failed|Stasis|MixMonitor|recording|call' | tail -120 || true
 done
