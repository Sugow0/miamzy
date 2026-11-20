import type { Context, MiddlewareHandler } from "hono";
import { checkResponse, validateBody, validateParameters } from "./contract";
import { ApiError, errorBody } from "./errors";

export type Env = { Variables: { operationId?: string } };

/**
 * Lie un handler à une opération du contrat (operationId) :
 * les paramètres sont validés et convertis AVANT d'entrer dans le handler.
 */
export function operation<P = Record<string, unknown>>(
  operationId: string,
  handler: (c: Context<Env>, params: P) => Promise<Response>,
) {
  return async (c: Context<Env>) => {
    c.set("operationId", operationId);
    const params = validateParameters(operationId, {
      path: c.req.param(),
      query: c.req.query(),
      header: (name) => c.req.header(name),
    });
    return handler(c, params as P);
  };
}

/** Lit le corps JSON (400 si illisible) puis le valide contre le contrat (422). */
export async function readBody<T>(
  c: Context<Env>,
  operationId: string,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(
      400,
      "INVALID_JSON",
      "Le corps de la requête n'est pas un JSON lisible.",
    );
  }
  validateBody(operationId, raw);
  return raw as T;
}

/**
 * Garde-fou de développement et de test (VALIDATE_RESPONSES=true) :
 * toute réponse qui s'écarte du contrat devient une 500 explicite.
 */
export const contractGuard: MiddlewareHandler<Env> = async (c, next) => {
  await next();
  const operationId = c.get("operationId");
  if (!operationId) return;
  if (!c.res.headers.get("content-type")?.includes("json")) return;
  const body = await c.res.clone().json();
  const problems = checkResponse(operationId, c.res.status, body);
  if (problems) {
    c.res = new Response(
      JSON.stringify(
        errorBody(
          "CONTRACT_VIOLATION",
          `La réponse de ${operationId} ne respecte pas le contrat.`,
          problems,
        ),
      ),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
};
