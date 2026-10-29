#!/usr/bin/env bash
# Usage: WORKER_URL=https://<name>.<sub>.workers.dev scripts/check-exposure.sh
# Fails unless each path answers an unauthenticated request with an Access redirect or 401/403.
set -u
: "${WORKER_URL:?set WORKER_URL}"
fail=0
for spec in GET:/ GET:/api/status GET:/api/activities POST:/api/sync; do
  m=${spec%%:*}; p=${spec#*:}
  out=$(curl -s -o /dev/null -X "$m" -w '%{http_code} %{redirect_url}' --max-time 15 "${WORKER_URL%/}$p")
  code=${out%% *}; loc=${out#* }
  if [[ $code == 401 || $code == 403 ]] || [[ $code == 30[1278] && $loc == *cloudflareaccess.com* ]]; then echo "ok   $m $p $code"
  else echo "FAIL $m $p $code"; fail=1; fi
done
exit $fail
