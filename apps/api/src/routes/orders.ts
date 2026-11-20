import type { SQL } from "bun";
import { Hono } from "hono";
import type { components } from "../api";
import { ApiError, notFound } from "../errors";
import { type Env, operation, readBody } from "../http";
import { discountFor } from "../pricing";

type Order = components["schemas"]["Order"];
type OrderItem = components["schemas"]["OrderItem"];
type OrderPage = components["schemas"]["OrderPage"];
type CreateOrderRequest = components["schemas"]["CreateOrderRequest"];

type OrderRow = {
  id: string;
  user_id: string;
  restaurant_id: string;
  status: Order["status"];
  total_cents: number;
  discount_cents: number;
  promo_code: string | null;
  currency: string;
  created_at: Date;
};
type ItemRow = {
  order_id: string;
  dish_id: string;
  name: string;
  quantity: number;
  unit_price_cents: number;
};
type DishRow = {
  id: string;
  restaurant_id: string;
  name: string;
  price_cents: number;
  currency: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Le curseur est opaque pour le client : il n'a pas à savoir que c'est un id.
const encodeCursor = (id: string) => Buffer.from(id).toString("base64url");
function decodeCursor(cursor: string): string {
  const id = Buffer.from(cursor, "base64url").toString();
  if (!UUID.test(id)) {
    throw new ApiError(400, "INVALID_CURSOR", "Le curseur est invalide.", [
      {
        field: "cursor",
        issue: "utilisez la valeur nextCursor de la page précédente",
      },
    ]);
  }
  return id;
}

function toOrder(row: OrderRow, items: ItemRow[]): Order {
  return {
    id: row.id,
    userId: row.user_id,
    restaurantId: row.restaurant_id,
    status: row.status,
    items: items.map(
      (i): OrderItem => ({
        dishId: i.dish_id,
        name: i.name,
        quantity: i.quantity,
        unitPriceCents: i.unit_price_cents,
      }),
    ),
    totalCents: row.total_cents,
    discountCents: row.discount_cents,
    promoCode: row.promo_code,
    currency: row.currency,
    createdAt: row.created_at.toISOString(),
  };
}

/** Une seule requête pour les lignes de toutes les commandes de la page (pas de N+1). */
async function withItems(sql: SQL, rows: OrderRow[]): Promise<Order[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const items: ItemRow[] = await sql`
    SELECT order_id, dish_id, name, quantity, unit_price_cents
    FROM order_items
    WHERE order_id IN ${sql(ids)}
    ORDER BY id`;
  const byOrder = Map.groupBy(items, (i) => i.order_id);
  return rows.map((r) => toOrder(r, byOrder.get(r.id) ?? []));
}

export async function fetchOrder(sql: SQL, id: string): Promise<Order | null> {
  const rows: OrderRow[] = await sql`
    SELECT id, user_id, restaurant_id, status, total_cents, discount_cents, promo_code, currency, created_at
    FROM orders WHERE id = ${id}`;
  return (await withItems(sql, rows))[0] ?? null;
}

export function ordersRoutes(sql: SQL) {
  const app = new Hono<Env>();

  app.get(
    "/",
    operation<{ limit: number; cursor?: string; userId?: string }>(
      "listOrders",
      async (c, params) => {
        const { limit, userId } = params;
        const after = params.cursor ? decodeCursor(params.cursor) : null;
        // On lit limit + 1 lignes : la ligne en trop dit s'il existe une page suivante.
        const rows: OrderRow[] = await sql`
          SELECT id, user_id, restaurant_id, status, total_cents, discount_cents, promo_code, currency, created_at
          FROM orders
          WHERE true
          ${after ? sql`AND id < ${after}` : sql``}
          ${userId ? sql`AND user_id = ${userId}` : sql``}
          ORDER BY id DESC
          LIMIT ${limit + 1}`;
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const last = page.at(-1);
        const body: OrderPage = {
          data: await withItems(sql, page),
          nextCursor: hasMore && last ? encodeCursor(last.id) : null,
        };
        return c.json(body, 200);
      },
    ),
  );

  app.get(
    "/:id",
    operation<{ id: string }>("getOrder", async (c, { id }) => {
      const order = await fetchOrder(sql, id);
      if (!order) {
        throw notFound(
          "ORDER_NOT_FOUND",
          "Aucune commande ne porte cet identifiant.",
        );
      }
      return c.json(order, 200);
    }),
  );

  app.post(
    "/",
    operation("createOrder", async (c) => {
      const body = await readBody<CreateOrderRequest>(c, "createOrder");

      const [user] = await sql`SELECT id FROM users WHERE id = ${body.userId}`;
      if (!user)
        throw notFound(
          "USER_NOT_FOUND",
          "Aucun utilisateur ne porte cet identifiant.",
        );
      const [restaurant] =
        await sql`SELECT id FROM restaurants WHERE id = ${body.restaurantId}`;
      if (!restaurant) {
        throw notFound(
          "RESTAURANT_NOT_FOUND",
          "Aucun restaurant ne porte cet identifiant.",
        );
      }

      const dishIds = body.items.map((i) => i.dishId);
      if (new Set(dishIds).size !== dishIds.length) {
        throw new ApiError(
          422,
          "DUPLICATE_DISH",
          "Un même plat apparaît plusieurs fois : regroupez-le en augmentant 'quantity'.",
          [{ field: "items", issue: "dishId en double" }],
        );
      }

      const dishes: DishRow[] = await sql`
        SELECT id, restaurant_id, name, price_cents, currency
        FROM dishes WHERE id IN ${sql(dishIds)}`;
      const dishById = new Map(dishes.map((d) => [d.id, d]));
      body.items.forEach((item, index) => {
        const dish = dishById.get(item.dishId);
        if (!dish) {
          throw new ApiError(
            404,
            "DISH_NOT_FOUND",
            "Un plat de la commande n'existe pas.",
            [{ field: `items.${index}.dishId`, issue: "plat inconnu" }],
          );
        }
        if (dish.restaurant_id !== body.restaurantId) {
          throw new ApiError(
            422,
            "DISH_NOT_IN_RESTAURANT",
            "Un plat de la commande n'appartient pas à ce restaurant.",
            [
              {
                field: `items.${index}.dishId`,
                issue: "plat d'un autre restaurant",
              },
            ],
          );
        }
      });

      // Le prix vient de la base, jamais du client.
      const lines = body.items.map((item) => {
        const dish = dishById.get(item.dishId) as DishRow;
        return { dish, quantity: item.quantity };
      });
      const currencies = new Set(lines.map((l) => l.dish.currency));
      if (currencies.size > 1) {
        throw new ApiError(
          422,
          "MIXED_CURRENCIES",
          "Les plats n'ont pas tous la même devise.",
        );
      }
      const currency = lines[0]?.dish.currency as string;
      const subtotalCents = lines.reduce(
        (sum, l) => sum + l.dish.price_cents * l.quantity,
        0,
      );

      // Code promo (contrat 1.1.0) : optionnel. Sans lui, rien ne change par rapport à 1.0.0.
      let promoCode: string | null = null;
      let discountCents = 0;
      if (body.promoCode !== undefined) {
        const [promo] = await sql`
          SELECT code, percent_off FROM promo_codes
          WHERE code = ${body.promoCode} AND active
            AND (expires_at IS NULL OR expires_at > now())`;
        // Inconnu, désactivé, expiré : même réponse, pour ne pas révéler quels codes existent.
        if (!promo) {
          throw new ApiError(
            422,
            "PROMO_CODE_INVALID",
            "Ce code promo n'est pas valable : vérifiez le code saisi.",
            [
              {
                field: "promoCode",
                issue: "code inconnu, désactivé ou expiré",
              },
            ],
          );
        }
        promoCode = promo.code;
        discountCents = discountFor(subtotalCents, promo.percent_off);
      }
      const totalCents = subtotalCents - discountCents;

      const orderId = await sql.begin(async (tx) => {
        const [created] = await tx`
          INSERT INTO orders (user_id, restaurant_id, total_cents, discount_cents, promo_code, currency)
          VALUES (${body.userId}, ${body.restaurantId}, ${totalCents}, ${discountCents}, ${promoCode}, ${currency})
          RETURNING id`;
        const rows = lines.map((l) => ({
          order_id: created.id,
          dish_id: l.dish.id,
          name: l.dish.name,
          quantity: l.quantity,
          unit_price_cents: l.dish.price_cents,
        }));
        await tx`INSERT INTO order_items ${tx(rows)}`;
        return created.id as string;
      });

      const order = (await fetchOrder(sql, orderId)) as Order;
      c.header("Location", `/v1/orders/${order.id}`);
      return c.json(order, 201);
    }),
  );

  return app;
}
