#!/usr/bin/env bash
# Étape 7 : une évolution sans casse (codes promo, contrat 1.1.0).
#   bash preuves/etape-7/capturer.sh > preuves/etape-7/captures.txt
set -euo pipefail
cd "$(dirname "$0")/.."; source ./lib.sh; load_ids
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
PSQL="docker exec miamzy-db-1 psql -U miamzy -d miamzy -At"
LINES="\"items\":[{\"dishId\":\"$DISH_ID\",\"quantity\":2}]"
post() { curl -s -w '\n%{http_code}' -X POST "$API/v1/orders" -H "$J" -d "$1"; }
body() { printf '%s' "${1%$'\n'*}"; }; code() { printf '%s' "${1##*$'\n'}"; }
FIELDS='{totalCents, clefs_de_la_reponse: keys, items: [.items[] | {name, quantity, unitPriceCents}]}'
SUBTOTAL=$(curl -s "$API/v1/orders/$ORDER_ID" | jq '[.items[] | .quantity * .unitPriceCents] | add')

echo "# Étape 7 : codes promo, sans casse"

echo; echo "### A. La même commande SANS code promo (comportement de la 1.0.0)"
R=$(post "{\"userId\":\"$USER_ID\",\"restaurantId\":\"$REST_ID\",$LINES}"); echo "HTTP $(code "$R")"; body "$R" | tee "$T/sans" | jq "$FIELDS"
echo; echo "### B. La même commande AVEC le code BIENVENUE10 (10 %)"
R=$(post "{\"userId\":\"$USER_ID\",\"restaurantId\":\"$REST_ID\",\"promoCode\":\"BIENVENUE10\",$LINES}"); echo "HTTP $(code "$R")"; body "$R" | tee "$T/avec" | jq "$FIELDS"
S=$(jq .totalCents "$T/sans"); A=$(jq .totalCents "$T/avec"); D=$(jq .discountCents "$T/avec")
echo; echo "Contrôle : $S (sans code) - $D (remise) = $((S-D)) ; total avec code = $A"

echo; echo "### C. Codes refusés : inconnu, expiré, désactivé -> la MÊME réponse (on ne révèle pas quels codes existent)"
for c in INCONNU99 EXPIRE5 INACTIF15; do
  R=$(post "{\"userId\":\"$USER_ID\",\"restaurantId\":\"$REST_ID\",\"promoCode\":\"$c\",$LINES}")
  printf '%-10s -> HTTP %s | empreinte du corps %s\n' "$c" "$(code "$R")" "$(body "$R" | shasum -a 256 | cut -c1-16)"
done
body "$R" | jq -c .
R=$(post "{\"userId\":\"$USER_ID\",\"restaurantId\":\"$REST_ID\",\"promoCode\":\"bienvenue10\",$LINES}")
echo "minuscules (bienvenue10) -> HTTP $(code "$R") $(body "$R" | jq -c '.error | {code, details}')"

echo; echo "### D. Une ANCIENNE application : requête de la 1.0.0 (sans promoCode), inchangée"
R=$(post "{\"userId\":\"$USER_ID\",\"restaurantId\":\"$REST_ID\",$LINES}"); echo "HTTP $(code "$R") -> $(body "$R" | jq -c 'keys')"

echo; echo "### E. Une ancienne application sait-elle LIRE les réponses d'aujourd'hui ? (contrat 1.0.0)"
echo "Réponses testées : commande sans code, commande avec code, et 100 commandes de la liste."
{ cat "$T/sans"; echo; cat "$T/avec"; echo; curl -s "$API/v1/orders?limit=100" | jq -c '.data[]'; } | jq -s . > "$T/rep"
(cd ../apps/api && bun scripts/compat.ts ../../preuves/etape-7/openapi-1.0.0.yaml Order < "$T/rep") || true

echo; echo "### F. Arrondi : 0,5 vers le haut (règle du contrat), calculé en entiers"
(cd ../apps/api && bun -e 'import { discountFor } from "./src/pricing"; for (const [s,p] of [[4505,10],[4504,10],[1,50],[1,49],[2420,10]]) console.log(`${s} centimes x ${p} % = ${(s*p/100).toFixed(2)} -> remise ${discountFor(s,p)}`)')

echo; echo "### G. Cohérence en base : total = somme des lignes - remise, et les anciennes commandes sont intactes"
$PSQL -c "SELECT 'commandes dont total <> somme des lignes - remise : ' || count(*) FROM orders o JOIN (SELECT order_id, sum(quantity*unit_price_cents) s FROM order_items GROUP BY 1) t ON t.order_id=o.id WHERE o.total_cents <> t.s - o.discount_cents"
$PSQL -c "SELECT 'commandes sans code promo (remise 0) : ' || count(*) FROM orders WHERE promo_code IS NULL AND discount_cents = 0"
$PSQL -c "SELECT 'commandes avec code promo : ' || count(*) FROM orders WHERE promo_code IS NOT NULL"
