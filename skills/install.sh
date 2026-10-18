#!/usr/bin/env bash
# Install the Adwarp skills into an agent's skills directory.
# Default: symlink (git pull keeps them current). --copy to copy instead.
#
# Skills were called liam-* and gads-launch before the rename. Those names stay in
# this folder as links to the new ones, so existing installs keep working. Running
# this script again swaps an install over to the adwarp-* names.
set -euo pipefail

MODE="${1:-link}"
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"

mkdir -p "$DEST"

# Old-name links this script made earlier point into this folder; remove them.
for target in "$DEST"/liam-* "$DEST"/gads-launch; do
  [ -L "$target" ] || continue
  case "$(readlink "$target")" in
    "$SRC"/*)
      rm "$target"
      echo "removed $(basename "$target") (renamed to adwarp-*)"
      ;;
  esac
done

for dir in "$SRC"/adwarp-*/; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  target="$DEST/$name"
  if [ -e "$target" ] && [ ! -L "$target" ] && [ "$MODE" != "--copy" ]; then
    echo "skip    $name (a real directory already exists at $target; remove it or use --copy)"
    continue
  fi
  rm -rf "$target"
  if [ "$MODE" = "--copy" ]; then
    cp -R "${dir%/}" "$target"
    echo "copied  $name -> $target"
  else
    ln -sfn "${dir%/}" "$target"
    echo "linked  $name -> $target"
  fi
done

echo
echo "Done. Restart your Claude Code session to pick up the skills."
