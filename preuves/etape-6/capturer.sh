#!/usr/bin/env bash
# Étape 6 : un compteur à l'entrée.
# Prérequis : API lancée avec TRUST_PROXY=true (sinon tous les clients locaux
# partagent la même IP et on ne peut pas en simuler deux) et les limites par défaut (60 / 1 par s).
#   TRUST_PROXY=true bun run dev   puis   bash preuves/etape-6/capturer.sh > preuves/etape-6/captures.txt
set -euo pipefail
cd "$(dirname "$0")/.."; source ./lib.sh
CODES=$(mktemp); trap 'rm -f "$CODES"' EXIT
PSQL="docker exec miamzy-db-1 psql -U miamzy -d miamzy -At"
as() { local ip=$1; shift; curl -s -H "X-Forwarded-For: $ip" "$@"; }

USER_ID=$(as 10.9.9.9 "$API/v1/orders?limit=1" | jq -r '.data[0].userId')

echo "# Étape 6 : limitation de débit (seau de 60 jetons, recharge 1 par seconde, par IP)"

echo; echo "### A. 200 requêtes d'affilée depuis un même client (10.0.0.1)"
for i in $(seq 1 200); do as 10.0.0.1 -o /dev/null -w '%{http_code}\n' "$API/v1/users/$USER_ID"; done | sort | uniq -c | awk '{printf "HTTP %s : %s requêtes\n", $2, $1}'

echo; echo "### B. Ce que reçoit le client refusé : 429, Retry-After, message qui dit quand réessayer"
OUT=$(curl -si -H "X-Forwarded-For: 10.0.0.1" "$API/v1/users/$USER_ID" | tr -d '\r')
printf '%s\n\n' "${OUT%%$'\n\n'*}"; printf '%s' "${OUT#*$'\n\n'}" | jq .
WAIT=$(grep -i '^retry-after:' <<<"$OUT" | awk '{print $2}')

echo; echo "### C. Un SECOND client n'est pas bloqué pendant que le premier l'est"
echo "client 10.0.0.1 -> HTTP $(as 10.0.0.1 -o /dev/null -w '%{http_code}' "$API/v1/users/$USER_ID")  (toujours limité)"
echo "client 10.0.0.2 -> HTTP $(as 10.0.0.2 -o /dev/null -w '%{http_code}' "$API/v1/users/$USER_ID")"

echo; echo "### D. Après avoir attendu Retry-After ($WAIT s), le client refusé repasse"
sleep "$WAIT"
echo "client 10.0.0.1 -> HTTP $(as 10.0.0.1 -o /dev/null -w '%{http_code}' "$API/v1/users/$USER_ID")"

echo; echo "### E. Une requête refusée ne touche PAS la base"
echo "Mesure : lectures de la table users (seq_scan + idx_scan, compteurs Postgres)."
echo "GET /v1/users/{id} fait exactement 1 lecture par requête acceptée."
scans() { sleep 2; $PSQL -c "SELECT seq_scan + coalesce(idx_scan,0) FROM pg_stat_user_tables WHERE relname='users'"; }
BEFORE=$(scans)
for i in $(seq 1 200); do as 10.0.0.3 -o /dev/null -w '%{http_code}\n' "$API/v1/users/$USER_ID"; done > "$CODES"
AFTER=$(scans)
OK=$(grep -c '^200$' "$CODES" || true); REFUSED=$(grep -c '^429$' "$CODES" || true)
echo "requêtes envoyées : 200 | acceptées (200) : $OK | refusées (429) : $REFUSED"
echo "lectures de la table users : avant $BEFORE, après $AFTER, donc +$((AFTER-BEFORE))"
if [ "$((AFTER-BEFORE))" -eq "$OK" ]; then echo "=> +$OK = nombre de requêtes acceptées : les $REFUSED refusées n'ont rien lu."; else echo "=> ÉCART : +$((AFTER-BEFORE)) lectures pour $OK requêtes acceptées"; fi
