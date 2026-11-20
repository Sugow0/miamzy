#!/usr/bin/env bash
# La base lit-elle seulement la page demandée ? EXPLAIN ANALYZE répond :
# la ligne « rows=N » du nœud Index Scan est le nombre de lignes réellement lues.
#   bash preuves/etape-3/explain.sh > preuves/etape-3/explain.txt
set -euo pipefail
PSQL="docker exec miamzy-db-1 psql -U miamzy -d miamzy -At"
CUR=$($PSQL -c "SELECT id FROM orders ORDER BY id DESC OFFSET 1000 LIMIT 1")
UID_=$($PSQL -c "SELECT user_id FROM orders GROUP BY 1 LIMIT 1")
run() { echo; echo "### $1"; echo "$2"; echo "--"; $PSQL -c "EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF) $2"; }
echo "# Total de lignes dans la table : $($PSQL -c 'SELECT count(*) FROM orders')"
COLS="id, user_id, restaurant_id, status, total_cents, currency, created_at"
run "Page par défaut (limit 20 -> LIMIT 21), requête réelle de l'API" "SELECT $COLS FROM orders WHERE true ORDER BY id DESC LIMIT 21"
run "Page maximale (limit 100 -> LIMIT 101)" "SELECT $COLS FROM orders WHERE true ORDER BY id DESC LIMIT 101"
run "Page suivante (curseur)" "SELECT $COLS FROM orders WHERE true AND id < '$CUR' ORDER BY id DESC LIMIT 21"
run "Filtre par utilisateur" "SELECT $COLS FROM orders WHERE true AND user_id = '$UID_' ORDER BY id DESC LIMIT 21"
IDS=$($PSQL -c "SELECT string_agg(quote_literal(id::text), ',') FROM (SELECT id FROM orders ORDER BY id DESC LIMIT 20) x")
run "Lignes de commande de la page (une seule requête pour les 20 commandes, pas 20 requêtes)" \
  "SELECT order_id, dish_id, name, quantity, unit_price_cents FROM order_items WHERE order_id IN ($IDS) ORDER BY id"

# Un gros client : 20 000 commandes pour un seul utilisateur, dans une transaction ANNULÉE
# (la base n'est pas modifiée). Avec 25 commandes, le planificateur lit tout puis trie ;
# avec 20 000, il doit lire dans l'ordre de l'index et s'arrêter à 21 lignes.
echo; echo "### Gros client : 20 000 commandes, transaction annulée (ROLLBACK)"
docker exec -i miamzy-db-1 psql -U miamzy -d miamzy -At <<SQL
BEGIN;
INSERT INTO orders (user_id, restaurant_id, total_cents)
  SELECT '$UID_', (SELECT id FROM restaurants LIMIT 1), 0 FROM generate_series(1, 20000);
ANALYZE orders;
SELECT 'commandes de cet utilisateur : ' || count(*) FROM orders WHERE user_id = '$UID_';
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
  SELECT $COLS FROM orders WHERE true AND user_id = '$UID_' ORDER BY id DESC LIMIT 21;
ROLLBACK;
SQL
echo "-- Après ROLLBACK : $($PSQL -c 'SELECT count(*) FROM orders') commandes (inchangé)"
