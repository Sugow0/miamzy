# Fonctions communes aux scripts de capture (à sourcer).
API=${API:-http://localhost:3000}
J='content-type: application/json'

# show <titre> <args curl...> : affiche la commande, le statut, les en-têtes et le corps.
show() {
  local title=$1; shift
  printf '\n### %s\n$ curl -si %s\n' "$title" "$*"
  local out; out=$(curl -si "$@" | tr -d '\r')
  printf '%s\n\n' "${out%%$'\n\n'*}"
  printf '%s' "${out#*$'\n\n'}" | jq .
}

# Identifiants réels pris dans la base via l'API.
load_ids() {
  local order; order=$(curl -s "$API/v1/orders?limit=1" | jq -r '.data[0]')
  USER_ID=$(jq -r .userId <<<"$order"); REST_ID=$(jq -r .restaurantId <<<"$order")
  DISH_ID=$(jq -r '.items[0].dishId' <<<"$order"); ORDER_ID=$(jq -r .id <<<"$order")
}
