// Une réponse d'aujourd'hui est-elle lisible par une APPLICATION D'HIER ?
//
//   bun scripts/compat.ts <ancien-contrat.yaml> <Schéma>  < réponses.json
//
// Lit sur stdin un objet ou un tableau JSON et le valide contre le schéma de
// l'ancien contrat, de deux façons :
//   - TOLÉRANT : l'app ignore les champs qu'elle ne connaît pas (le cas courant) ;
//   - STRICT   : l'app refuse un champ inconnu (décodeur strict, le cas qui casserait).
// Code de sortie 1 si la lecture TOLÉRANTE échoue : c'est une vraie rupture.

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { parse } from "yaml";

const [contractPath, schemaName] = process.argv.slice(2);
if (!contractPath || !schemaName) {
  console.error("usage : bun scripts/compat.ts <ancien-contrat.yaml> <Schéma>");
  process.exit(2);
}

type Json = Record<string, unknown>;
const spec = parse(await Bun.file(contractPath).text()) as {
  components: { schemas: Record<string, Json> };
};

/** Copie profonde sans `additionalProperties: false` : ce que voit une app tolérante. */
function tolerant<T>(node: T): T {
  if (Array.isArray(node)) return node.map(tolerant) as T;
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node as Json)
        .filter(([k, v]) => !(k === "additionalProperties" && v === false))
        .map(([k, v]) => [k, tolerant(v)]),
    ) as T;
  }
  return node;
}

function validatorFor(schemas: Record<string, Json>) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema({ $id: "old", components: { schemas } });
  return ajv.compile({ $ref: `old#/components/schemas/${schemaName}` });
}

const strict = validatorFor(spec.components.schemas);
const lenient = validatorFor(tolerant(spec.components.schemas));

const input = JSON.parse(await Bun.stdin.text());
const items: unknown[] = Array.isArray(input) ? input : [input];

let brokenTolerant = 0;
let brokenStrict = 0;
const strictReasons = new Set<string>();
for (const item of items) {
  if (!lenient(item)) brokenTolerant++;
  if (!strict(item)) {
    brokenStrict++;
    for (const e of strict.errors ?? []) {
      strictReasons.add(
        e.keyword === "additionalProperties"
          ? `champ inconnu « ${e.params.additionalProperty} »`
          : `${e.instancePath || "(racine)"} ${e.message}`,
      );
    }
  }
}

console.log(
  `${items.length} réponse(s) validée(s) contre ${schemaName} de l'ancien contrat`,
);
console.log(
  `  app TOLÉRANTE (ignore les champs inconnus) : ${brokenTolerant === 0 ? "OK, aucune rupture" : `${brokenTolerant} RUPTURE(S)`}`,
);
console.log(
  `  app STRICTE   (refuse un champ inconnu)    : ${brokenStrict === 0 ? "OK" : `${brokenStrict} refusée(s) : ${[...strictReasons].join(", ")}`}`,
);
process.exit(brokenTolerant === 0 ? 0 : 1);
