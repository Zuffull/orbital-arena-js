#!/usr/bin/env bash
set -euo pipefail
image="$1"
sha="$2"
cid="$(docker run -d -p 127.0.0.1:38661:3000 \
  -e PUBLIC_ORIGINS=http://127.0.0.1:38661 -e MAX_IP_CONNECTIONS=6 "$image")"
log="$(mktemp)"
trap 'docker logs "$cid" || true; docker rm -f "$cid" >/dev/null 2>&1 || true; cat "$log"; rm -f "$log"' EXIT
for _ in {1..50}; do
  if curl --fail --silent http://127.0.0.1:38661/health; then break; fi
  sleep .2
done
test "$(docker exec "$cid" id -u)" != 0
test "$(docker image inspect --format '{{.Size}}' "$image")" -lt 200000000
docker exec "$cid" node -e 'try { require.resolve("vitest"); process.exit(1) } catch {}'
EXPECT_SHA="$sha" node scripts/container-smoke.mjs > "$log" 2>&1 &
smoke=$!
for _ in {1..100}; do
  if grep -q READY_FOR_STOP "$log"; then break; fi
  if ! kill -0 "$smoke" 2>/dev/null; then wait "$smoke"; exit 1; fi
  sleep .15
done
grep -q READY_FOR_STOP "$log"
start="$(date +%s%3N)"
docker stop -t 9 "$cid"
elapsed="$(( $(date +%s%3N) - start ))"
test "$elapsed" -lt 10000
test "$(docker inspect --format '{{.State.ExitCode}}' "$cid")" = 0
wait "$smoke"
echo "docker stop completed in ${elapsed} ms"
