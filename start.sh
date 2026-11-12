#!/usr/bin/env bash
# Qwen-Image 2.1 Studio — one command to run it.
#
#   ./start.sh              # http://127.0.0.1:7866
#   PORT=9000 ./start.sh    # another port
#
# First run builds .venv and installs requirements.txt; config.json is created from
# config.example.json on first start, so nothing needs editing by hand — point the app at your
# ComfyUI folder in the Models tab.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
PORT="${PORT:-7866}"

PY="${PYTHON:-python3}"
if [ ! -d ".venv" ]; then
  echo "[start] creating .venv"
  "$PY" -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
if [ ! -f ".venv/.requirements-installed" ]; then
  echo "[start] installing requirements"
  pip install --quiet --upgrade pip
  pip install --quiet -r requirements.txt
  touch .venv/.requirements-installed
fi

# LD_LIBRARY_PATH from a linuxbrew shell breaks the venv's compiled modules; PYTHONPATH can
# shadow them with another project's packages. Neither belongs in this process.
exec env -u LD_LIBRARY_PATH -u PYTHONPATH PORT="$PORT" python server.py
