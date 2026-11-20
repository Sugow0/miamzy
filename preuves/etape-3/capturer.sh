#!/usr/bin/env bash
# Étape 3 : une liste qui ne déborde jamais.
#   bash preuves/etape-3/capturer.sh > preuves/etape-3/captures.txt
set -euo pipefail
cd "$(dirname "$0")/.."; source ./lib.sh; load_ids

# resume <titre> <url> : statut, nombre de lignes renvoyées, présence d'un curseur.
resume() {
  local title=$1 url=$2 out status
  out=$(curl -s -w '\n%{http_code}' "$url"); status=${out##*$'\n'}; out=${out%$'\n'*}
  printf '\n### %s\n$ curl -s "%s"\nHTTP %s\n' "$title" "$url" "$status"
  jq -c 'if .data then {lignes: (.data|length), nextCursor: (.nextCursor != null)} else . end' <<<"$out"
}

echo "# Étape 3 : pagination"
resume "A. Sans paramètre -> une page de 20 (défaut), pas 5 000" "$API/v1/orders"
resume "B. limit=100 (le maximum) -> 100 lignes" "$API/v1/orders?limit=100"
resume "C. limit=100000 -> refusé, jamais plus de 100" "$API/v1/orders?limit=100000"
resume "D. limit=0 -> refusé" "$API/v1/orders?limit=0"
resume "E. curseur invalide -> refusé" "$API/v1/orders?cursor=n-importe-quoi"

echo; echo "### F. La page suivante est demandable : page 1 puis page 2, sans recouvrement"
P1=$(curl -s "$API/v1/orders?limit=5"); CUR=$(jq -r .nextCursor <<<"$P1")
P2=$(curl -s "$API/v1/orders?limit=5&cursor=$CUR")
echo "page 1 : $(jq -c '[.data[].id | .[0:13]]' <<<"$P1")"
echo "page 2 : $(jq -c '[.data[].id | .[0:13]]' <<<"$P2")"
COMMUNS=$(jq -n --argjson a "$P1" --argjson b "$P2" '[$a.data[].id] - ([$a.data[].id] - [$b.data[].id]) | length')
echo "ids en commun entre les deux pages : $COMMUNS (attendu : 0)"

echo; echo "### G. Parcours complet avec limit=100 : toutes les commandes, une seule fois chacune"
TOTAL=0; PAGES=0; CUR=""; : > "${TMPDIR:-/tmp}/ids.$$"
while :; do
  R=$(curl -s "$API/v1/orders?limit=100${CUR:+&cursor=$CUR}")
  jq -r '.data[].id' <<<"$R" >> "${TMPDIR:-/tmp}/ids.$$"
  PAGES=$((PAGES+1)); CUR=$(jq -r '.nextCursor // empty' <<<"$R"); [ -z "$CUR" ] && break
done
echo "pages : $PAGES | lignes : $(wc -l < "${TMPDIR:-/tmp}/ids.$$" | tr -d ' ') | uniques : $(sort -u "${TMPDIR:-/tmp}/ids.$$" | wc -l | tr -d ' ')"
rm -f "${TMPDIR:-/tmp}/ids.$$"
