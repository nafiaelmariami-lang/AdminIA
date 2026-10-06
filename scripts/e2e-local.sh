#!/usr/bin/env bash
# Tests navigateur complets sur un build de production LOCAL.
#
#   E2E_DATABASE_URL=postgres://adminia:…@127.0.0.1:5432/adminia_e2e scripts/e2e-local.sh [filtre playwright]
#
# Sécurité : la base doit être LOCALE et jetable (localhost / 127.0.0.1 / ::1). Toute autre adresse
# (Supabase, hébergeur, production) est refusée. Aucune clé ni donnée réelle n'est utilisée :
# clé de chiffrement générée à la volée, IA de démonstration, e-mails écrits dans un dossier temporaire.
# Options : SKIP_BUILD=1 (réutiliser .next), CHROMIUM_PATH=/chemin/chromium, PORT (défaut 3000).
# Bêta sans e-mail : E2E_EMAIL_DRIVER=disabled scripts/e2e-local.sh beta-sans-email
set -euo pipefail
cd "$(dirname "$0")/.."

: "${E2E_DATABASE_URL:?Définissez E2E_DATABASE_URL (base PostgreSQL locale et jetable)}"
host=$(node -e 'const u=new URL(process.argv[1]);console.log(u.hostname.replace(/^\[|\]$/g,""))' "$E2E_DATABASE_URL")
case "$host" in
  localhost|127.0.0.1|::1) ;;
  *) echo "Refus : E2E_DATABASE_URL doit pointer vers une base locale (hôte reçu : $host)." >&2; exit 1 ;;
esac

PORT="${PORT:-3000}"
work=$(mktemp -d)
server_pid=""
cleanup() {
  if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

export NODE_ENV=production
export APP_URL="http://localhost:$PORT"
export DATABASE_URL="$E2E_DATABASE_URL"
export STORAGE_DIR="$work/files"
export STORAGE_ENCRYPTION_KEY=$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')
export AI_PROVIDER=mock
export EMAIL_DRIVER="${E2E_EMAIL_DRIVER:-outbox}"
[ "$EMAIL_DRIVER" = "disabled" ] && export E2E_EMAIL_DISABLED=1
export EMAIL_OUTBOX_DIR="$work/outbox"
export EMAIL_OUTBOX_IN_PRODUCTION_FOR_TESTS=true
export ADMIN_EMAILS="e2e-admin-desktop@exemple.fr,e2e-admin-mobile@exemple.fr"
mkdir -p "$EMAIL_OUTBOX_DIR"

[ "${SKIP_BUILD:-}" = "1" ] || npm run -s build
npm run -s db:migrate
# Un ancien serveur encore actif fausserait les résultats : on refuse de continuer.
if curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
  echo "Refus : le port $PORT est déjà utilisé par un autre serveur. Arrêtez-le d'abord." >&2
  exit 1
fi
# Lancement direct (sans npx) : le processus suivi est bien le serveur, arrêté en fin de script.
node node_modules/next/dist/bin/next start -p "$PORT" > "$work/server.log" 2>&1 &
server_pid=$!
for _ in $(seq 1 60); do curl -sf "http://localhost:$PORT/api/health" >/dev/null && break; sleep 1; done
curl -sf "http://localhost:$PORT/api/health" >/dev/null || { echo "Le serveur n'a pas démarré :"; tail -30 "$work/server.log"; exit 1; }

E2E_BASE_URL="http://localhost:$PORT" E2E_OUTBOX_DIR="$EMAIL_OUTBOX_DIR" npx playwright test "$@"
