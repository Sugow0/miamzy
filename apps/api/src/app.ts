import type { SQL } from "bun";
import { Hono } from "hono";
import { ApiError, errorBody } from "./errors";
import { contractGuard, type Env } from "./http";
import { ordersRoutes } from "./routes/orders";
import { paymentsRoutes } from "./routes/payments";
import { usersRoutes } from "./routes/users";

export function createApp(sql: SQL) {
  const app = new Hono<Env>();

  if (process.env.VALIDATE_RESPONSES === "true") app.use(contractGuard);

  app.route("/v1/orders", ordersRoutes(sql));
  app.route("/v1/orders", paymentsRoutes(sql));
  app.route("/v1/users", usersRoutes(sql));

  app.notFound((c) =>
    c.json(errorBody("ROUTE_NOT_FOUND", "Cette route n'existe pas."), 404),
  );

  app.onError((err, c) => {
    if (err instanceof ApiError) {
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
