/**
 * Remise en pourcentage, arrondie à l'entier le plus proche, 0,5 vers le haut.
 * Règle écrite dans le contrat (POST /v1/orders) et dans DECISIONS.md D11.
 * Calcul en entiers : aucun flottant, donc aucune erreur d'arrondi cachée.
 *
 *   discountFor(4505, 10) === 451   (450,5 arrondi vers le haut)
 */
export function discountFor(subtotalCents: number, percentOff: number): number {
  return Math.floor((subtotalCents * percentOff + 50) / 100);
}
