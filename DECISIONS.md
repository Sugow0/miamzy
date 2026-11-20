# Journal de décisions

## D0 – Stack (étape 0)

**Choix :** Bun + Hono, PostgreSQL 18 (Docker), SQL brut (`Bun.sql`), `bun test`.
**Méthode :** contract-first. `contracts/openapi.yaml` (3.1) est écrit et commité avant le code. Les types sont générés depuis lui, les requêtes et réponses sont validées contre ses schémas.
**Parce que :**

- Postgres : contrainte UNIQUE + ON CONFLICT pour l'idempotence des paiements sous concurrence ; index composites pour la pagination par curseur ; `generate_series` pour le seed.
- Bun : runtime TS sans build, test runner intégré, client Postgres intégré.
- Hono : routeur minimal, le 429 et l'idempotence sont écrits par nous.
  **Écartés :** SQLite (suffisant en volume, mais ne répond pas à la question multi-serveurs) ; `@hono/zod-openapi` (code-first, inverse notre méthode).
  **Risques assumés :** dépendance à Docker pour la démo ; validation contre le contrat câblée à la main.


## D1 – Conventions du contrat (étape 0)

### Identifiants

**Choix :** une seule colonne `id uuid PRIMARY KEY DEFAULT uuidv7()`, exposée telle quelle dans l'API.
**Parce que :**

- UUIDv7 (natif Postgres 18) est ordonné dans le temps : pas de fragmentation d'index comme UUIDv4, et il sert de clé de tri pour le curseur.
- Non énumérable : indispensable tant qu'il n'y a pas d'authentification.
- Un seul identifiant : aucun risque de fuite d'un ID interne (réponse, erreur, curseur).
  **Écarté :** `int` interne + `public_id` UUID. Le gain de performance est invisible à 5 000 lignes, il ajoute un index et une jointure par route, et l'int fuit facilement (curseur).

### Montants

