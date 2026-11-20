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

## D7 – Pagination (étape 3)
**Choix :**
- **Défaut 20, maximum 100.** Un écran mobile affiche une vingtaine de commandes ; 100 couvre un export raisonnable sans que une réponse dépasse quelques dizaines de ko.
- **Curseur, pas numéro de page.** Les commandes arrivent en continu : avec `?page=3`, une commande créée entre deux requêtes décale tout (doublons ou trous). Le curseur (« après cet id ») reste stable. Il est opaque pour le client (id encodé en base64url).
- **Au-delà du maximum : refus 400, pas de troncature silencieuse.** Un client qui demande 100 000 lignes doit savoir qu'il n'aura pas tout, sinon il croira avoir l'intégralité des données. La borne est dans le contrat (`maximum: 100`), donc c'est le validateur dérivé du contrat qui refuse : aucun `if` à maintenir dans le code.
- **La base lit peu, le code ne tranche pas.** `LIMIT limit + 1` : la ligne en trop dit s'il existe une page suivante, sans `COUNT(*)`.

**Requêtes exécutées (copiées du code, `src/routes/orders.ts`) :**
```sql
-- page (les deux filtres sont optionnels)
SELECT id, user_id, restaurant_id, status, total_cents, currency, created_at
FROM orders
WHERE true
  AND id < $cursor            -- si un curseur est fourni
  AND user_id = $userId       -- si ?userId= est fourni
ORDER BY id DESC
LIMIT $limit + 1;

-- lignes de toutes les commandes de la page, en UNE requête (pas de N+1)
SELECT order_id, dish_id, name, quantity, unit_price_cents
FROM order_items
WHERE order_id IN ($id1, …, $idN)
ORDER BY id;
```
**Pourquoi `ORDER BY id` suffit :** `id` est un UUIDv7, donc l'ordre des id est l'ordre chronologique : `ORDER BY id DESC` = « le plus récent d'abord », et la clé primaire sert d'index de tri. Aucun index supplémentaire n'est nécessaire pour la liste générale.

**Preuve que la base lit seulement la page** (`preuves/etape-3/explain.txt`, `EXPLAIN ANALYZE`, table de 5 004 commandes) :
| Requête | Lignes lues |
|---|---|
| page par défaut (`LIMIT 21`) | 21 (Index Scan Backward sur `orders_pkey`) |
| page maximale (`LIMIT 101`) | 101 |
| page suivante (`id < curseur`) | 21 |
| lignes de commande de 20 commandes | 1 requête, 44 lignes |

**Vérifié :** sans paramètre = 20 lignes ; `limit=100` = 100 ; `limit=100000` et `limit=0` = 400 ; curseur invalide = 400 ; parcours complet en 51 pages de 100 = 5 004 commandes, 5 004 ids distincts.

**Limites assumées (non masquées) :**
- Filtre `?userId=` : avec 25 commandes par utilisateur, le planificateur lit les 25 puis trie, ce qui est le bon choix à cette taille. Avec 20 000 commandes pour un seul utilisateur (transaction annulée), il lit 21 lignes. **Ce test est favorable** : les commandes ajoutées sont les plus récentes, donc elles sont en tête de l'index. Un gros client dont les commandes sont dispersées dans le temps n'est pas couvert par cette preuve.
- Le curseur est un id seul : il n'est pas signé. Un client peut en fabriquer un valide, ce qui est sans conséquence (il ne fait que choisir un point de départ) mais il n'authentifie rien.
- `GET /v1/orders` est toujours ouvert à tous tant qu'il n'y a pas d'authentification (bloc 2).

**Code de cette étape :** aucun changement. La pagination avait été écrite avec les routes de l'étape 1, puisque le contrat la définit. Cette PR apporte la décision justifiée et les preuves.

## D8 – Paiement rejouable (étape 4)
**Les quatre questions du TP :**
- **Qui fabrique la clé ?** Le **client**, dans l'en-tête `Idempotency-Key`. Seul le client sait que « ce second envoi est le même paiement » : une clé générée par le serveur arriverait trop tard (c'est justement quand la réponse est perdue que le client réessaie).
- **Où et combien de temps ?** Dans la table `payments` (`idempotency_key`, contrainte `UNIQUE`), **sans expiration** : la ligne de paiement existe de toute façon, et une clé qui expirerait rouvrirait la porte au double débit. Coût : l'index grossit avec les paiements. Alternative écartée : un cache à durée de vie (Redis, 24 h), qui perd la protection passé le délai et ajoute une infrastructure.
- **Que renvoie le second envoi ?** **La même réponse** (même `201`, même corps), pas une erreur : pour le client, un rejeu réussi et le premier succès sont indiscernables, il n'a rien de spécial à gérer.
- **Sans clé ?** Refus `400 MISSING_HEADER` : « L'en-tête Idempotency-Key est obligatoire pour cette requête. » On n'accepte pas un paiement non protégé « par défaut ».

