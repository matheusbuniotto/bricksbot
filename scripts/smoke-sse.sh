#!/usr/bin/env bash
# X1 smoke: what the Databricks Apps gateway does to long streams and big uploads.
# Run it against a DEPLOYED dev App started with BRICKSBOT_DIAG=1 (the /api/_diag/* probes are off otherwise).
# Takes about 6 minutes. Record the output in docs/architecture.md ("Gateway limits (X1)").
#
#   scripts/smoke-sse.sh https://<app-url> [databricks-cli-profile]
#
# Auth: SMOKE_TOKEN (a user OAuth token) or `databricks auth token -p <profile>` (default profile: dev).
# Tunables (seconds unless noted), mainly so the script itself can be tried locally in a few seconds:
#   SMOKE_STREAM_TOTAL=300 SMOKE_CLOSE_AFTER=90 SMOKE_PROBE=150 SMOKE_SINK_DELAY=130 SMOKE_UPLOAD_MIB=25
set -uo pipefail

app_url="${1:?usage: scripts/smoke-sse.sh <app-url> [profile]}"
app_url="${app_url%/}"
profile="${2:-dev}"
stream_total="${SMOKE_STREAM_TOTAL:-300}"
close_after="${SMOKE_CLOSE_AFTER:-90}"
probe="${SMOKE_PROBE:-150}"
sink_delay="${SMOKE_SINK_DELAY:-130}"
upload_mib="${SMOKE_UPLOAD_MIB:-25}"

