#!/usr/bin/env bash
# Install or update the club floor's stream service. Idempotent: the same
# command is the first install and every later update.
#
#   deploy/stream/install.sh
#
# 1. Its worktree at ~/.local/share/orchard-stream/repo, detached at origin/main.
#    Never the main checkout: a service restarting into whatever branch
#    someone has checked out is how an unreviewed change goes live.
# 2. Its locked Python environment (uv sync --locked).
# 3. The unit, with this machine's paths, and a restart.
#
# Needs ~/.config/orchard/secrets.env with CLOUDFLARE_R2_TOKEN (or
# CLOUDFLARE_API_TOKEN) and CLOUDFLARE_ACCOUNT_ID, ffmpeg on the PATH, and the
# SpacetimeDB CLI logged in as an identity the module lets read `whereabouts`.
# Licensed tracks go in ~/.local/share/orchard-stream/tracks; with none, the
# seeded set plays (orchard/setgen.py).
set -euo pipefail

repo="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel)"
home_dir="${HOME}/.local/share/orchard-stream"
tree="${home_dir}/repo"
uv_bin="$(command -v uv)"

secrets="${HOME}/.config/orchard/secrets.env"
[[ -f "$secrets" ]] || { echo "no $secrets: the uploader needs the R2 token" >&2; exit 2; }
[[ "$(stat -c %a "$secrets")" == "600" ]] || { echo "$secrets must be mode 600" >&2; exit 2; }
grep -q '^CLOUDFLARE_ACCOUNT_ID=' "$secrets" || { echo "$secrets has no CLOUDFLARE_ACCOUNT_ID" >&2; exit 2; }
grep -Eq '^CLOUDFLARE_(R2_|API_)TOKEN=' "$secrets" || { echo "$secrets has no CLOUDFLARE_R2_TOKEN or CLOUDFLARE_API_TOKEN" >&2; exit 2; }
command -v ffmpeg >/dev/null || { echo "ffmpeg is not installed" >&2; exit 2; }
command -v spacetime >/dev/null || { echo "the spacetime CLI is not installed" >&2; exit 2; }

git -C "$repo" fetch --quiet origin main
if [[ -d "$tree/.git" || -f "$tree/.git" ]]; then
  git -C "$tree" checkout --quiet --detach origin/main
else
  mkdir -p "$home_dir/tracks"
  git -C "$repo" worktree add --quiet --detach "$tree" origin/main
fi
echo "stream worktree at $(git -C "$tree" rev-parse --short HEAD)"

(cd "$tree" && "$uv_bin" sync --locked --quiet)

unit_dir="${HOME}/.config/systemd/user"
mkdir -p "$unit_dir"
sed -e "s#@STREAM@#${tree}#g" -e "s#@HOME@#${HOME}#g" -e "s#@UV@#${uv_bin}#g" \
  "$repo/deploy/stream/orchard-stream.service" > "$unit_dir/orchard-stream.service"
systemctl --user daemon-reload
systemctl --user enable --quiet orchard-stream.service
systemctl --user restart orchard-stream.service
sleep 5
systemctl --user --no-pager --lines=8 status orchard-stream.service || true
