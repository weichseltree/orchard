#!/usr/bin/env bash
# Queue one exprun job per palace room on the cpu lane; the lane serialises them.
#   grove/tools/palace/bake_all.sh [samples] [room ...]
# Each job: build the whole palace, bake that room, export it. Wait on one with
#   exp wait palace-<room> --done-when 'BAKE OK'
set -euo pipefail
cd "$(dirname "$0")/../../.."
SAMPLES="${1:-512}"; shift || true
ROOMS=("$@")
if [ ${#ROOMS[@]} -eq 0 ]; then ROOMS=(hall einstruct world-engine phototroph spectre greenhouse gallery orangery); fi
mkdir -p logs
for room in "${ROOMS[@]}"; do
  res=2048
  case "$room" in
    gallery|orangery) res=4096; SAMPLES_R=$(( SAMPLES / 2 ));;
    greenhouse) res=1024; SAMPLES_R=$SAMPLES;;
    terrace|parterre) res=4096; SAMPLES_R=$(( SAMPLES / 2 ));;
    orchard-*) res=2048; SAMPLES_R=$(( SAMPLES / 4 ));;
    *) SAMPLES_R=$SAMPLES;;
  esac
  exp run "palace-$room" --prio 5 --lane cpu -- /home/manuel/tools/blender/blender --background \
    --python grove/tools/palace/palace.py -- --room "$room" --samples "$SAMPLES_R" --res "$res"
done
