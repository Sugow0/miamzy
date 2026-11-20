# Miamzy

Monorepo. Approche contract-first : `contracts/openapi.yaml` précède le code.

```
miamzy/
├── apps/
│   └── api/          # API Bun + Hono
├── contracts/        # openapi.yaml (source de vérité)
├── preuves/          # captures et sorties de tests par étape
├── DECISIONS.md      # journal de décisions
└── docker-compose.yml
```

## Démarrage (à compléter)

```bash
cp .env.example .env
bun run db:up
```
