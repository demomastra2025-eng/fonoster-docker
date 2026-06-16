#!/usr/bin/env bash
set -euo pipefail
DURATION="${1:-20m}"
LABEL="${2:-focused-call}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/logs/focused-call"
mkdir -p "$OUT_DIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$OUT_DIR/${TS}-${LABEL}.log"
SINCE="$(date -u -Is)"
FILTER='route_decision|decision_received|operatorObservabilityKey|operatorSlaClass|recordingImportContract|transcriptContract|session_started|StartStreamResponse|stream_ref|streamRef|media_session_ref|mediaSessionRef|runtime_call_ref|runtimeCallRef|AUDIO_OUT|first.*audio|audio.*out|terminal|finalize|recording|transcript|hangup|CANCEL|ANSWER|error|warn|failed'
{
  echo "# focused call monitor"
  echo "started_at=$SINCE"
  echo "duration=$DURATION"
  echo "label=$LABEL"
  echo
  echo "## docker compose ps"
  docker compose ps apiserver asterisk routr rtpengine voice-runtime telephony-bridge envoy || true
  echo
  echo "## live routing snapshot"
  docker exec fonoster-docker-postgres-1 sh -lc 'psql -U "$POSTGRES_USER" -d routr -P pager=off -c "select tel_url,aor_link,extra_headers,updated_at from numbers order by updated_at desc;"' || true
  docker exec fonoster-docker-postgres-1 sh -lc 'psql -U "$POSTGRES_USER" -d fonoster -P pager=off -c "select ref,name,type,endpoint,updated_at from applications order by updated_at desc;"' || true
  echo
  echo "## asterisk pre-call channels"
  docker exec fonoster-docker-asterisk-1 asterisk -rx 'core show channels concise' || true
  echo
  echo "## following logs since $SINCE"
} | tee "$OUT"

# Follow focused logs for the call window. timeout exits non-zero when time elapses; that's OK.
timeout "$DURATION" sh -c "docker logs --since '$SINCE' -f fonoster-docker-telephony-bridge-1 2>&1 & docker logs --since '$SINCE' -f fonoster-docker-voice-runtime-1 2>&1 & docker logs --since '$SINCE' -f fonoster-docker-asterisk-1 2>&1 & docker logs --since '$SINCE' -f fonoster-docker-apiserver-1 2>&1 & wait" \
  | grep -Eai --line-buffered "$FILTER" \
  | tee -a "$OUT" || true

{
  echo
  echo "## post-call snapshot $(date -u -Is)"
  docker exec fonoster-docker-asterisk-1 asterisk -rx 'core show channels concise' || true
  echo
  echo "## recent focused events from telephony bridge"
  curl -fsS 'http://127.0.0.1:38081/telephony/events/poll?limit=50' || true
  echo
  echo "log_file=$OUT"
} | tee -a "$OUT"

echo "$OUT"
