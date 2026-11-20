// Le contrat (contracts/openapi.yaml) est la source de vérité : les validateurs
// de paramètres, de corps et de réponses sont construits depuis lui au démarrage.
// Aucun schéma n'est recopié dans le code.

import type { ErrorObject, ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { parse } from "yaml";
import { ApiError, type ErrorDetail } from "./errors";

type JsonSchema = Record<string, unknown>;
type Ref = { $ref: string };
type Parameter = {
  name: string;
  in: "path" | "query" | "header";
  required?: boolean;
  schema: JsonSchema;
};
type ResponseObject = {
  content?: { "application/json"?: { schema: JsonSchema } };
};
type Operation = {
  operationId: string;
  parameters?: (Parameter | Ref)[];
  requestBody?: { content: { "application/json": { schema: JsonSchema } } };
  responses: Record<string, ResponseObject | Ref>;
};
type Spec = {
  paths: Record<string, Record<string, Operation>>;
  components: {
    schemas: Record<string, JsonSchema>;
    parameters: Record<string, Parameter>;
    responses: Record<string, ResponseObject>;
  };
};

const specUrl = new URL("../../../contracts/openapi.yaml", import.meta.url);
const spec = parse(await Bun.file(specUrl).text()) as Spec;

function deref<T extends object>(
  value: T | Ref,
  section: "parameters" | "responses",
): T {
  if (!("$ref" in value)) return value;
  const name = value.$ref.split("/").pop() as string;
  return spec.components[section][name] as unknown as T;
}

/** `#/components/...` devient une référence absolue vers le contrat chargé dans Ajv. */
function absolute(schema: JsonSchema): JsonSchema {
  const ref = schema.$ref;
  return typeof ref === "string" && ref.startsWith("#")
    ? { $ref: `contract${ref}` }
    : schema;
}

function makeAjv(options: { coerce: boolean }) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictTypes: false,
    coerceTypes: options.coerce,
    useDefaults: options.coerce,
  });
  addFormats(ajv);
  ajv.addKeyword("components");
  ajv.addSchema({
    $id: "contract",
    components: { schemas: spec.components.schemas },
  });
  return ajv;
}

// Paramètres : coercition (une query string est toujours du texte) + valeurs par défaut.
const paramsAjv = makeAjv({ coerce: true });
// Corps et réponses : aucune coercition, le type doit être exact.
const strictAjv = makeAjv({ coerce: false });

type OperationInfo = {
  paramValidator: ValidateFunction;
  aliases: Map<string, string>;
  paramSpecs: Parameter[];
  bodyValidator?: ValidateFunction;
  responses: Map<number, JsonSchema | undefined>;
};

const key = (p: Parameter) =>
  p.in === "header" ? p.name.toLowerCase() : p.name;

const operations = new Map<string, OperationInfo>();
for (const methods of Object.values(spec.paths)) {
  for (const op of Object.values(methods)) {
    const paramSpecs = (op.parameters ?? []).map((p) =>
      deref<Parameter>(p, "parameters"),
    );
    const aliases = new Map(paramSpecs.map((p) => [key(p), p.name]));
    const bodySchema = op.requestBody?.content["application/json"].schema;
    const responses = new Map<number, JsonSchema | undefined>();
    for (const [status, response] of Object.entries(op.responses)) {
      const resolved = deref<ResponseObject>(response, "responses");
      const schema = resolved.content?.["application/json"]?.schema;
      responses.set(Number(status), schema ? absolute(schema) : undefined);
    }
    operations.set(op.operationId, {
      paramSpecs,
      aliases,
      paramValidator: paramsAjv.compile({
        type: "object",
        properties: Object.fromEntries(
          paramSpecs.map((p) => [key(p), p.schema]),
        ),
        required: paramSpecs.filter((p) => p.required).map(key),
      }),
      bodyValidator: bodySchema
        ? strictAjv.compile(absolute(bodySchema))
        : undefined,
      responses,
    });
  }
}

const responseValidators = new Map<JsonSchema, ValidateFunction>();

function operationInfo(operationId: string): OperationInfo {
  const info = operations.get(operationId);
  if (!info) throw new Error(`operationId inconnu du contrat : ${operationId}`);
  return info;
}

function toDetails(
  errors: ErrorObject[],
  aliases: Map<string, string> = new Map(),
): ErrorDetail[] {
  return errors.map((e) => {
    const path = e.instancePath.split("/").filter(Boolean);
    if (e.keyword === "required") path.push(e.params.missingProperty);
    if (e.keyword === "additionalProperties")
      path.push(e.params.additionalProperty);
    const field = path.map((p) => aliases.get(p) ?? p).join(".");
    return { field: field || "(corps)", issue: e.message ?? "valeur invalide" };
  });
}

type RawParams = {
  path: Record<string, string>;
  query: Record<string, string>;
  header: (name: string) => string | undefined;
};

/** Valide et convertit chemin, query et en-têtes d'après le contrat. 400 si invalide. */
export function validateParameters(
  operationId: string,
  raw: RawParams,
): Record<string, unknown> {
  const info = operationInfo(operationId);
  const values: Record<string, unknown> = {};
  for (const p of info.paramSpecs) {
    const value =
      p.in === "path"
        ? raw.path[p.name]
        : p.in === "query"
          ? raw.query[p.name]
          : raw.header(p.name);
    if (value !== undefined) values[key(p)] = value;
  }
  if (!info.paramValidator(values)) {
    throw new ApiError(
      400,
      "INVALID_PARAMETER",
      "Un paramètre de la requête est invalide ou manquant : voir 'details'.",
      toDetails(info.paramValidator.errors ?? [], info.aliases),
    );
  }
  return values;
}

/** Valide un corps JSON déjà lu d'après le contrat. 422 si invalide. */
export function validateBody(operationId: string, body: unknown): void {
  const validate = operationInfo(operationId).bodyValidator;
  if (!validate || validate(body)) return;
  const errors = validate.errors ?? [];
  const emptyCart = errors.some(
    (e) => e.keyword === "minItems" && e.instancePath === "/items",
  );
  throw emptyCart
    ? new ApiError(
        422,
        "EMPTY_CART",
        "Le panier est vide : ajoutez au moins un plat dans 'items'.",
        toDetails(errors),
      )
    : new ApiError(
        422,
        "VALIDATION_FAILED",
        "Le corps de la requête est invalide : voir 'details'.",
        toDetails(errors),
      );
}

/**
 * Compare une réponse réelle au contrat. Retourne les écarts, ou null si conforme.
 * Les 5xx ne sont pas déclarés dans le contrat : ils ne sont pas contrôlés.
 */
export function checkResponse(
  operationId: string,
  status: number,
  body: unknown,
): ErrorDetail[] | null {
  if (status >= 500) return null;
  const schema = operationInfo(operationId).responses.get(status);
  if (!operationInfo(operationId).responses.has(status)) {
    return [
      {
        field: "status",
        issue: `statut ${status} non déclaré pour ${operationId}`,
      },
    ];
  }
  if (!schema) return null;
  let validate = responseValidators.get(schema);
  if (!validate) {
    validate = strictAjv.compile(schema);
    responseValidators.set(schema, validate);
  }
  return validate(body) ? null : toDetails(validate.errors ?? []);
}
