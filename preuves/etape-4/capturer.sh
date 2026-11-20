#!/usr/bin/env bash
# Étape 4 : un paiement qu'on peut rejouer.
#   bash preuves/etape-4/capturer.sh > preuves/etape-4/captures.txt
set -euo pipefail
cd "$(dirname "$0")/.."; source ./lib.sh; load_ids
PSQL="docker exec miamzy-db-1 psql -U miamzy -d miamzy"
RUN=$(date +%s)

new_order() { # crée une commande à 1 plat, affiche son id
  curl -s -X POST "$API/v1/orders" -H "$J" \
    -d "{\"userId\":\"$USER_ID\",\"restaurantId\":\"$REST_ID\",\"items\":[{\"dishId\":\"$DISH_ID\",\"quantity\":1}]}" | jq -r .id
}
pay() { # pay <orderId> <clé|""> -> écrit statut et corps
  local args=(-s -w '\n%{http_code}' -X POST "$API/v1/orders/$1/payments" -H "$J" -d '{"method":"card"}')
  [ -n "$2" ] && args+=(-H "Idempotency-Key: $2")
  curl "${args[@]}"
}

echo "# Étape 4 : paiement idempotent"

O=$(new_order); echo; echo "### A. La même clé envoyée 3 fois (commande $O)"
for i in 1 2 3; do
  R=$(pay "$O" "capture-$RUN-A"); S=${R##*$'\n'}; B=${R%$'\n'*}
  printf 'envoi %s -> HTTP %s | sha256(corps) = %s\n' "$i" "$S" "$(printf '%s' "$B" | shasum -a 256 | cut -c1-16)"
  [ "$i" = 1 ] && FIRST=$B
done
echo "corps (identique aux 3 envois) :"; jq . <<<"$FIRST"
echo; echo "table payments pour cette commande (attendu : 1 ligne) :"
$PSQL -c "SELECT id, order_id, idempotency_key, amount_cents, currency, status FROM payments WHERE order_id = '$O'"

echo "### B. Une clé différente, pour une AUTRE commande -> un nouveau paiement"
O2=$(new_order); R=$(pay "$O2" "capture-$RUN-B"); echo "commande $O2 -> HTTP ${R##*$'\n'}"
$PSQL -c "SELECT count(*) AS paiements_pour_cette_commande FROM payments WHERE order_id = '$O2'"

echo "### C. Une clé différente sur la commande DÉJÀ PAYÉE -> refusé (jamais un deuxième débit)"
R=$(pay "$O" "capture-$RUN-C"); echo "HTTP ${R##*$'\n'}"; jq -c . <<<"${R%$'\n'*}"
$PSQL -c "SELECT count(*) AS paiements_pour_la_commande_A FROM payments WHERE order_id = '$O'"

echo; echo "### D. La même clé réutilisée pour une autre commande -> refusé"
O3=$(new_order); R=$(pay "$O3" "capture-$RUN-A"); echo "HTTP ${R##*$'\n'}"; jq -c . <<<"${R%$'\n'*}"

echo; echo "### E. Sans clé -> refusé avec un message clair"
R=$(pay "$O3" ""); echo "HTTP ${R##*$'\n'}"; jq . <<<"${R%$'\n'*}"
$PSQL -c "SELECT count(*) AS paiements_pour_cette_commande FROM payments WHERE order_id = '$O3'"

echo; echo "### F. Rejeu SIMULTANÉ : 5 envois en parallèle avec la même clé (réseau coupé + retries)"
O4=$(new_order); D=$(mktemp -d)
for i in 1 2 3 4 5; do ( pay "$O4" "capture-$RUN-F" > "$D/$i" ) & done; wait
for i in 1 2 3 4 5; do R=$(cat "$D/$i"); printf 'envoi %s -> HTTP %s | sha256(corps) = %s\n' "$i" "${R##*$'\n'}" "$(printf '%s' "${R%$'\n'*}" | shasum -a 256 | cut -c1-16)"; done
$PSQL -c "SELECT count(*) AS paiements_pour_cette_commande FROM payments WHERE order_id = '$O4'"

echo; echo "### G. 5 clés DIFFÉRENTES en parallèle sur la même commande (le cas 4 du TP : trois débits)"
O5=$(new_order)
for i in 1 2 3 4 5; do ( pay "$O5" "capture-$RUN-G$i" > "$D/$i" ) & done; wait
printf 'statuts : '; for i in 1 2 3 4 5; do R=$(cat "$D/$i"); printf '%s ' "${R##*$'\n'}"; done; echo
$PSQL -c "SELECT count(*) AS paiements_pour_cette_commande FROM payments WHERE order_id = '$O5'"
rm -rf "$D"
