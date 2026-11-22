#!/bin/zsh
# Sincronizza questa cartella con GitHub (branch main):
# scarica le novità da GitHub, poi pubblica le modifiche locali.
# Lo lancia launchd ogni 15 minuti; si può anche eseguire a mano: ./sync.sh
set -u
cd "$(dirname "$0")" || exit 1
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin:$PATH"
LOG=".sync.log"
LOCK=".git/sync.lock"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
notify() { osascript -e "display notification \"$1\" with title \"Sync sito GitHub\"" 2>/dev/null; }

# Evita due esecuzioni insieme
mkdir "$LOCK" 2>/dev/null || exit 0
trap 'rmdir "$LOCK"' EXIT

# Se un merge/rebase è in corso, non toccare nulla
if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ] || [ -f .git/MERGE_HEAD ]; then
  log "STOP: merge o rebase in corso, sync saltato"; exit 1
fi
[ "$(git branch --show-current)" = "main" ] || { log "STOP: non sono su main"; exit 1; }

# 1. Salva le modifiche locali in un commit
git add -A
if ! git diff --cached --quiet; then
  git commit -q -m "Sync automatico $(date '+%Y-%m-%d %H:%M')" && log "commit locale creato"
fi

# 2. Scarica da GitHub (rebase dei commit locali sopra quelli remoti)
if ! git pull -q --rebase origin main >> "$LOG" 2>&1; then
  git rebase --abort 2>/dev/null
  log "ERRORE: conflitto con GitHub, risolvere a mano"
  notify "Conflitto con GitHub: sync fermo, serve un intervento"
  exit 1
fi

# 3. Pubblica
if [ -n "$(git log origin/main..HEAD --oneline)" ]; then
  if git push -q origin main >> "$LOG" 2>&1; then log "push ok"
  else log "ERRORE: push fallito"; notify "Push su GitHub fallito"; exit 1; fi
fi
