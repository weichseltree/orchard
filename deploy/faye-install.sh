#!/usr/bin/env bash
# Install or update Faye's live service. Idempotent: the same command is the
# first install and every later update.
#
#   deploy/faye-install.sh
#
# 1. Her worktree at ~/.local/share/orchard-faye, detached at origin/main.
#    Never the main checkout: a service restarting into whatever branch
#    someone has checked out is how an unreviewed change goes live.
# 2. Its locked dependencies.
# 3. The unit, with this machine's paths, and a restart.
#
# Needs ~/.config/orchard/faye.token (mode 600), made once with
#   pnpm tsx scripts/faye.ts --uri wss://maincloud.spacetimedb.com --live \
#     --token-file ~/.config/orchard/faye.token --new-identity
# and that identity made admin with the `add_admin` call it prints.
set -euo pipefail

repo="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
faye="${HOME}/.local/share/orchard-faye"
token="${HOME}/.config/orchard/faye.token"
node_bin="$(command -v node)"

[[ -f "$token" ]] || { echo "no $token: make her identity first (see the header of this script)" >&2; exit 2; }
[[ "$(stat -c %a "$token")" == "600" ]] || { echo "$token must be mode 600" >&2; exit 2; }

git -C "$repo" fetch --quiet origin main
if [[ -d "$faye/.git" || -f "$faye/.git" ]]; then
  git -C "$faye" checkout --quiet --detach origin/main
else
  mkdir -p "$(dirname "$faye")"
  git -C "$repo" worktree add --quiet --detach "$faye" origin/main
fi
echo "faye worktree at $(git -C "$faye" rev-parse --short HEAD)"

(cd "$faye/grove" && pnpm install --frozen-lockfile --silent)

unit_dir="${HOME}/.config/systemd/user"
mkdir -p "$unit_dir"
sed -e "s#@FAYE@#${faye}#g" -e "s#@HOME@#${HOME}#g" -e "s#@NODE@#${node_bin}#g" \
  "$repo/deploy/systemd/orchard-faye.service" > "$unit_dir/orchard-faye.service"
systemctl --user daemon-reload
systemctl --user enable --quiet orchard-faye.service
systemctl --user restart orchard-faye.service
sleep 8
systemctl --user --no-pager --lines=8 status orchard-faye.service || true
