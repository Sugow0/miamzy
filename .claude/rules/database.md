---
paths:
  - "apps/api/prisma/**"
  - "apps/api/db/**"
  - "docker-compose.yml"
---

# Base de données : PostgreSQL 18, Prisma pour le schéma seulement

## Schéma

- Noms en `snake_case` côté base, `camelCase` côté Prisma, reliés par `@map` et `@@map`.
- Clés primaires : `@id @default(dbgenerated("uuidv7()")) @db.Uuid`.
- Dates : `@db.Timestamptz(3)`, jamais `timestamp` sans fuseau.
- Montants : `Int` en plus petite unité + `currency` en `@db.Char(3)`.
- Un index sur chaque clé étrangère et chaque colonne utilisée en `WHERE` ou `ORDER BY`.
- Clés étrangères : `onDelete: Restrict` par défaut. Prisma génère `SET NULL` pour une relation optionnelle : vérifie-le, il peut laisser des données incohérentes.

## Migrations

- Création : `bun --env-file=../../.env prisma migrate dev --create-only --name <sujet>` depuis `apps/api`, **puis** relire le SQL avant de l'appliquer.
- Les `CHECK` (montants positifs, formats) ne sont pas exprimables dans `schema.prisma` : on les ajoute à la main **à la fin de la migration, avant son application**, dans un bloc commenté.
- **Ne modifie jamais une migration déjà appliquée** (somme de contrôle). Crée-en une nouvelle.
- Migration additive d'abord (« élargir ») : ajouter une colonne nullable ou avec défaut. Resserrer (`NOT NULL`, suppression) plus tard, en plusieurs migrations.
- `migrate dev` uniquement en local (il peut réinitialiser la base) ; `migrate deploy` partout ailleurs (`bun run db:migrate`).
- Après chaque migration : `bun run --filter @miamzy/api db:drift` doit répondre « No difference detected ».

## Seed

- `db/seed.sql` en SQL pur, rejouable et déterministe (arithmétique, pas de `random()` pour les affectations).
- Le seed **vide les tables** : `db/seed.ts` refuse de tourner hors `localhost`. Ne contourne jamais ce garde-fou.
- Les `id` sont décalés jusqu'à `created_at` (`uuidv7(created_at - now())`) pour que l'ordre des id suive l'ordre du temps. Aucune date dans le futur.
- Chaque nouvelle table se vide dans le `TRUNCATE` du seed.

## Docker

- Image `postgres:18` : le volume se monte sur `/var/lib/postgresql` (pas `/data`).
- Port local **5434** (5433 est pris par un autre projet de la machine).
