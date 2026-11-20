---
paths:
  - "preuves/**"
---

# Preuves du TP

Chaque étape produit une preuve **rejouable** dans `preuves/etape-<n>/`.

- `capturer.sh` : script qui produit la preuve contre l'API qui tourne. `captures.txt` : sa sortie, commitée. On ne modifie **jamais** une sortie à la main : on rejoue le script.
- `preuves/lib.sh` : fonctions communes (`show`, `load_ids`). Les scripts restent lisibles de bout en bout.
- Utilise `mktemp` pour les fichiers temporaires, jamais un nom fixe dans `/tmp`.
- Une preuve **falsifiable** compare deux nombres qui divergeraient si le comportement était faux (ex. 200 requêtes envoyées, 61 acceptées, la base lue 61 fois et non 200).
- Un détecteur a un **témoin positif** (il trouve ce qu'il doit trouver).
- Écris les limites de la preuve dans `DECISIONS.md` : un test favorable par construction se signale.
- Les scripts d'avant l'étape 6 envoient plus de 60 requêtes : pour les rejouer, `RATE_LIMIT_CAPACITY=100000`. L'étape 6 demande `TRUST_PROXY=true`.
- Les sorties peuvent contenir des identifiants de la base de développement : jamais de secret.
