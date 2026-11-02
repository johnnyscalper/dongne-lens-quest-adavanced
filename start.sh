#!/usr/bin/env sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if command -v python3 >/dev/null 2>&1; then
  exec python3 server.py --host 127.0.0.1 --port 3000
elif command -v python >/dev/null 2>&1; then
  exec python server.py --host 127.0.0.1 --port 3000
else
  printf '%s\n' 'Python 3.11+ is needed for the server. Open play.html for the installation-free demo.' >&2
  exit 1
fi
