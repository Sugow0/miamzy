# Contribuer à Miamzy

Ce guide explique comment travailler sur le dépôt. Les conventions de code détaillées, zone par zone, sont dans [`.claude/rules/`](.claude/rules) ; ce document donne le flux de travail et les raisons.

## Sommaire

- [Avant de commencer](#avant-de-commencer)
- [Flux de travail](#flux-de-travail)
- [Messages de commit](#messages-de-commit)
- [Pull requests](#pull-requests)
- [Ajouter ou modifier une route](#ajouter-ou-modifier-une-route)
- [Migrations de base](#migrations-de-base)
- [Tests](#tests)
- [Preuves](#preuves)
- [Style de code](#style-de-code)
- [Journal de décisions](#journal-de-décisions)
- [Règles du TP sur l'IA](#règles-du-tp-sur-lia)
- [Liste de contrôle avant une PR](#liste-de-contrôle-avant-une-pr)

## Avant de commencer

1. Installer l'environnement : suivre le [démarrage rapide du README](README.md#démarrage-rapide).
2. Lire [`DECISIONS.md`](DECISIONS.md) : chaque choix y a sa raison et ses limites. Avant de « corriger » quelque chose d'inhabituel, vérifier qu'une décision ne l'explique pas.
3. Lancer `bun run test` : tout doit être vert avant que tu touches au code.

## Flux de travail

Une branche par changement, une PR par branche.

- Étapes du TP : `etape-<n>-<sujet>`. Autres changements : `<type>/<sujet>` (`docs/readme`, `fix/root-scripts`).
- Les PR sont **empilées** : la base d'une PR est la branche de la précédente, et on fusionne dans l'ordre.
- Ne jamais réécrire l'historique d'une branche poussée, ni `push --force`, sans l'accord du mainteneur.

## Messages de commit

Conventional Commits, strictement, sur **une seule ligne** :

```
<type>(<scope>): <description>
```

- Types : `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`, `perf`, `build`.
- Minuscules, **anglais**, impératif présent (`add`, `fix`, `remove`), 72 caractères au maximum, pas de point final, pas de corps.
- Scope : un ou deux mots (`api`, `db`, `contract`, `proofs`, `repo`).
- Fichiers générés (types OpenAPI, migrations, lockfile) : `chore`.
- **Aucun trailer** (`Co-Authored-By`...) et aucune mention d'outil.
- Un commit = une unité logique : scinder plutôt que mélanger.

```bash
git commit -m "feat(api): add promo code to order creation"
```

Le « pourquoi » détaillé va dans `DECISIONS.md` ou dans la description de la PR, pas dans le commit.

## Pull requests

- Titre au même format qu'un commit.
- Description en français : résultat attendu (cases à cocher), preuve, limites connues. Dire honnêtement ce qui n'est pas fait ou pas prouvé.
- Si la PR est empilée, indiquer la PR de base en tête.
- Pas de ligne « Generated with ... » ni de mention d'outil.

## Ajouter ou modifier une route

L'ordre compte : **contrat, base, code, tests, preuves**. Chaque étape est un commit.

1. **Contrat** : modifier `contracts/openapi.yaml` (nouvel `operationId`, schémas, erreurs, exemples). Changement additif : version mineure ; rupture : version majeure et `/v2` (voir [`.claude/rules/contract.md`](.claude/rules/contract.md)).
2. **Types** : `bun run gen:types`, puis `bun run typecheck`. Les écarts avec le code s'affichent : c'est voulu.
3. **Base** (si besoin) : modifier `schema.prisma`, créer la migration, voir [Migrations](#migrations-de-base).
4. **Code** : dans `apps/api/src/routes/<ressource>.ts`, lier le handler à l'`operationId` avec `operation(...)`. La validation vient du contrat, les erreurs passent par `ApiError`.
5. **Tests** : au moins un test du cas nominal et un par erreur déclarée (voir [Tests](#tests)).
6. **Preuve** et **décision** : voir [Preuves](#preuves) et [Journal](#journal-de-décisions).

## Migrations de base

```bash
cd apps/api
bun --env-file=../../.env prisma migrate dev --create-only --name <sujet>
# relire le SQL, ajouter à la main les CHECK, puis :
bun run db:migrate
bun run db:drift        # doit répondre : No difference detected
```

- Ne **jamais** modifier une migration déjà appliquée : en créer une nouvelle.
- Migration additive d'abord. Resserrer (`NOT NULL`, suppression) plus tard.
- Vérifier la clé étrangère générée : Prisma met `SET NULL` par défaut, il faut souvent `RESTRICT`.

## Tests

```bash
bun run test
```

- Un test vérifie un comportement et regarde **au-delà du statut** : contenu de la base, corps exact, absence d'effet de bord.
- Les tests vident les tables de `miamzy_test` ; ils refusent de tourner ailleurs.
- Quand tu ajoutes une protection, prouve qu'elle est testée : ajoute un sabotage dans `preuves/etape-8/saboter.sh` et **vérifie que c'est le bon test qui devient rouge**.

## Preuves

Chaque étape du TP a un dossier `preuves/etape-<n>/` avec un script `capturer.sh` et sa sortie `captures.txt`, produite par le script, jamais éditée à la main. Une bonne preuve compare deux nombres qui divergeraient si le comportement était faux, et inclut un témoin positif. Détails : [`.claude/rules/proofs.md`](.claude/rules/proofs.md).

## Style de code

```bash
bun run lint:fix && bun run typecheck
```

Biome formate et contrôle le TypeScript, le JSON et le YAML. Les `.md` sont exclus : les mettre en forme à la main. Conventions de nommage, d'architecture et d'erreurs : [`.claude/rules/api.md`](.claude/rules/api.md).

## Journal de décisions

Toute décision qui n'est pas évidente va dans [`DECISIONS.md`](DECISIONS.md) : **Choix**, **Parce que**, **Écarté**, **Vérifié**, **Limites assumées**. On n'efface pas une décision révisée : on garde la première version et la raison du changement.

## Règles du TP sur l'IA

- **Partie 1** (`REPONSES.md`, les 10 études de cas) : IA **interdite**. C'est votre diagnostic qui est évalué.
- **Partie 2** (l'API) : IA autorisée à **une condition** : le groupe décide, l'outil exécute. Tenir un journal des prompts (`PROMPTS.md` : ce qui a été demandé, ce qui a bien marché, ce qu'il a fallu corriger et pourquoi). Le groupe doit pouvoir expliquer chaque ligne livrée.

## Liste de contrôle avant une PR

- [ ] `bun run lint`, `bun run typecheck` et `bun run test` passent
- [ ] Le contrat est à jour, `bun run gen:types` a été relancé
- [ ] Aucune migration appliquée n'a été modifiée, `db:drift` est propre
- [ ] Les nouveaux comportements ont un test qui regarde au-delà du statut
- [ ] La décision est consignée dans `DECISIONS.md`, avec ses limites
- [ ] Les commandes citées dans le README ont été exécutées
- [ ] Aucun secret, aucun `.env` dans le diff
- [ ] Commits sur une ligne, en anglais ; titre de PR au même format
