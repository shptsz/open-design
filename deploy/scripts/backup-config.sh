#!/usr/bin/env bash
# Back up the site-specific deployment files with a timestamp suffix.
#
# Defaults target /opt/open-design, where the production compose file,
# config/*.env, and opencode/opencode.json live. The backups contain
# credentials, so the output directory is 0700 and each copy is 0600.
#
# Usage:
#   sudo bash deploy/scripts/backup-config.sh
#   sudo bash deploy/scripts/backup-config.sh --root /opt/open-design --out /opt/open-design/backup
#
# Environment overrides:
#   ROOT_DIR, BACKUP_DIR, TIMESTAMP
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-/opt/open-design}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backup}"
TIMESTAMP="${TIMESTAMP:-$(date +%Y%m%d-%H%M%S)}"

usage() {
  cat <<'EOF'
Usage: backup-config.sh [options]

Options:
  --root <dir>   Deployment root. Default: /opt/open-design
  --out <dir>    Backup directory. Default: <root>/backup
  --stamp <ts>   Timestamp suffix. Default: YYYYmmdd-HHMMSS
  -h, --help     Show this help.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --root)
      ROOT_DIR="${2:?--root needs a value}"
      BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backup}"
      shift 2
      ;;
    --out)
      BACKUP_DIR="${2:?--out needs a value}"
      shift 2
      ;;
    --stamp)
      TIMESTAMP="${2:?--stamp needs a value}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

FILES=(
  "docker-compose.yml"
  "config/config.env"
  "config/secrets.env"
  "opencode/opencode.json"
)

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

count=0
for rel in "${FILES[@]}"; do
  src="$ROOT_DIR/$rel"
  if [ ! -f "$src" ]; then
    echo "skip (missing): $src" >&2
    continue
  fi

  base="$(basename "$rel")"
  if [[ "$base" == *.* ]]; then
    stem="${base%.*}"
    ext=".${base##*.}"
  else
    stem="$base"
    ext=""
  fi

  dest="$BACKUP_DIR/${stem}.${TIMESTAMP}${ext}"
  cp -p "$src" "$dest"
  chmod 600 "$dest"
  echo "backup: $src -> $dest"
  count=$((count + 1))
done

if [ "$count" -eq 0 ]; then
  echo "no files were backed up under $ROOT_DIR" >&2
  exit 1
fi

echo "done: $count file(s) in $BACKUP_DIR"
