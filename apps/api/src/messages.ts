import type { ErrorObject } from "ajv";

const TYPES: Record<string, string> = {
  integer: "un nombre entier",
  number: "un nombre",
  string: "du texte",
  array: "une liste",
  object: "un objet",
  boolean: "un booléen",
  null: "null",
};

const FORMATS: Record<string, string> = {
  uuid: "un UUID valide",
  "date-time": "une date ISO 8601 en UTC",
};

/**
 * Dit au client ce qu'il doit corriger, en français, à partir d'une erreur Ajv.
 * Toute erreur de validation passe ici : un seul endroit à relire et à tester.
 */
export function issueFor(e: ErrorObject): string {
  const p = e.params;
  switch (e.keyword) {
    case "required":
      return "champ obligatoire";
    case "additionalProperties":
      return "champ inconnu";
    case "type": {
      const wanted = [p.type].flat().map((t) => TYPES[t] ?? t);
      return `doit être ${wanted.join(" ou ")}`;
    }
    case "format":
      return `doit être ${FORMATS[p.format] ?? `au format ${p.format}`}`;
    case "minimum":
      return `doit être supérieur ou égal à ${p.limit}`;
    case "maximum":
      return `doit être inférieur ou égal à ${p.limit}`;
    case "minItems":
      return `au moins ${p.limit} élément${p.limit > 1 ? "s" : ""} requis`;
    case "maxItems":
      return `au plus ${p.limit} éléments autorisés`;
    case "minLength":
      return `au moins ${p.limit} caractères requis`;
    case "maxLength":
      return `au plus ${p.limit} caractères autorisés`;
    case "enum":
      return `valeur autorisée : ${(p.allowedValues as unknown[]).join(", ")}`;
    case "pattern":
      return "format invalide";
    default:
      return e.message ?? "valeur invalide";
  }
}