**Choix :** entier en plus petite unité + devise ISO 4217, dans chaque table monétaire :
`total_cents integer NOT NULL CHECK (total_cents >= 0)`, `currency char(3) NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$')`.
Dans l'API : `totalCents` (entier) et `currency` (`"EUR"`).
**Parce que :** exact (pas de flottant), pas de parsing de string (contrairement à `numeric`), la devise suit chaque montant.
**Écartés :** `float` (erreurs d'arrondi), type `money` (dépend de la locale du serveur, sans devise), `numeric(10,2)` (renvoyé en string par le driver).
**Limite assumée :** « cents » suppose 2 décimales. Faux pour JPY (0) ou BHD (3). Acceptable tant que Miamzy ne vend qu'en euros.
**À décider à l'étape 7 :** règle d'arrondi des remises en pourcentage (écrite dans le contrat, testée).

### Dates

**Choix :** l'API envoie et reçoit de l'UTC en ISO 8601 avec `Z` (`2026-12-10T12:00:00Z`). Postgres : `timestamptz`, jamais `timestamp`. Le front convertit avec la zone IANA `Europe/Paris`.
**Parce que :** UTC n'est pas un fuseau géographique et Paris n'a pas de décalage fixe (UTC+1 l'hiver, UTC+2 l'été). Un `+2` codé en dur affiche une heure fausse la moitié de l'année, dont le jour de la démo (10 décembre = UTC+1).

### Pagination

**Choix :** curseur opaque, `limit` (défaut 20, max 100), tri du plus récent au plus ancien (`ORDER BY id DESC`, `WHERE id < $curseur`).
**Parce que :** les commandes arrivent en continu : avec une page numérotée, une nouvelle commande décale les résultats (doublons ou trous). Le curseur est stable.
**Au-delà du maximum :** refus `400`, pas de troncature silencieuse. Un client qui demande 100 000 lignes doit savoir qu'il n'a pas tout reçu.
**Écarté :** pagination par numéro de page (instable, et `OFFSET` relit les lignes sautées).

### Erreurs

**Choix :** un seul format pour toutes les erreurs : `{"error": {"code": "ORDER_NOT_FOUND", "message": "…", "details": []}}`.

- `400` : requête illisible (JSON invalide, paramètre de requête invalide, en-tête manquant).
- `422` : JSON lisible mais règle métier ou validation violée (panier vide, quantité nulle).
- `404` : ressource inconnue. `409` : conflit d'état (commande déjà payée). `429` : limite dépassée, avec en-tête `Retry-After` (secondes).
  **Parce que :** le client programme contre `code` (stable), jamais contre `message` (lisible, modifiable).

### Routes

Pas de verbe dans les URLs, tout sous `/v1` (la version est dans l'URL : visible, testable au navigateur ; un en-tête de version est plus discret mais plus facile à oublier).
`GET /v1/orders` · `GET /v1/orders/{id}` · `POST /v1/orders` (le restaurant dans le corps) · `POST /v1/orders/{id}/payments` (en-tête `Idempotency-Key` obligatoire, choisi par le client) · `GET /v1/users/{id}`.
**Limite assumée :** sans authentification, `GET /v1/orders` est ouvert à tous (filtre `?userId=`). Le bloc 2 devra fermer ce trou.


## D2 – Biome pour le lint et le format
**Choix :** Biome 2.6.8 (épinglée, à la racine du monorepo) pour le lint et le formatage du TypeScript, du JSON et du YAML. Commandes : `bun run lint`, `bun run lint:fix`, `bun run format`.
**Parce que :**
- Un seul outil, une seule config (`biome.json`), à la place du couple ESLint + Prettier. Moins de dépendances à expliquer à la démo.
- Il lit le YAML : il a détecté un `:` non protégé qui rendait `contracts/openapi.yaml` invalide.
- Indentation à 2 espaces pour rester cohérent avec les `package.json` que Bun réécrit (sinon chaque `bun add` crée une dérive de style).
**Limites assumées :**
- Biome contrôle la syntaxe et le style du YAML, pas la validité OpenAPI (`$ref` cassées, champs requis manquants). Un vrai linter OpenAPI (Redocly ou Spectral) reste à ajouter, en version épinglée.
- Les fichiers `.md` sont exclus : le formateur Markdown réécrivait ce journal en cassant la structure des listes.
**Écarté :** ESLint + Prettier (deux outils, deux configs, plus lent).


## D3 – Prisma pour le schéma et les migrations
**Choix :** Prisma 7.10.1 (CLI seulement, épinglée) gère `apps/api/prisma/schema.prisma` et les migrations. Les requêtes de l'API restent en SQL brut (`Bun.sql`) : le client Prisma n'est ni installé ni généré.
**Parce que :**
- Une source de vérité du schéma, versionnée, et des migrations rejouables (`migrate deploy`) sur n'importe quelle machine, y compris celle de la démo.
- On garde la maîtrise du SQL de l'idempotence (`ON CONFLICT`) et de la pagination, que l'étape 3 demande de copier dans le journal.
**Contournements :**
- `uuidv7()` n'est pas natif Prisma : `@default(dbgenerated("uuidv7()"))`, le défaut est côté base (le seed en SQL en profite).
- Les `CHECK` (montants positifs, devise `^[A-Z]{3}$`, quantité 1 à 99) ne sont pas exprimables dans `schema.prisma` : ils sont ajoutés à la main à la fin de la migration `init`, avant son application. `bun run db:drift` confirme l'absence de dérive.
- Unicité du paiement par commande (`payments.order_id`) déclarée dans le schéma (`@unique`), donc 1 commande = au plus 1 paiement, même sous concurrence.
**Règles :** ne jamais modifier une migration déjà appliquée (checksum) ; `migrate dev` uniquement en local (il peut réinitialiser la base), `migrate deploy` partout ailleurs.
**Version :** `latest` sur npm pointe sur un RC (8.0.0-rc.34) ; on reste sur la dernière stable (7.10.1).
**Écarté :** Prisma Client pour les requêtes (masque le SQL demandé par l'étape 3), `drizzle-kit` (non demandé).
**Infra :** le port local de Postgres est 5434 (5433 est pris par un autre projet).


## D4 – Seed (étape 1)
**Choix :** `apps/api/db/seed.sql` (SQL pur, `generate_series`) lancé par `bun run db:seed` (`db/seed.ts`). Résultat : 20 restaurants, 160 plats, 200 utilisateurs, 5 000 commandes, 12 500 lignes, 3 000 paiements (60 % des commandes sont payées).
**Parce que :**
- Le SQL reste lisible et le seed est rejouable : il vide les tables puis réinsère.
- Les `id` sont des UUIDv7 décalés jusqu'à `created_at` (`uuidv7(created_at - now())`) : l'ordre des id suit l'ordre chronologique, donc le curseur `id DESC` de l'étape 3 est cohérent avec les dates. Vérifié : 0 inversion sur 5 000 commandes.
- Les affectations (client, restaurant, plats) sont déterministes (arithmétique modulo, pas de `random()`), donc deux exécutions donnent la même répartition. Seules les dates dépendent de l'heure.
**Garde-fou :** le script refuse de tourner si l'hôte de `DATABASE_URL` n'est pas `localhost` ou `127.0.0.1`, puisqu'il vide les tables.
**Contrôles faits :** 0 total de commande différent de la somme des lignes, 0 commande sans ligne, 0 commande payée sans paiement.
**Limite assumée :** chaque utilisateur a exactement 25 commandes. Une répartition réaliste (quelques gros clients) serait plus utile pour tester la pagination par utilisateur.


## D5 – Routes de l'étape 1 : le contrat pilote le code
**Choix :** `contracts/openapi.yaml` est lu au démarrage (`src/contract.ts`). Les validateurs de paramètres, de corps et de réponses (Ajv, JSON Schema 2020-12) en sont dérivés : aucun schéma n'est recopié dans le code. Les types TypeScript viennent de `openapi-typescript` (`bun run gen:types`, fichier `src/api.d.ts` commité). Chaque handler est lié à un `operationId` du contrat.
**Parce que :** si le contrat change, le code ne compile plus ou la validation échoue. Il ne peut pas dériver en silence.
**Garde-fou :** `VALIDATE_RESPONSES=true` compare chaque réponse au contrat et la transforme en 500 `CONTRACT_VIOLATION` en cas d'écart (dev et tests). Les 5xx ne sont pas déclarés dans le contrat, donc non contrôlés.
**Règles de comportement ajoutées au contrat (POST /v1/orders) :** prix lus en base ; plat inconnu = 404, plat d'un autre restaurant ou en double = 422.
**Dépendances épinglées :** hono 4.13.19, ajv 8.20.0, ajv-formats 3.0.1, yaml 2.9.1, openapi-typescript 7.13.0.
**TypeScript 5.9.3, pas 7.0.2 :** `openapi-typescript` utilise l'API du compilateur (`ts.factory`) que TypeScript 7 (version native) n'expose plus. Son pair déclaré est `^5.x`.
**Limites assumées :** les messages `issue` des erreurs de validation sont ceux d'Ajv (en anglais) ; la validation contre le contrat est du code maison (`contract.ts`) que le groupe doit pouvoir expliquer ; aucun test automatisé pour l'instant (étape 8).

## D6 – Erreurs (étape 2)
**Choix :** une seule classe `ApiError` (statut, code stable, message, détails) et deux gestionnaires globaux (`onError`, `notFound`) : aucune route ne fabrique elle-même un corps d'erreur. Les erreurs de validation passent toutes par `messages.ts`, qui traduit les erreurs Ajv en français (« doit être un nombre entier », « au moins 1 élément requis »).
**Parce que :** « un bloc d'erreur dupliqué = une fonction manquante ». Un seul point de fabrication garantit la forme unique, et un seul fichier à relire pour les messages.
**Distinction 400 / 422 (déjà dans D1, appliquée ici) :** 400 = on ne peut pas lire la requête (JSON cassé, corps vide, UUID invalide, paramètre hors bornes) ; 422 = lisible mais refusée (panier vide, mauvais type, champ inconnu).
**Jamais de 500 pour une entrée client :** JSON illisible et corps vide donnent 400. Les vraies erreurs serveur sont journalisées côté serveur et renvoyées avec un message générique (aucun détail interne au client).
**Vérifié :** 8 cas (404 commande, 422 panier vide, 400 JSON cassé, 400 corps vide, 422 mauvais type, 400 UUID invalide, 404 route inconnue, 404 plat inconnu) : `jq` contrôle que chaque corps a exactement les clés `error.code`, `error.details`, `error.message`.
**Limite assumée :** les 5xx ne sont pas déclarés dans le contrat (ni donc validés par `VALIDATE_RESPONSES`).
