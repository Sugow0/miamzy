import type { SQL } from "bun";
import { Hono } from "hono";
import type { components } from "../api";
import { notFound } from "../errors";
import { type Env, operation } from "../http";

type User = components["schemas"]["User"];

export function usersRoutes(sql: SQL) {
  const app = new Hono<Env>();

  app.get(
    "/:id",
    operation<{ id: string }>("getUser", async (c, { id }) => {
      // Liste blanche de colonnes : email, téléphone et hash ne sont jamais lus.
      const [row] = await sql`
        SELECT id, first_name, created_at FROM users WHERE id = ${id}`;
      if (!row) {
        throw notFound(
          "USER_NOT_FOUND",
          "Aucun utilisateur ne porte cet identifiant.",
        );
      }
      const user: User = {
        id: row.id,
        firstName: row.first_name,
        createdAt: row.created_at.toISOString(),
      };
      return c.json(user, 200);
    }),
  );

  return app;
}
