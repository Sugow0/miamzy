---
paths:
  - "packages/**"
---

# packages/ : code partagé entre applications

Aucun package n'existe aujourd'hui. Cette règle fixe les conventions pour le premier.

- Nom : `@miamzy/<nom>`, dossier `packages/<nom>`, `"private": true`.
- Un package n'a **pas** de dépendance vers une app. Les dépendances vont dans un seul sens : `apps/*` vers `packages/*`. Aucun cycle.
- Il expose une API publique minimale via un unique `index.ts` ; rien d'autre n'est importé de l'extérieur.
- Dépendance interne : `"@miamzy/<nom>": "workspace:*"`.
- Il a ses scripts `typecheck` et `test`, et ses propres tests.
- Avant de créer un package : l'extraction se justifie quand **deux** apps l'utilisent réellement. Pas d'extraction « au cas où ».
- Candidat évident : un package de types générés depuis le contrat, quand une seconde app (front, back-office) en aura besoin.
- Création : ajouter le workspace, les scripts racine (`--filter`), une ligne dans le README, une entrée dans `DECISIONS.md`, et un fichier de règles ici si ses conventions diffèrent.
