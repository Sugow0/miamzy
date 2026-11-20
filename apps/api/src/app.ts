import type { SQL } from "bun";
import { Hono } from "hono";
import { ApiError, errorBody } from "./errors";
import { contractGuard, type Env } from "./http";
import {
  createRateLimiter,
  type RateLimitConfig,
  rateLimit,
} from "./rate-limit";
import { ordersRoutes } from "./routes/orders";
import { paymentsRoutes } from "./routes/payments";
import { usersRoutes } from "./routes/users";

const positive = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return value !== undefined && Number.isFinite(n) && n > 0 ? n : fallback;
};

export type AppOptions = { rateLimit?: Partial<RateLimitConfig> };

export function createApp(sql: SQL, options: AppOptions = {}) {
  const app = new Hono<Env>();

  // Premier maillon : une requête refusée ne va jamais jusqu'à la base.
  const limit: RateLimitConfig = {
    capacity: positive(process.env.RATE_LIMIT_CAPACITY, 60),
    refillPerSec: positive(process.env.RATE_LIMIT_REFILL_PER_SEC, 1),
    trustProxy: process.env.TRUST_PROXY === "true",
    ...options.rateLimit,
  };
  app.use(rateLimit(createRateLimiter(limit), limit.trustProxy));

  if (process.env.VALIDATE_RESPONSES === "true") app.use(contractGuard);

  app.route("/v1/orders", ordersRoutes(sql));
  app.route("/v1/orders", paymentsRoutes(sql));
  app.route("/v1/users", usersRoutes(sql));

  app.notFound((c) =>
    c.json(errorBody("ROUTE_NOT_FOUND", "Cette route n'existe pas."), 404),
  );

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      for (const [name, value] of Object.entries(err.headers))
        c.header(name, value);
      return c.json(errorBody(err.code, err.message, err.details), err.status);
    }
    // Jamais de détail interne côté client : le message reste générique.
    console.error(err);
    return c.json(
      errorBody("INTERNAL_ERROR", "Erreur interne. Réessayez plus tard."),
      500,
    );
  });

  return app;
}
