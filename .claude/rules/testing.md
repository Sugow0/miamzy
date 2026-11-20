---
paths:
  - "apps/api/test/**"
  - "**/*.test.ts"
---

# Tests

## Lancer

`bun run test` à la racine. Environ une seconde. La base `miamzy_test` est créée et migrée par `test/setup.ts`.

## Sécurité de la base de test

Les tests vident les tables. `setup.ts` refuse de tourner si la base ne finit pas par `_test`, si elle est identique à `DATABASE_URL` ou si l'hôte n'est pas local. **Ne retire ni n'affaiblis ces refus.**

## Écrire un test

- Un test = un comportement. Son nom décrit ce qui doit être vrai, en français (« la même clé envoyée 3 fois : 1 seul paiement en base »).
- Vérifie **plus que le statut HTTP** : la base (`SELECT`), le corps exact, les clés exactes, les en-têtes, l'absence d'effet de bord (0 ligne écrite).
- Isole : `beforeEach(resetDb)` puis `makeWorld()`. Aucun état partagé entre tests, aucun ordre imposé.
- Passe par les aides de `test/helpers.ts` (`client`, `createOrder`, `makeApp`, `isErrorShape`, `countingSql`).
- Teste la concurrence avec `Promise.all`, pas avec des appels en série.
- Avec un détecteur (fuite, doublon), ajoute un **témoin positif** : une valeur qu'il doit trouver, sinon il peut être muet.
- Ne fais pas `expect(sql\`...\`).rejects` : une requête Bun SQL est un objet paresseux. Enveloppe-la dans une fonction `async` : `expect(maFonction()).rejects`.
- Le garde-fou `VALIDATE_RESPONSES=true` est actif : chaque réponse est aussi comparée au contrat.

## Prouver qu'un test protège

Quand tu ajoutes une protection, ajoute un sabotage dans `preuves/etape-8/saboter.sh` : retire la protection, un test doit devenir rouge. **Vérifie lequel** : un sabotage qui casse un test sans rapport ne prouve rien (c'est arrivé : voir `DECISIONS.md` D12).

## Ce que les tests ne couvrent pas

Performance (voir `preuves/etape-3`), intégration continue (absente), couverture (non mesurée). Ne prétends pas le contraire.
