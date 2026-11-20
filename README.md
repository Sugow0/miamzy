# Miamzy API

API REST de livraison de repas, construite **contract-first** : le contrat OpenAPI est écrit avant le code, et le code est validé contre lui.

Projet pédagogique : TP web services, M2 Full Stack (Ynov).

## Démarrage rapide

Prérequis : [Bun](https://bun.sh) 1.2 ou plus, [Docker](https://docs.docker.com/get-docker/), Node.js (la CLI Prisma), `curl` et `jq`.

```bash
bun install --frozen-lockfile
cp .env.example .env
bun run db:up        # PostgreSQL 18 (Docker)
bun run db:migrate
bun run db:seed      # vide les tables, puis 20 restaurants et 5 000 commandes
bun run api          # http://localhost:3000
```

```bash
curl -s "http://localhost:3000/v1/orders?limit=2" | jq
```

## Routes

| Route | Rôle |
|---|---|
| `GET /v1/orders` | lister (curseur, 20 par défaut, 100 au maximum) |
| `GET /v1/orders/{id}` | voir une commande |
| `POST /v1/orders` | créer (code promo optionnel) |
| `POST /v1/orders/{id}/payments` | payer, rejouable (en-tête `Idempotency-Key` obligatoire) |
| `GET /v1/users/{id}` | profil public |

Paramètres, erreurs et exemples : [`contracts/openapi.yaml`](contracts/openapi.yaml). Toutes les erreurs ont la même forme (`error.code`, `error.message`, `error.details`).

## Tests

```bash
bun run test                       # 44 tests, environ 1 s
bun run lint && bun run typecheck
```

La base `miamzy_test` est créée toute seule. Les tests vident les tables : ils refusent de tourner sur une base qui ne finit pas par `_test`.

## Documentation

| Document | Contenu |
|---|---|
| [`contracts/openapi.yaml`](contracts/openapi.yaml) | le contrat de l'API |
| [`DECISIONS.md`](DECISIONS.md) | chaque choix, ses alternatives et ses limites |
| [`preuves/`](preuves) | preuves rejouables, par étape du TP |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | flux de travail et conventions |
| [`CONTRIBUTING-AGENT.md`](CONTRIBUTING-AGENT.md) | consignes pour les agents |

## Limites connues

- Pas d'authentification (bloc 2) : les listes et les profils sont lisibles par quiconque connaît l'URL.
- La limitation de débit est en mémoire d'un seul serveur.
- Pas d'intégration continue ; le paiement est simulé.

## Dépannage

- `port is already allocated` : le port 5434 est pris. Changer le mapping dans `docker-compose.yml` et les URL de `.env`.
- `429` pendant un script de `preuves/` : relancer l'API avec `RATE_LIMIT_CAPACITY=100000`.

## Licence

Projet pédagogique, aucune licence définie.
