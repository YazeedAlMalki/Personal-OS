#!/usr/bin/env bash
# Install and run Laya (the app's classifier) on the homelab, next to ai_gateway.py.
# laya-serve binds to localhost only; the gateway forwards /v1/systemone to it and
# does the bearer-token check, so Laya itself needs no key.
#
#   bash homelab/setup_laya.sh          # install (once), then serve in the foreground
#
# Then set on Vercel: AI_CLASSIFIER=laya (it reuses OLLAMA_BASE_URL + LOCAL_AI_TOKEN).
set -euo pipefail

VENV="${LAYA_VENV:-$HOME/venvs/laya}"

if [ ! -x "$VENV/bin/laya-serve" ]; then
  python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' || { echo "Laya needs Python 3.10+" >&2; exit 1; }
  python3 -m venv "$VENV"
  "$VENV/bin/python" -m pip install --upgrade pip
  "$VENV/bin/python" -m pip install "laya[serve]"
fi

export LAYA_HOST=127.0.0.1
export LAYA_PORT="${LAYA_PORT:-8000}"
export LAYA_MODELS="${LAYA_MODELS:-convaiinnovations/laya}"  # English checkpoint, 421M
export LAYA_PRELOAD=1  # download and load at startup, not on the first capture
exec "$VENV/bin/laya-serve"
