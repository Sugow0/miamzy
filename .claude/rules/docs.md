---
paths:
  - "**/*.md"
---

# Documentation

- Langue : **français**, ton direct, phrases courtes. Pas d'emoji dans les documents du dépôt.
- Biome ignore les `.md` : mets en forme à la main (titres hiérarchisés, tableaux alignés, blocs de code avec langage).
- Les liens internes sont relatifs. Toute commande citée est **exécutée avant d'être documentée**.

## `DECISIONS.md` (journal)

Une entrée `## D<n> – Titre (étape <k>)` par décision, jamais réécrite après coup (on ajoute une entrée ou un paragraphe « révisé »). Structure :

- **Choix** : ce qu'on fait.
- **Parce que** : les raisons vérifiables (pas « c'est simple »).
- **Écarté** : les alternatives et pourquoi.
- **Vérifié** : ce qui a été mesuré, avec les chiffres.
- **Limites assumées** : ce qui ne marche pas, ce qui n'est pas prouvé.

Dis les erreurs : une décision révisée garde la première version et la raison du changement.

## README, CONTRIBUTING

Le README répond à : qu'est-ce que c'est, comment le lancer, comment l'utiliser, comment le tester, où est la suite. Il ne contient aucune promesse non vérifiée. Pas de badge sans service derrière.
