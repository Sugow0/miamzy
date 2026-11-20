#!/usr/bin/env bash
# Étape 2 : des erreurs qui disent la vérité.
#   bash preuves/etape-2/capturer.sh > preuves/etape-2/captures.txt
set -euo pipefail
TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
cd "$(dirname "$0")/.."; source ./lib.sh; load_ids
ZERO=00000000-0000-7000-8000-000000000000

echo "# Étape 2 : erreurs"
show "A. Commande inconnue -> 404" "$API/v1/orders/$ZERO"
show "B. Panier vide -> 422, avec ce qu'il faut corriger" -X POST "$API/v1/orders" -H "$J" \
  -d "{\"userId\":\"$USER_ID\",\"restaurantId\":\"$REST_ID\",\"items\":[]}"
show "C. JSON illisible -> 400 (jamais 500)" -X POST "$API/v1/orders" -H "$J" -d '{"userId": '
show "D. Corps vide -> 400" -X POST "$API/v1/orders" -H "$J"
show "E. Mauvais type -> 422" -X POST "$API/v1/orders" -H "$J" \
  -d "{\"userId\":\"$USER_ID\",\"restaurantId\":\"$REST_ID\",\"items\":[{\"dishId\":\"$DISH_ID\",\"quantity\":\"deux\"}]}"
show "F. Identifiant invalide -> 400" "$API/v1/orders/pas-un-uuid"
show "G. Route inconnue -> 404, même forme" "$API/v1/inconnue"
show "H. Plat inconnu -> 404" -X POST "$API/v1/orders" -H "$J" \
  -d "{\"userId\":\"$USER_ID\",\"restaurantId\":\"$REST_ID\",\"items\":[{\"dishId\":\"$ZERO\",\"quantity\":1}]}"

echo; echo "### Vérification : toutes les erreurs ont exactement la même forme"
check() { # check <nom> <args curl...>
  local name=$1; shift
  local status body
  body=$(curl -s -o /dev/stderr -w '%{http_code}' "$@" 2>"$TMP" || true); status=$body
  jq -e --arg s "$status" --arg n "$name" '
    (keys == ["error"]) and (.error | keys == ["code","details","message"])
    and (.error.details | type == "array")' "$TMP" >/dev/null \
    && printf 'OK   %s (HTTP %s)\n' "$name" "$status" \
    || { printf 'ECHEC %s (HTTP %s)\n' "$name" "$status"; exit 1; }
}
check A "$API/v1/orders/$ZERO"
check B -X POST "$API/v1/orders" -H "$J" -d "{\"userId\":\"$USER_ID\",\"restaurantId\":\"$REST_ID\",\"items\":[]}"
check C -X POST "$API/v1/orders" -H "$J" -d '{"userId": '
check D -X POST "$API/v1/orders" -H "$J"
check E -X POST "$API/v1/orders" -H "$J" -d "{\"userId\":\"$USER_ID\",\"restaurantId\":\"$REST_ID\",\"items\":[{\"dishId\":\"$DISH_ID\",\"quantity\":\"deux\"}]}"
check F "$API/v1/orders/pas-un-uuid"
check G "$API/v1/inconnue"
check H -X POST "$API/v1/orders" -H "$J" -d "{\"userId\":\"$USER_ID\",\"restaurantId\":\"$REST_ID\",\"items\":[{\"dishId\":\"$ZERO\",\"quantity\":1}]}"
