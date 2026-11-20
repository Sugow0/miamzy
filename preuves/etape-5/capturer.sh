#!/usr/bin/env bash
# Étape 5 : un profil sans fuite.
#   bash preuves/etape-5/capturer.sh > preuves/etape-5/captures.txt
set -euo pipefail
cd "$(dirname "$0")/.."; source ./lib.sh; load_ids
PSQL="docker exec miamzy-db-1 psql -U miamzy -d miamzy -At"

echo "# Étape 5 : profil sans fuite"
echo; echo "### A. Colonnes de la table users (ce que la base contient)"
$PSQL -c "SELECT column_name FROM information_schema.columns WHERE table_name='users' ORDER BY ordinal_position"

echo; echo "### B. Réponse de GET /v1/users/{id}"
show "profil" "$API/v1/users/$USER_ID"

echo; echo "### C. Clés de la réponse comparées aux colonnes"
# snake_case (base) -> camelCase (API) pour comparer ce qui est comparable
COLS=$($PSQL -c "SELECT column_name FROM information_schema.columns WHERE table_name='users'" \
  | awk '{n=split($0,a,"_"); r=a[1]; for(i=2;i<=n;i++) r=r toupper(substr(a[i],1,1)) substr(a[i],2); print r}' | sort)
KEYS=$(curl -s "$API/v1/users/$USER_ID" | jq -r 'keys[]' | sort)
echo "colonnes de la table : $(echo $COLS)"
echo "clés de la réponse   : $(echo $KEYS)"
echo "colonnes exposées     : $(comm -12 <(echo "$COLS") <(echo "$KEYS") | tr '\n' ' ')"
echo "colonnes JAMAIS exposées : $(comm -23 <(echo "$COLS") <(echo "$KEYS") | tr '\n' ' ')"

echo; echo "### D. Détecteur de fuite : les vraies valeurs sensibles de cet utilisateur"
echo "   apparaissent-elles dans une réponse de l'API ?"
EMAIL=$($PSQL -c "SELECT email FROM users WHERE id='$USER_ID'")
PHONE=$($PSQL -c "SELECT phone FROM users WHERE id='$USER_ID'")
HASH=$($PSQL -c "SELECT password_hash FROM users WHERE id='$USER_ID'")
echo "   (email=$EMAIL, téléphone=$PHONE, hash=${HASH:0:18}…)"
ALL=$(mktemp); trap 'rm -f "$ALL"' EXIT
{
  curl -s "$API/v1/users/$USER_ID"
  curl -s "$API/v1/orders?userId=$USER_ID&limit=100"
  for i in 1 2 3 4 5 6; do curl -s "$API/v1/orders?limit=100"; done
  curl -s "$API/v1/orders/$ORDER_ID"
  curl -s -X POST "$API/v1/orders" -H "$J" \
    -d "{\"userId\":\"$USER_ID\",\"restaurantId\":\"$REST_ID\",\"items\":[{\"dishId\":\"$DISH_ID\",\"quantity\":1}]}" | tee >(jq -r .id > "$ALL.id")
  sleep 0.3
  curl -s -X POST "$API/v1/orders/$(cat "$ALL.id")/payments" -H "$J" -H "Idempotency-Key: capture-etape-5-$(date +%s)" -d '{"method":"card"}'
} > "$ALL" 2>/dev/null
rm -f "$ALL.id"
echo "   octets analysés : $(wc -c < "$ALL" | tr -d ' ')"
for needle in "$EMAIL" "$PHONE" "$HASH"; do
  printf '   occurrences de "%s" : %s\n' "${needle:0:22}" "$(grep -oF -- "$needle" "$ALL" | wc -l | tr -d ' ')"
done
FIRST=$($PSQL -c "SELECT first_name FROM users WHERE id='$USER_ID'")
printf '   témoin positif (le prénom, lui, EST exposé) "%s" : %s occurrences -> le détecteur fonctionne\n' "$FIRST" "$(grep -oF -- "$FIRST" "$ALL" | wc -l | tr -d ' ')"
echo "   clés interdites dans n'importe quelle réponse : $(grep -oE '"(email|phone|password_hash|passwordHash|homeAddress|iban)"' "$ALL" | sort -u | wc -l | tr -d ' ')"
