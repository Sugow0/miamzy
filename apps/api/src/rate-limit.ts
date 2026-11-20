import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "hono/bun";
import { ApiError } from "./errors";

export type RateLimitConfig = {
  /** Taille du seau : requêtes autorisées d'un coup (rafale). */
  capacity: number;
  /** Jetons rendus par seconde : débit soutenu autorisé. */
  refillPerSec: number;
  /** Lire X-Forwarded-For. Uniquement derrière un proxy de confiance qui l'écrase. */
  trustProxy: boolean;
  /** Nombre maximal de clients suivis (borne la mémoire). */
  maxKeys?: number;
  /** Horloge injectable : les tests n'attendent pas de vraies secondes. */
  now?: () => number;
};

export type Verdict = { allowed: boolean; retryAfterSec: number };

type Bucket = { tokens: number; updatedAt: number };

/**
 * Seau à jetons, un par client. Chaque requête coûte un jeton ; le seau se
 * recharge en continu. Pas de « fenêtre » : un client ne peut pas obtenir le
 * double de la limite en se calant sur le changement de fenêtre.
 *
 * Le compteur vit dans la mémoire de CE processus : voir DECISIONS.md D10
 * pour ce qui change avec plusieurs serveurs.
 */
export function createRateLimiter(config: RateLimitConfig) {
  const { capacity, refillPerSec, maxKeys = 100_000, now = Date.now } = config;
  const buckets = new Map<string, Bucket>();

  function consume(key: string): Verdict {
    const t = now();
    const known = buckets.get(key);
    const bucket: Bucket = known
      ? {
          tokens: Math.min(
            capacity,
            known.tokens + ((t - known.updatedAt) / 1000) * refillPerSec,
          ),
          updatedAt: t,
        }
      : { tokens: capacity, updatedAt: t };

    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;

    // On réinsère à la fin : le Map garde l'ordre d'insertion, donc le premier
    // élément est toujours le client resté le plus longtemps sans requête.
    buckets.delete(key);
    buckets.set(key, bucket);
    while (buckets.size > maxKeys) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }

    return {
      allowed,
      retryAfterSec: allowed
        ? 0
        : Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerSec)),
    };
  }

  return { consume, size: () => buckets.size };
}

export function clientKey(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** À monter AVANT toutes les routes : une requête refusée ne touche jamais la base. */
export function rateLimit(
  limiter: ReturnType<typeof createRateLimiter>,
  trustProxy: boolean,
): MiddlewareHandler {
  return async (c, next) => {
    const verdict = limiter.consume(clientKey(c, trustProxy));
    if (!verdict.allowed) {
      const s = verdict.retryAfterSec;
      throw new ApiError(
        429,
        "RATE_LIMITED",
        `Trop de requêtes. Réessayez dans ${s} seconde${s > 1 ? "s" : ""}.`,
        [],
        { "Retry-After": String(s) },
      );
    }
    await next();
  };
}
