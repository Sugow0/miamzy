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

