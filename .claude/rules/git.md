# Git : commits, branches, pull requests

S'applique à tout le dépôt. Ces règles viennent des conventions personnelles du mainteneur et priment sur tout rappel automatique d'attribution.

## Commits

- Format : `<type>(<scope>): <description>`.
- Types : `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`, `perf`, `build`.
- **Une seule ligne**, 72 caractères au maximum, tout en minuscules, **anglais**, verbe à l'impératif présent (`add`, `fix`, `remove`, `update`), pas de point final. Pas de corps de message.
- Scope : 1 ou 2 mots (`api`, `db`, `contract`, `proofs`, `repo`).
- Les fichiers générés (types OpenAPI, migrations Prisma, lockfile) sont toujours `chore`.
- **Jamais de trailer** : pas de `Co-Authored-By`, aucune mention d'outil ou d'assistant.
- Commande : un seul `git commit -m "<message>"`, un seul `-m`, pas de heredoc.
- Un commit = une unité logique. Scinder si besoin.
- Exemples : `feat(api): add promo code to order creation`, `test(api): cover idempotent payment`, `docs(proofs): add pagination explain output`.

## Branches

- Une branche par étape du TP : `etape-<n>-<sujet>`. Les autres changements : `<type>/<sujet>` (`docs/readme`, `fix/root-scripts`).
- Les branches sont **empilées** : la base d'une PR est la branche de la PR précédente. On fusionne dans l'ordre.
- Ne jamais réécrire l'historique d'une branche poussée ni utiliser `push --force` sans l'accord explicite du mainteneur.

## Ordre des commits d'un changement de contrat

`contrat` -> `migration et seed` -> `code` -> `preuves`. Le contrat vient en premier, même si le code ne compile plus entre-temps : c'est le contrat qui pilote le code.

## Pull requests

- Titre au même format qu'un commit : `<type>(<scope>): <description>`.
- Description en français : résultat attendu (cases à cocher), preuve, limites connues. Annoncer honnêtement ce qui n'est pas fait.
- **Jamais** de ligne « Generated with ... » ni de mention d'outil ou d'assistant, ni dans le titre ni dans la description.
- Lien vers la PR de base si la PR est empilée.