**Mécanisme :** dans une transaction, `SELECT … FOR UPDATE` sur la commande (deux requêtes sur la même commande passent l'une après l'autre), puis `INSERT … ON CONFLICT DO NOTHING RETURNING *`. La contrainte `UNIQUE` fait foi, pas un « chercher puis insérer » : c'est la seule version correcte quand deux requêtes arrivent en même temps. Si rien n'est inséré, on relit : clé connue pour cette commande = rejeu ; clé connue pour une autre = `409 IDEMPOTENCY_KEY_REUSED` ; sinon la commande est déjà payée avec une autre clé = `409 ORDER_ALREADY_PAID`.

**Écart d'interprétation à connaître :** le TP dit « une clé différente crée un nouveau paiement ». Ici, une clé différente crée un nouveau paiement **pour une autre commande** ; pour une commande déjà payée, elle est refusée en 409. Raison : une commande ne se paie qu'une fois (`payments.order_id` est `UNIQUE`), et accepter une seconde clé sur la même commande, c'est exactement le double débit du cas 4 du TP (trois fois 20 €). À valider avec l'enseignant si la démo attend le contraire.

**Vérifié** (`preuves/etape-4/captures.txt`, rejouable) :
- même clé × 3 en séquence : 3 × `201`, empreinte du corps identique, 1 ligne dans `payments` ;
- même clé × 5 **en parallèle** : 5 × `201`, corps identiques, 1 ligne ;
- 5 clés différentes en parallèle sur une commande : 1 × `201` et 4 × `409`, 1 ligne ;
- clé réutilisée sur une autre commande : `409` ; sans clé : `400`, 0 ligne.

**Changement de code :** nouveau code d'erreur `MISSING_HEADER` (message dédié quand un en-tête obligatoire manque, pour tout le contrat, pas seulement ici). Le reste du mécanisme vient de l'étape 1.

**Limites assumées :**
- Aucune comparaison du corps au rejeu : aujourd'hui un seul moyen de paiement existe (`card`), donc le même envoi ne peut pas différer. Dès qu'il y en aura plusieurs, une clé rejouée avec un autre corps devra être refusée en 422.
- Le paiement est simulé (aucun prestataire) : l'idempotence protège l'écriture en base, pas un vrai débit chez un tiers, qui exigerait sa propre clé d'idempotence côté prestataire.

## D9 – Profil sans fuite (étape 5)
**Choix :** le profil expose `id`, `firstName`, `createdAt`. Jamais `email`, `phone` ni `password_hash`, **par aucune route**. Aucune route ne renvoie un objet utilisateur complet : les commandes ne portent que `userId`.
**Pourquoi trois barrières indépendantes (une fuite exige qu'elles cèdent toutes) :**
1. **La requête** : liste blanche de colonnes (`SELECT id, first_name, created_at`). Les données sensibles ne sont même pas lues en mémoire, donc impossibles à sérialiser par mégarde. Avec `SELECT *` suivi d'un « retrait » de champs, un champ ajouté demain à la table fuirait par défaut ; ici il reste caché par défaut.
2. **Le contrat** : le schéma `User` a `additionalProperties: false` et les mêmes trois champs. Avec `VALIDATE_RESPONSES=true`, une réponse qui porterait un champ de plus devient une 500 `CONTRACT_VIOLATION`.
3. **Le détecteur** (`preuves/etape-5`) : il prend les vraies valeurs sensibles d'un utilisateur et les cherche dans toutes les réponses de l'API.
**Pourquoi `firstName` est exposé :** le front doit pouvoir afficher « Bonjour Chloé » ou le nom d'un livreur. C'est la donnée la moins sensible utile ; elle ne permet ni de contacter ni d'identifier la personne seule.
**Écarté :** filtrer côté front (« le front ne l'affiche pas ») : l'API reste lisible avec curl, la donnée a donc déjà fuité ; un champ `isPublic` par utilisateur (inutile pour l'instant).

**Vérifié** (`preuves/etape-5/captures.txt`, rejouable) :
- colonnes de la table : `id, first_name, email, phone, password_hash, created_at` ; clés de la réponse : `id, firstName, createdAt` ; jamais exposées : `email, passwordHash, phone` ;
- ~310 ko de réponses analysées (profil, listes de commandes ×7, détail, création, paiement) : **0** occurrence de l'e-mail, du téléphone et du hash réels de l'utilisateur ;
- **témoin positif** : le même détecteur trouve bien le prénom (exposé) : il n'est pas muet ;
- 0 clé interdite (`email`, `phone`, `password_hash`, `passwordHash`, `homeAddress`, `iban`) dans aucune réponse.

**Limites assumées :**
- `GET /v1/users/{id}` est ouvert à tous tant qu'il n'y a pas d'authentification (bloc 2) : n'importe qui peut lire le prénom de n'importe quel utilisateur dont il connaît l'UUID. L'UUIDv7 n'est pas énumérable, mais ce n'est pas un contrôle d'accès.
- Le détecteur ne cherche que les valeurs de **cet** utilisateur dans les routes appelées : il ne prouve pas l'absence de fuite sur un champ ajouté plus tard (c'est le rôle des barrières 1 et 2, et des tests de l'étape 8).
- Le mot de passe est un hash factice dans le seed : le hachage réel (argon2) viendra avec l'authentification.

**Code de cette étape :** aucun changement. Le profil et le contrat étaient déjà ainsi depuis l'étape 1 ; cette PR justifie le choix et le prouve.
