#!/usr/bin/env bash
# Étape 8 : « retirer une protection fait virer un test au rouge ».
# Casse VOLONTAIREMENT quatre protections, une à la fois, capture la sortie des
# tests, puis restaure le fichier avec git. Le dépôt doit être propre avant.
#   bash preuves/etape-8/saboter.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT=preuves/etape-8
FILES="apps/api/src/routes/payments.ts apps/api/src/routes/users.ts apps/api/src/rate-limit.ts contracts/openapi.yaml"

if ! git diff --quiet -- $FILES; then echo "Refus : ces fichiers ont des modifications non commitées." >&2; exit 1; fi
restore() { git checkout -- $FILES; }
trap restore EXIT

TEST_ENV=""
run_tests() { env $TEST_ENV bun run --filter @miamzy/api test 2>&1 | sed $'s/\x1b\\[[0-9;]*m//g'; }

edit() { # edit <fichier> <ancien> <nouveau>
  python3 - "$@" <<'PY'
import sys
p, old, new = sys.argv[1:4]
s = open(p).read()
assert s.count(old) == 1, f"motif introuvable ou ambigu dans {p}: {old!r} ({s.count(old)})"
open(p, "w").write(s.replace(old, new))
PY
}

sabotage() { # sabotage <n> <titre> <fichier> <ancien> <nouveau>
  local n=$1 title=$2 file=$3
  echo; echo "=== Sabotage $n : $title"
  edit "$file" "$4" "$5" || { echo "échec de la modification"; restore; return 1; }
  if [ -n "${6:-}" ]; then edit "$file" "$6" "$7" || { echo "échec de la 2e modification"; restore; return 1; }; fi
  run_tests > "$OUT/sabotage-$n.txt"
  restore
  { echo "# Sabotage $n : $title"; echo "# Fichier : $file"; echo "# Avant : $4"; echo "# Après : $5"; [ -n "${6:-}" ] && { echo "# Avant : $6"; echo "# Après : $7"; }; echo; cat "$OUT/sabotage-$n.txt"; } > "$OUT/sabotage-$n.tmp" && mv "$OUT/sabotage-$n.tmp" "$OUT/sabotage-$n.txt"
  grep -E '^\(fail\)|^ *[0-9]+ (pass|fail)$|^@miamzy/api test: +[0-9]+ (pass|fail)' "$OUT/sabotage-$n.txt" | sed 's/@miamzy\/api test: //' | head -8
}

echo "=== Référence : tests sur le code non modifié"
run_tests > "$OUT/tests-verts.txt"
grep -E '^ *[0-9]+ (pass|fail)$|^@miamzy/api test: +[0-9]+ (pass|fail)|Ran [0-9]+ tests' "$OUT/tests-verts.txt" | sed 's/@miamzy\/api test: //'

sabotage 1 "le rejeu d'un paiement n'est plus reconnu (idempotence)" apps/api/src/routes/payments.ts \
  'if (byKey && byKey.order_id === orderId) return byKey; // rejeu : même réponse' \
  '// SABOTAGE : le rejeu n'"'"'est plus reconnu'
sabotage 2 "la borne de limit passe de 100 à 100000 (liste plafonnée)" contracts/openapi.yaml \
  '        maximum: 100
        default: 20' \
  '        maximum: 100000
        default: 20'
sabotage 3 "le profil lit et renvoie aussi l'e-mail (fuite)" apps/api/src/routes/users.ts \
  'SELECT id, first_name, created_at FROM users WHERE id = ${id}`;' \
  'SELECT id, first_name, created_at, email FROM users WHERE id = ${id}`;' \
  '        createdAt: row.created_at.toISOString(),
      };' \
  '        createdAt: row.created_at.toISOString(),
        email: row.email,
      };'
# Même fuite, mais le garde-fou du contrat est désactivé : les assertions des tests
# (clés exactes du profil, détecteur de secrets) doivent la voir SEULES.
TEST_ENV="VALIDATE_RESPONSES=false"
sabotage 3b "la même fuite, garde-fou du contrat désactivé : les tests la voient seuls" apps/api/src/routes/users.ts \
  'SELECT id, first_name, created_at FROM users WHERE id = ${id}`;' \
  'SELECT id, first_name, created_at, email FROM users WHERE id = ${id}`;' \
  '        createdAt: row.created_at.toISOString(),
      };' \
  '        createdAt: row.created_at.toISOString(),
        email: row.email,
      };'
TEST_ENV=""

sabotage 4 "le limiteur laisse tout passer (limitation de débit)" apps/api/src/rate-limit.ts \
  'const allowed = bucket.tokens >= 1;' \
  'const allowed = true;'

echo; echo "=== Restauration"; restore
if git diff --quiet -- $FILES; then echo "Fichiers restaurés : aucun écart avec le dernier commit."; else echo "ERREUR : écart restant" >&2; exit 1; fi
