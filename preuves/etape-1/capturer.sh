#!/usr/bin/env bash
# Capture des 5 routes de l'étape 1 (statut, en-têtes, corps).
# Prérequis : base démarrée et seedée, API lancée avec VALIDATE_RESPONSES=true.
#   bash preuves/etape-1/capturer.sh > preuves/etape-1/captures.txt
set -euo pipefail
API=${API:-http://localhost:3000}
J='content-type: application/json'

show() { # show <titre> <curl args...>
  local title=$1; shift
  printf '\n### %s\n$ curl -si %s\n' "$title" "$*"
  local out; out=$(curl -si "$@" | tr -d '\r')
  printf '%s\n\n' "${out%%$'\n\n'*}"
  printf '%s' "${out#*$'\n\n'}" | jq .
}

ORDER=$(curl -s "$API/v1/orders?limit=1" | jq -r '.data[0]')
USER_ID=$(echo "$ORDER" | jq -r .userId)
REST_ID=$(echo "$ORDER" | jq -r .restaurantId)
DISH_ID=$(echo "$ORDER" | jq -r '.items[0].dishId')
ORDER_ID=$(echo "$ORDER" | jq -r .id)

echo "# Étape 1 : les cinq routes"
show "1. Lister les commandes (limit=2)" "$API/v1/orders?limit=2"
show "2. Voir une commande" "$API/v1/orders/$ORDER_ID"
show "3. Créer une commande (201 + Location)" -X POST "$API/v1/orders" -H "$J" \
  -d "{\"userId\":\"$USER_ID\",\"restaurantId\":\"$REST_ID\",\"items\":[{\"dishId\":\"$DISH_ID\",\"quantity\":2}]}"
NEW_ID=$(curl -s -X POST "$API/v1/orders" -H "$J" \
  -d "{\"userId\":\"$USER_ID\",\"restaurantId\":\"$REST_ID\",\"items\":[{\"dishId\":\"$DISH_ID\",\"quantity\":1}]}" | jq -r .id)
show "4. Payer une commande" -X POST "$API/v1/orders/$NEW_ID/payments" -H "$J" \
  -H "Idempotency-Key: capture-etape-1-$(date +%s)" -d '{"method":"card"}'
show "5. Voir un profil" "$API/v1/users/$USER_ID"
