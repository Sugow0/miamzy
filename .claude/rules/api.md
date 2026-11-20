---
paths:
  - "apps/api/src/**"
  - "apps/api/db/**"
  - "apps/api/scripts/**"
---

# apps/api : Bun + Hono, piloté par le contrat

## Architecture

- `src/app.ts` : `createApp(sql, options)` assemble l'application (limiteur, routes, gestionnaires d'erreur). Les tests l'appellent avec une base et un limiteur injectés : ne crée jamais de singleton global de base.
- `src/routes/<ressource>.ts` : une fonction `<ressource>Routes(sql)` qui renvoie un `Hono`. Aucune logique de route dans `app.ts`.
- `src/contract.ts` : charge `contracts/openapi.yaml` et fabrique les validateurs. **Aucun schéma de validation n'est recopié dans le code.**
- `src/errors.ts` : `ApiError` et `errorBody`. `src/messages.ts` : traduction des erreurs de validation.
- `src/rate-limit.ts`, `src/pricing.ts` : logique pure, testable sans serveur.

## Écrire une route

1. Le contrat d'abord (voir `contract.md`), puis `bun run gen:types`.
2. Lie le handler à son `operationId` avec `operation("<operationId>", handler)` : les paramètres sont validés et convertis **avant** d'entrer dans le handler.
3. Lis le corps avec `readBody(c, "<operationId>")` : 400 si illisible, 422 si invalide.
4. Type les objets de réponse avec `components["schemas"][...]` de `src/api.d.ts`.
5. Renvoie via `c.json(corps, statut)` avec un statut déclaré dans le contrat.

## Erreurs

- Toute erreur passe par `throw new ApiError(statut, "CODE_STABLE", "Message lisible", details?)`. N'écris **jamais** `c.json({ error: ... })` à la main : un seul endroit fabrique la forme d'erreur.
- Le `code` est stable et destiné au programme ; le `message` est en français et dit quoi corriger.
- 400 = requête illisible, 422 = lisible mais refusée, 404 = ressource inconnue, 409 = conflit d'état, 429 = limite.
- Une entrée client ne produit jamais une 500. Les erreurs inattendues sont journalisées (`console.error`) et renvoyées avec un message générique : aucun détail interne.

## Base de données

- SQL brut avec `Bun.sql` (gabarits étiquetés). **Prisma ne sert qu'au schéma et aux migrations** : n'installe ni n'utilise le client Prisma.
- Jamais de `SELECT *` dans une route : liste blanche de colonnes (c'est une barrière contre les fuites).
- Aucune concaténation de chaînes dans une requête : uniquement des paramètres `${}`. Les listes passent par `sql(valeurs)`.
- Plusieurs écritures liées : `sql.begin(async (tx) => ...)`. Exclusion entre requêtes concurrentes : `SELECT ... FOR UPDATE`, et contrainte `UNIQUE` plutôt que « chercher puis insérer ».
- Une lecture de plusieurs lignes liées se fait en **une** requête (`IN`), jamais une requête par ligne (N+1).
- Le mapping base vers réponse est explicite, dans une fonction `to<Type>` (snake_case vers camelCase). Ne renvoie jamais une ligne SQL telle quelle.

## Données

- Montants : entiers en plus petite unité (`totalCents`) + `currency` ISO 4217. Jamais de flottant.
- Dates : `Date#toISOString()` (UTC, avec `Z`). Jamais de décalage horaire codé en dur.
- Identifiants : UUIDv7, tels que la base les génère. Un curseur reste opaque pour le client.
- Les prix sont lus en base, **jamais** fournis par le client.

## Configuration et sécurité

- Les variables d'environnement se lisent dans `app.ts` ou `index.ts`, avec une valeur par défaut sûre. `TRUST_PROXY` reste `false` par défaut.
- Aucun secret ni donnée personnelle dans les logs ni dans les messages d'erreur.
- Une route qui renvoie un utilisateur n'expose que `id`, `firstName`, `createdAt`.
