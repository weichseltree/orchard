#!/usr/bin/env bash
# Queue one exp run job per palace room on the cpu lane; the lane serialises them.
#   grove/tools/palace/bake_all.sh [samples] [room ...]
# First the whole palace is built once and checked: bounds, face collisions
# (same-plane overlaps, bodies inside each other), the facade against the
# rooms' openings. Nothing is queued unless that says CHECK OK: a defect that
# reaches a bake costs an hour of the lane and shows up as a black patch in a
# screenshot, if anyone looks.
# Each job: build the whole palace, bake that room, export it. Wait on one with
#   exp wait palace-<room> --done-when 'BAKE OK'
set -euo pipefail
cd "$(dirname "$0")/../../.."
SAMPLES="${1:-512}"; shift || true
ROOMS=("$@")
if [ ${#ROOMS[@]} -eq 0 ]; then
  ROOMS=(hall einstruct world-engine phototroph spectre greenhouse gallery orangery terrace parterre orchard-west orchard-south orchard-east)
fi
mkdir -p logs
BLENDER=/home/manuel/tools/blender/blender
exp run palace-check --prio 5 --lane cpu -- "$BLENDER" --background --python grove/tools/palace/palace.py -- --check
exp wait palace-check --done-when "CHECK OK" > logs/palace-check.log 2>&1 || true
grep "\[palace\] face\|\[palace\] CHECK\|vertices outside\|bounds overlap" logs/palace-check.log || true
grep -q "CHECK OK" logs/palace-check.log || { echo "palace: the check failed, nothing queued (logs/palace-check.log)"; exit 1; }
for room in "${ROOMS[@]}"; do
  res=2048
  case "$room" in
    gallery|orangery) res=4096; SAMPLES_R=$(( SAMPLES / 2 ));;
    greenhouse) res=1024; SAMPLES_R=$SAMPLES;;
    terrace|parterre) res=4096; SAMPLES_R=$(( SAMPLES / 2 ));;
    orchard-*) res=2048; SAMPLES_R=$(( SAMPLES / 4 ));;
    *) SAMPLES_R=$SAMPLES;;
  esac
  exp run "palace-$room" --prio 5 --lane cpu -- "$BLENDER" --background \
    --python grove/tools/palace/palace.py -- --room "$room" --samples "$SAMPLES_R" --res "$res"
done
