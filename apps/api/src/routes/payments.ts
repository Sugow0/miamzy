import type { SQL } from "bun";
import { Hono } from "hono";
import type { components } from "../api";
import { ApiError, notFound } from "../errors";
import { type Env, operation, readBody } from "../http";

type Payment = components["schemas"]["Payment"];
type PayOrderRequest = components["schemas"]["PayOrderRequest"];

type PaymentRow = {
  id: string;
  order_id: string;
  idempotency_key: string;
  method: Payment["method"];
  status: Payment["status"];
  amount_cents: number;
  currency: string;
  created_at: Date;
};

const toPayment = (row: PaymentRow): Payment => ({
  id: row.id,
  orderId: row.order_id,
  method: row.method,
  status: row.status,
  amountCents: row.amount_cents,
  currency: row.currency,
  createdAt: row.created_at.toISOString(),
});

export function paymentsRoutes(sql: SQL) {
  const app = new Hono<Env>();

  app.post(
    "/:id/payments",
    operation<{ id: string; "idempotency-key": string }>(
      "payOrder",
      async (c, params) => {
        const orderId = params.id;
        const key = params["idempotency-key"];
        const body = await readBody<PayOrderRequest>(c, "payOrder");

        const payment = await sql.begin(async (tx) => {
          // Verrou sur la commande : deux paiements simultanés de la même commande
          // passent l'un après l'autre, jamais en même temps.
          const [order] = await tx`
            SELECT id, total_cents, currency FROM orders WHERE id = ${orderId} FOR UPDATE`;
          if (!order) {
            throw notFound(
              "ORDER_NOT_FOUND",
              "Aucune commande ne porte cet identifiant.",
            );
          }

          // ON CONFLICT DO NOTHING couvre les deux unicités : clé d'idempotence ET commande.
          const [inserted]: PaymentRow[] = await tx`
            INSERT INTO payments (order_id, idempotency_key, method, status, amount_cents, currency)
            VALUES (${orderId}, ${key}, ${body.method}, 'succeeded', ${order.total_cents}, ${order.currency})
            ON CONFLICT DO NOTHING
            RETURNING *`;
          if (inserted) {
            await tx`UPDATE orders SET status = 'paid' WHERE id = ${orderId}`;
            return inserted;
          }

          const [byKey]: PaymentRow[] =
            await tx`SELECT * FROM payments WHERE idempotency_key = ${key}`;
          if (byKey && byKey.order_id === orderId) return byKey; // rejeu : même réponse
          if (byKey) {
            throw new ApiError(
              409,
              "IDEMPOTENCY_KEY_REUSED",
              "Cette clé d'idempotence a déjà servi pour une autre commande.",
            );
          }
          throw new ApiError(
            409,
            "ORDER_ALREADY_PAID",
            "Cette commande est déjà payée.",
          );
        });

        return c.json(toPayment(payment), 201);
      },
    ),
  );

  return app;
}