token="${SMOKE_TOKEN:-}"
if [[ -z "$token" ]] && command -v databricks >/dev/null; then
  token="$(databricks auth token -p "$profile" -o json 2>/dev/null | sed -n 's/.*"access_token": *"\([^"]*\)".*/\1/p')"
fi
auth=()
[[ -n "$token" ]] && auth=(-H "Authorization: Bearer $token")

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
failures=0
report() { # status check detail
  printf '%-5s %-34s %s\n' "$1" "$2" "$3"
  if [[ "$1" == FAIL ]]; then failures=$((failures + 1)); fi
}

# (a) SSE held for stream_total seconds, server closes every close_after seconds, client reconnects
# with Last-Event-ID. Ticks arrive every 5 s and a heartbeat comment every 10 s.
echo "== (a) SSE ${stream_total}s with a server-side close every ${close_after}s"
started=$SECONDS
last_id=0
connections=0
max_gap=0
gaps=0
early_cuts=0
first_byte_slow=0
while ((SECONDS - started < stream_total)); do
  connections=$((connections + 1))
  conn_start=$SECONDS
  prev_line=$SECONDS
  first=1
  prev_id=$last_id
  while IFS= read -r line; do
    now=$SECONDS
    if ((first)); then
      ((now - conn_start > 3)) && first_byte_slow=$((first_byte_slow + 1))
      first=0
    fi
    gap=$((now - prev_line))
    ((gap > max_gap)) && max_gap=$gap
    prev_line=$now
    if [[ "$line" == id:* ]]; then
      id="${line#id: }"
      ((id != prev_id + 1)) && gaps=$((gaps + 1))
      prev_id=$id
      last_id=$id
    fi
  done < <(curl -sN --max-time $((close_after + 30)) -D "$work/headers.$connections" "${auth[@]}" \
    -H "Last-Event-ID: $last_id" \
    "$app_url/api/_diag/stream?seconds=$stream_total&closeAfter=$close_after&heartbeat=10&tickEvery=5")
  lasted=$((SECONDS - conn_start))
  echo "   connection $connections lasted ${lasted}s, last id $last_id"
  ((lasted < close_after - 5)) && early_cuts=$((early_cuts + 1))
  ((lasted < 1)) && break # not reachable (404, auth): stop instead of spinning
done
encoding="$(grep -i '^content-encoding:' "$work/headers.1" 2>/dev/null | tr -d '\r' || true)"
((connections >= 2 || stream_total <= close_after)) && report INFO "(a) connections" "$connections over $((SECONDS - started))s"
((early_cuts == 0)) && report PASS "(a) held until server close" "no connection cut before ${close_after}s" ||
  report FAIL "(a) held until server close" "$early_cuts connection(s) cut early"
((first_byte_slow == 0)) && report PASS "(a) not buffered" "first line within 3s on every connection" ||
  report FAIL "(a) not buffered" "$first_byte_slow connection(s) waited more than 3s for the first line"
((max_gap <= 12)) && report PASS "(a) ticks/heartbeat arrive" "largest gap ${max_gap}s" ||
  report FAIL "(a) ticks/heartbeat arrive" "largest gap ${max_gap}s (expected <= 12s)"
((gaps == 0)) && report PASS "(a) Last-Event-ID replay" "ids continuous across reconnects" ||
  report FAIL "(a) Last-Event-ID replay" "$gaps id gap(s)"
report INFO "(a) content-encoding" "${encoding:-none}"

# (b) idle vs absolute cut: same duration, one probe silent, one with traffic. Run in parallel.
echo "== (b) idle vs absolute gateway cut (${probe}s probes)"
probe_url="$app_url/api/_diag/stream?seconds=$probe&closeAfter=$probe"
curl -sN -o /dev/null -w '%{time_total}' --max-time $((probe + 30)) "${auth[@]}" "$probe_url&heartbeat=0&tickEvery=0" >"$work/idle" 2>/dev/null &
curl -sN -o /dev/null -w '%{time_total}' --max-time $((probe + 30)) "${auth[@]}" "$probe_url&heartbeat=10&tickEvery=5" >"$work/busy" 2>/dev/null &
wait
idle="$(cut -d. -f1 "$work/idle")"
busy="$(cut -d. -f1 "$work/busy")"
idle="${idle:-0}"
busy="${busy:-0}"
((idle >= probe - 5)) && report PASS "(b) idle connection" "open ${idle}s, no idle cut" ||
  report INFO "(b) idle connection" "cut after ${idle}s with no traffic (idle timeout)"
((busy >= probe - 5)) && report PASS "(b) busy connection" "open ${busy}s, no absolute cut" ||
  report INFO "(b) busy connection" "cut after ${busy}s despite traffic (absolute timeout)"

# (c) upload through the gateway
echo "== (c) ${upload_mib} MiB upload"
head -c $((upload_mib * 1024 * 1024)) /dev/urandom >"$work/blob"
want="$(shasum -a 256 "$work/blob" | cut -d' ' -f1)"
code="$(curl -sS -o "$work/upload.json" -w '%{http_code} %{time_total}' --max-time 300 "${auth[@]}" \
  -H 'Content-Type: application/octet-stream' --data-binary "@$work/blob" "$app_url/api/_diag/upload" 2>"$work/upload.err")"
if [[ "$code" == 200* ]] && grep -q "$want" "$work/upload.json"; then
  report PASS "(c) ${upload_mib} MiB upload" "intact, HTTP/time: $code"
else
  report FAIL "(c) ${upload_mib} MiB upload" "HTTP/time: $code $(head -c 200 "$work/upload.json" 2>/dev/null) $(head -c 200 "$work/upload.err")"
fi

# (d) a sink slower than the gateway timeout
echo "== (d) upload whose sink takes ${sink_delay}s"
head -c 1048576 /dev/urandom >"$work/small"
code="$(curl -sS -o "$work/sink.json" -w '%{http_code} %{time_total}' --max-time $((sink_delay + 60)) "${auth[@]}" \
  -H 'Content-Type: application/octet-stream' --data-binary "@$work/small" \
  "$app_url/api/_diag/upload?sinkDelaySec=$sink_delay" 2>"$work/sink.err")"
if [[ "$code" == 200* ]]; then
  report INFO "(d) slow sink" "answered after ${sink_delay}s, no cut (HTTP/time: $code)"
else
  report INFO "(d) slow sink" "cut (HTTP/time: $code $(head -c 120 "$work/sink.err")), so uploads must finish well under the timeout"
fi

echo
((failures == 0)) && echo "X1: no FAIL. Copy the table above into docs/architecture.md." ||
  echo "X1: $failures FAIL. If (a) fails, 1.3 falls back to polling only; if (c) fails, lower the upload limit (PR 2.4/3.3)."
exit $((failures > 0))
