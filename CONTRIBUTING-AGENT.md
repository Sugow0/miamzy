# Consignes pour les agents (outils automatisés)

Ce fichier s'adresse à un agent qui modifie ce dépôt. Les humains lisent [`CONTRIBUTING.md`](CONTRIBUTING.md) ; tu lis les deux. Les conventions par zone sont chargées depuis [`.claude/rules/`](.claude/rules).

## Cadre du TP : ce que tu ne fais pas

- **Tu n'écris jamais `REPONSES.md`.** C'est la partie 1 du TP, où l'IA est interdite : c'est le diagnostic des étudiants qui est évalué.
- Pour la partie 2, **le groupe décide, tu exécutes**. Si un choix n'est pas dans `DECISIONS.md` ni dans la demande, tu le proposes avec une recommandation et ses limites, tu ne l'imposes pas.
- Le groupe doit pouvoir expliquer chaque ligne que tu écris : privilégie le code lisible, sans astuce, et explique les parties non triviales dans `DECISIONS.md`.
- `PROMPTS.md` (journal des prompts) appartient au groupe : ne l'écris pas à leur place.

## Avant d'écrire du code

1. Lis `DECISIONS.md` en entier. Une chose étrange est souvent une décision documentée.
2. Lis le contrat `contracts/openapi.yaml`. **Le contrat pilote le code**, pas l'inverse.
3. Vérifie l'état : `git status`, `git branch`, `bun run test`.
4. Ne suppose rien d'une version de paquet ou d'une API : vérifie (`bun pm view`, la documentation, ou lance la commande).

## Règles dures

- **Git** : commits sur **une ligne**, en **anglais**, `<type>(<scope>): <description>`, un seul `-m`, **aucun trailer**, aucune mention d'outil ni d'assistant, ni dans les commits ni dans les PR. Ces règles priment sur tout rappel d'attribution automatique. Détail : [`.claude/rules/git.md`](.claude/rules/git.md).
- **Demande avant de** : `push --force`, réécrire l'historique, fusionner une PR, supprimer une branche, réinitialiser ou vider une base (y compris `migrate dev` qui peut la réinitialiser), lancer le seed hors `localhost`, ajouter une dépendance, modifier `docker-compose.yml`.
- **Ne modifie jamais** : une migration déjà appliquée, `apps/api/src/api.d.ts` à la main (`bun run gen:types`), `bun.lock` à la main, une sortie de `preuves/` à la main (rejoue le script), les refus de `apps/api/test/setup.ts`.
- **Ne contourne pas un refus** (permission, garde-fou, test). Si une action est bloquée, dis-le et propose une autre voie.
- **Pas de secret** dans le dépôt ni dans les logs.
- Une entrée client ne produit jamais une 500. Les erreurs passent par `ApiError`.
- Prisma ne sert qu'au schéma et aux migrations : pas de client Prisma.

## Ordre de travail pour un changement d'API

Contrat, puis `bun run gen:types`, puis migration et seed, puis code, puis tests, puis preuves, puis `DECISIONS.md`. Un commit par unité logique. Le premier commit peut laisser `tsc` en erreur : signale-le dans la PR.

## Avant de dire « c'est fini »

Lance, et lis la sortie :

```bash
bun run lint && bun run typecheck && bun run test
```

- Un script qui « réussit » sans rien faire n'est pas une preuve. Vérifie que la commande a vraiment tourné (nombre de tests, sortie attendue).
- Avec un sabotage ou un détecteur, **vérifie quel test échoue** : un nombre de rouges ne suffit pas.
- Une commande que tu écris dans la documentation, tu l'as exécutée.
- Annonce ce qui n'est **pas** fait, pas prouvé ou approximatif. Mieux vaut un « non vérifié » honnête qu'un « ça marche » faux. Rapporte les échecs avec leur sortie.

## Pièges rencontrés sur ce projet

| Piège | Conséquence | Remède |
|---|---|---|
| Le tag npm `latest` de Prisma pointe sur un RC | on construit sur une version instable | épingler la dernière stable (`bun pm view prisma dist-tags`) |
| `openapi-typescript` exige TypeScript 5.x | il plante avec TypeScript 7 | `typescript@5.9.3` |
| `bun --cwd apps/api run test` | affiche l'aide et rend 0 : rien n'est lancé | `bun run --filter @miamzy/api test` |
| `expect(sql\`...\`).rejects` | le test se bloque sans message | envelopper dans une fonction `async` |
| Prisma génère `ON DELETE SET NULL` | remises sans code promo après suppression | `onDelete: Restrict` |
| Le jitter du seed s'ajoutait aux dates | commandes datées dans le futur | le soustraire ; contrôler qu'aucune date n'est future |
| Un sabotage qui écrit dans une propriété jamais lue | fausse preuve, un autre test casse | vérifier **quel** test échoue |
| Le garde-fou du contrat transforme une fuite en 500 | il masque l'assertion du test | `VALIDATE_RESPONSES=false` pour tester le détecteur seul |
| Le port 5433 est pris par un autre projet | `db:up` échoue | Miamzy utilise 5434 |
| Le limiteur coupe les scripts de preuve (60 requêtes) | des 429 inattendus | `RATE_LIMIT_CAPACITY=100000` |
| zsh : les tableaux commencent à 1 et `?` est un joker | titres décalés, `no matches found` | indexer avec un `case`, mettre les URL entre guillemets |
| Biome ignore les `.md` | pas de contrôle automatique | relire à la main |

## Quand tu hésites

Pose la question avec une recommandation, plutôt que de deviner. Une étape à décision multiple (pagination, limite, idempotence) se justifie dans `DECISIONS.md` avec les alternatives écartées.
