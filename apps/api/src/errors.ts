import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { components } from "./api";

export type ErrorDetail = components["schemas"]["ErrorDetail"];
export type ErrorBody = components["schemas"]["Error"];

/** Erreur métier : toujours rendue au format unique du contrat (schéma `Error`). */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details: ErrorDetail[] = [],
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export function errorBody(
  code: string,
  message: string,
  details: ErrorDetail[] = [],
): ErrorBody {
  return { error: { code, message, details } };
}

export const notFound = (code: string, message: string) =>
  new ApiError(404, code, message);
