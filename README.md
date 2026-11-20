# Miamzy API

API REST de livraison de repas, construite **contract-first** : le contrat OpenAPI est écrit avant le code, et le code est validé contre lui.

Projet pédagogique : TP « Diagnostiquer, puis construire », web services, M2 Full Stack (Ynov).

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Prérequis](#prérequis)
- [Démarrage rapide](#démarrage-rapide)
- [Utiliser l'API](#utiliser-lapi)
- [Configuration](#configuration)
- [Scripts](#scripts)
- [Tests](#tests)
- [Structure du dépôt](#structure-du-dépôt)
- [Documentation](#documentation)
- [Dépannage](#dépannage)
- [Limites connues](#limites-connues)
- [Contribuer](#contribuer)

## Fonctionnalités

| Besoin | Route | Points d'attention |
|---|---|---|
| Lister les commandes | `GET /v1/orders` | pagination par curseur, 20 par défaut, 100 au maximum |
| Voir une commande | `GET /v1/orders/{id}` | |
| Créer une commande | `POST /v1/orders` | prix calculés côté serveur, code promo optionnel |
| Payer une commande | `POST /v1/orders/{id}/payments` | rejouable sans double débit (`Idempotency-Key`) |
| Voir un profil | `GET /v1/users/{id}` | jamais d'e-mail, de téléphone ni de mot de passe |

Transversal : un seul format d'erreur, limitation de débit (429 avec `Retry-After`), identifiants UUIDv7, montants en centimes avec devise, dates en UTC.

### Avancement du TP

| Étape | Sujet | Preuve |
|---|---|---|
| 0 | Contrat et choix de la stack | [`contracts/openapi.yaml`](contracts/openapi.yaml), [`DECISIONS.md`](DECISIONS.md) |
| 1 | Les cinq routes | [`preuves/etape-1`](preuves/etape-1) |
| 2 | Des erreurs qui disent la vérité | [`preuves/etape-2`](preuves/etape-2) |
| 3 | Une liste qui ne déborde jamais | [`preuves/etape-3`](preuves/etape-3) |
| 4 | Un paiement qu'on peut rejouer | [`preuves/etape-4`](preuves/etape-4) |
| 5 | Un profil sans fuite | [`preuves/etape-5`](preuves/etape-5) |
| 6 | Un compteur à l'entrée | [`preuves/etape-6`](preuves/etape-6) |
| 7 | Une évolution sans casse | [`preuves/etape-7`](preuves/etape-7) |
| 8 | Le filet de sécurité | [`preuves/etape-8`](preuves/etape-8) |

L'étape 9 (bonus) n'est pas réalisée.

## Prérequis

| Outil | Version testée | Rôle |
|---|---|---|
| [Bun](https://bun.sh) | 1.3 (au moins 1.2 : client SQL intégré) | exécution, tests, gestion des paquets |
| [Docker](https://docs.docker.com/get-docker/) avec Compose | Compose 5 | PostgreSQL 18 en local |
| [Node.js](https://nodejs.org) | 24 | la CLI Prisma s'exécute avec Node |
| `curl` et `jq` | | essayer l'API et rejouer les preuves |

## Démarrage rapide

```bash
bun install --frozen-lockfile   # dépendances, versions exactes
cp .env.example .env            # configuration locale (jamais commitée)
bun run db:up                   # PostgreSQL 18 (Docker), attend qu'il soit prêt
bun run db:migrate              # crée les tables
bun run db:seed                 # 20 restaurants, 5 000 commandes, 4 codes promo
bun run api                     # http://localhost:3000, rechargement automatique
```

Vérifier que tout répond :

```bash
curl -s "http://localhost:3000/v1/orders?limit=1" | jq '.data[0].id'
```

> `bun run db:seed` **vide les tables** avant d'insérer. Il refuse de tourner si `DATABASE_URL` ne pointe pas sur `localhost`.

## Utiliser l'API

Le contrat complet est dans [`contracts/openapi.yaml`](contracts/openapi.yaml). Exemple de bout en bout :

```bash
API=http://localhost:3000

# 1. Récupérer des identifiants existants
ORDER=$(curl -s "$API/v1/orders?limit=1" | jq '.data[0]')
USER_ID=$(jq -r .userId <<<"$ORDER")
REST_ID=$(jq -r .restaurantId <<<"$ORDER")
DISH_ID=$(jq -r '.items[0].dishId' <<<"$ORDER")

# 2. Créer une commande avec un code promo (le prix vient du serveur)
curl -s -X POST "$API/v1/orders" -H 'content-type: application/json' -d "{
  \"userId\": \"$USER_ID\", \"restaurantId\": \"$REST_ID\", \"promoCode\": \"BIENVENUE10\",
  \"items\": [{\"dishId\": \"$DISH_ID\", \"quantity\": 2}]
}" | tee /dev/stderr | jq -r .id > /tmp/order_id

# 3. La payer : rejouer la même requête ne débite pas une seconde fois
curl -s -X POST "$API/v1/orders/$(cat /tmp/order_id)/payments" \
  -H 'content-type: application/json' -H 'Idempotency-Key: ma-cle-0001' -d '{"method":"card"}'

# 4. Page suivante d'une liste : utiliser nextCursor
curl -s "$API/v1/orders?limit=5" | jq -r .nextCursor
```

Codes promo du seed : `BIENVENUE10` (10 %), `ETE20` (20 %), `EXPIRE5` (expiré), `INACTIF15` (désactivé).

### Format d'erreur

Toutes les erreurs ont la même forme. Le programme lit `code` (stable) ; le message est pour l'humain.

```json
{ "error": { "code": "ORDER_NOT_FOUND", "message": "Aucune commande ne porte cet identifiant.", "details": [] } }
```

| Statut | Signification |
|---|---|
| 400 | requête illisible : JSON cassé, identifiant invalide, paramètre hors bornes, en-tête manquant |
| 404 | ressource inconnue |
| 409 | conflit d'état : commande déjà payée, clé d'idempotence déjà utilisée |
| 422 | requête lisible mais refusée : panier vide, mauvais type, code promo invalide |
| 429 | trop de requêtes ; l'en-tête `Retry-After` donne l'attente en secondes |

## Configuration

Variables lues depuis `.env` (modèle : [`.env.example`](.env.example)).

| Variable | Défaut | Rôle |
|---|---|---|
| `DATABASE_URL` | voir `.env.example` | base de développement (port **5434**) |
| `TEST_DATABASE_URL` | voir `.env.example` | base des tests, **doit finir par `_test`** |
| `DB_PASSWORD` | `miamzy_dev` | mot de passe du conteneur PostgreSQL |
| `PORT` | `3000` | port de l'API |
| `RATE_LIMIT_CAPACITY` | `60` | taille de la rafale autorisée par client |
| `RATE_LIMIT_REFILL_PER_SEC` | `1` | requêtes par seconde rendues au client |
| `TRUST_PROXY` | `false` | lire `X-Forwarded-For` ; à activer **seulement** derrière un proxy de confiance qui l'écrase |
| `VALIDATE_RESPONSES` | `false` | compare chaque réponse au contrat (500 en cas d'écart) ; actif dans les tests |

## Scripts

À lancer depuis la racine.

| Commande | Effet |
|---|---|
| `bun run api` | lance l'API en mode développement |
| `bun run test` | lance les tests |
| `bun run lint` / `bun run lint:fix` | contrôle / corrige le style (Biome) |
| `bun run typecheck` | vérifie les types |
| `bun run gen:types` | régénère `apps/api/src/api.d.ts` depuis le contrat |
| `bun run db:up` / `bun run db:down` | démarre / arrête PostgreSQL |
| `bun run db:migrate` | applique les migrations |
| `bun run db:status` | état des migrations |
| `bun run db:seed` | remplit la base de développement |

## Tests

```bash
bun run test
```

44 tests, environ une seconde. La base `miamzy_test` est créée et migrée automatiquement. Les tests **vident les tables** : `apps/api/test/setup.ts` refuse de tourner si la base ne finit pas par `_test`, si elle est identique à `DATABASE_URL` ou si l'hôte n'est pas local.

Chaque réponse de chaque test est aussi comparée au contrat. La preuve que les tests protègent vraiment (on retire une protection, un test devient rouge) est dans [`preuves/etape-8`](preuves/etape-8) ; pour la rejouer : `bash preuves/etape-8/saboter.sh` (le dépôt doit être propre).

Les scripts `preuves/etape-*/capturer.sh` enchaînent plus de 60 requêtes : pour les rejouer, démarrer l'API avec `RATE_LIMIT_CAPACITY=100000` (et `TRUST_PROXY=true` pour l'étape 6).

## Structure du dépôt

```
miamzy/
├── apps/
│   └── api/               # API Bun + Hono
│       ├── src/           # code (routes, contrat, limiteur, erreurs)
│       ├── prisma/        # schéma et migrations (Prisma ne sert qu'à cela)
│       ├── db/            # seed
│       ├── scripts/       # outils (compatibilité avec un ancien contrat)
│       └── test/          # tests
├── contracts/             # openapi.yaml : source de vérité
├── preuves/               # captures et scripts de preuve, par étape
├── .claude/rules/         # conventions de code par zone (humains et agents)
├── DECISIONS.md           # journal de décisions
├── CONTRIBUTING.md        # contribuer
├── CONTRIBUTING-AGENT.md  # consignes pour les agents IA
└── docker-compose.yml     # PostgreSQL 18
```

## Documentation

| Document | Contenu |
|---|---|
| [`contracts/openapi.yaml`](contracts/openapi.yaml) | contrat de l'API (OpenAPI 3.1), avec historique des versions |
| [`DECISIONS.md`](DECISIONS.md) | chaque choix, ses alternatives écartées et ses limites |
| [`preuves/`](preuves) | captures rejouables, par étape |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | flux de travail, conventions, ajout d'une route |

## Dépannage

| Symptôme | Cause et remède |
|---|---|
| `port is already allocated` au `db:up` | le port 5434 est pris. Changer le mapping dans `docker-compose.yml` et les URL de `.env` |
| `429` pendant un script de preuve | la limite par défaut est atteinte : relancer l'API avec `RATE_LIMIT_CAPACITY=100000` |
| `Refus : ... ne finit pas par _test` | `TEST_DATABASE_URL` est mal configurée ; c'est le garde-fou des tests |
| `Cannot connect` / base introuvable | `bun run db:up` puis `bun run db:migrate` |
| `bun run db:seed` refuse de tourner | `DATABASE_URL` ne pointe pas sur `localhost` : le seed vide les tables |

## Limites connues

- **Pas d'authentification** (bloc 2) : `GET /v1/orders` et `GET /v1/users/{id}` sont lisibles par quiconque connaît l'URL.
- **La limitation de débit est en mémoire** d'un seul processus. Avec plusieurs serveurs, il faut un compteur partagé (voir `DECISIONS.md`, D10).
- **Pas d'intégration continue** : les tests ne tournent que si quelqu'un les lance.
- **Le paiement est simulé** : aucun prestataire réel.
- Aucune application mobile réelle n'a été testée contre le contrat 1.1.0 (voir D11).

## Contribuer

Lire [`CONTRIBUTING.md`](CONTRIBUTING.md). Un agent IA lit en plus [`CONTRIBUTING-AGENT.md`](CONTRIBUTING-AGENT.md).

## Licence

Projet pédagogique. Aucune licence n'est définie.
