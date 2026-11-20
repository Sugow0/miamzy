# Monorepo : organisation et conventions générales

S'applique à tout le dépôt.

## Organisation

- `apps/<nom>` : une application déployable. Aujourd'hui : `apps/api`.
- `packages/<nom>` : du code partagé entre applications. Aujourd'hui : aucun (voir `packages.md`).
- `contracts/` : le contrat OpenAPI, source de vérité de l'API.
- `preuves/` : captures et scripts de preuve du TP, par étape.
- Racine : `DECISIONS.md` (journal), `README.md`, `CONTRIBUTING*.md`, `docker-compose.yml`, `biome.json`.

## Gestionnaire de paquets et scripts

- Bun, avec les workspaces (`apps/*`). Le fichier `bun.lock` est **commité** : on installe avec `bun install --frozen-lockfile`.
- Les scripts racine délèguent à un workspace avec `bun run --filter @miamzy/<nom> <script>`. N'utilise jamais `bun --cwd` : la syntaxe est invalide et affiche l'aide en rendant le code 0 (un script qui « réussit » sans rien faire).
- Chaque app expose au minimum `dev`, `test`, `typecheck`. Le script racine du même nom existe.

## Versions

- **Versions exactes**, jamais `^` ni `~` (`bun add -E`).
- Ne fais **pas** confiance au tag `latest` : il peut pointer sur un RC (Prisma l'a fait : 8.0.0-rc.34). Vérifie la version installée avant de la garder (`bun pm view <paquet> dist-tags`).
- Avant d'ajouter une dépendance, vérifie ses pairs (`openapi-typescript` exige `typescript ^5.x`, donc pas TypeScript 7).
- Toute nouvelle dépendance se justifie dans `DECISIONS.md`.

## Langue

- Documentation, messages renvoyés au client, commentaires et noms de tests : **français**.
- Identifiants (variables, fonctions, types, fichiers, champs JSON, codes d'erreur) : **anglais**, sauf noms métier déjà établis.
- Messages de commit et titres de PR : **anglais** (voir `git.md`).

## Fichiers

- Noms de fichiers en `kebab-case` (`rate-limit.ts`). Types en `PascalCase`, fonctions et variables en `camelCase`, codes d'erreur en `UPPER_SNAKE_CASE`.
- Un fichier généré ne se modifie jamais à la main (`apps/api/src/api.d.ts`, `bun.lock`, migrations déjà appliquées).
- Aucun secret dans Git : `.env` est ignoré, `.env.example` ne contient que des valeurs de développement.

## Qualité

- Avant de dire qu'un travail est fini : `bun run lint`, `bun run typecheck`, `bun run test` passent.
- Formatage et lint : Biome (`bun run lint:fix`). Biome ignore les `.md` : on les met en forme à la main.
- Un commentaire explique **pourquoi**, jamais ce que le code fait déjà lire.
