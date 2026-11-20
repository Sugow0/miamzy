---
paths:
  - "contracts/**"
  - "apps/api/src/api.d.ts"
---

# Contrat OpenAPI : source de vérité

## Principe

Le contrat précède le code. Le code est validé contre lui (paramètres, corps et réponses). Si le contrat change, le code doit changer, pas l'inverse.

## Flux pour changer l'API

1. Modifier `contracts/openapi.yaml` (et lui seul).
2. `bun run gen:types` : régénère `apps/api/src/api.d.ts`. **Ne modifie jamais ce fichier à la main.**
3. `bun run typecheck` : les écarts avec le code apparaissent. C'est voulu.
4. Migration et seed si la base change, puis le code, puis les tests et les preuves.
5. Consigner la décision dans `DECISIONS.md`.

Commits dans cet ordre : contrat, migration, code, preuves. Le premier commit peut laisser `tsc` en erreur : dis-le dans la PR.

## Écrire le contrat

- OpenAPI **3.1**, YAML. `operationId` unique par opération, en `camelCase` : c'est la clé qui lie le code au contrat.
- Blocs partagés dans `components` (`parameters`, `responses`, `schemas`) : une erreur ne se décrit qu'une fois, avec `$ref`.
- `additionalProperties: false` sur les objets de réponse : une fuite de champ doit casser.
- Chaque route déclare ses erreurs possibles (400, 404, 409, 422, 429...) avec un exemple.
- Les bornes (`maximum`, `minLength`, `pattern`, `enum`) vivent dans le contrat : c'est lui qui refuse, pas un `if` dans le code.
- Montants : `integer` + `currency`. Dates : `format: date-time`, UTC. Identifiants : `format: uuid`.

## Versionner sans casser

- Changement **additif** (nouvelle route, nouveau champ de réponse, nouveau champ de requête **optionnel**, nouvelle erreur) : version mineure, pas de `/v2`.
- **Rupture** (renommer, supprimer, changer le sens ou le type d'un champ, rendre un champ de requête obligatoire) : version majeure et `/v2`. Garder `/v1` en service.
- Un champ ajouté à une réponse peut casser un décodeur strict. Si possible, ne le renvoie que dans les cas qui l'exigent (voir `DECISIONS.md` D11).
- Tenir à jour l'historique dans `info.description`, et vérifier la compatibilité : `bun apps/api/scripts/compat.ts <ancien-contrat> <Schéma> < reponses.json`.
