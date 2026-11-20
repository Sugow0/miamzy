import { SQL } from "bun";
import { createApp } from "../src/app";
import type { RateLimitConfig } from "../src/rate-limit";

export const sql = new SQL(process.env.TEST_DATABASE_URL as string);

/** Valeurs sensibles du jeu d'essai : aucune réponse de l'API ne doit les contenir. */
export const SECRETS = {
  email: "lea.secret@example.test",
  phone: "+33611223344",
  hash: "$argon2$secret-hash-value",
};

export async function resetDb() {
  await sql`TRUNCATE payments, order_items, orders, dishes, restaurants, users, promo_codes`;
}

export type World = {
  userId: string;
  restaurantId: string;
  dishA: { id: string; priceCents: number };
  dishB: { id: string; priceCents: number };
};

/** 1 utilisateur (avec des données sensibles), 1 restaurant, 2 plats (10,00 € et 4,50 €). */
export async function makeWorld(): Promise<World> {
  const [user] = await sql`
    INSERT INTO users (first_name, email, phone, password_hash)
    VALUES ('Léa', ${SECRETS.email}, ${SECRETS.phone}, ${SECRETS.hash}) RETURNING id`;
  const [restaurant] =
    await sql`INSERT INTO restaurants (name) VALUES ('Chez Test') RETURNING id`;
  const [a] = await sql`
    INSERT INTO dishes (restaurant_id, name, price_cents) VALUES (${restaurant.id}, 'Plat A', 1000) RETURNING id`;
  const [b] = await sql`
    INSERT INTO dishes (restaurant_id, name, price_cents) VALUES (${restaurant.id}, 'Plat B', 450) RETURNING id`;
  return {
    userId: user.id,
    restaurantId: restaurant.id,
    dishA: { id: a.id, priceCents: 1000 },
    dishB: { id: b.id, priceCents: 450 },
  };
}

/** Application complète, limite de débit très large sauf si le test la resserre. */
export function makeApp(
  rateLimit: Partial<RateLimitConfig> = {},
  db: SQL = sql,
) {
  return createApp(db, {
    rateLimit: {
      capacity: 100_000,
      refillPerSec: 100_000,
      trustProxy: true,
      ...rateLimit,
    },
  });
}

type CallInit = {
  method?: string;
  json?: unknown;
  raw?: string;
  headers?: Record<string, string>;
  ip?: string;
};

export function client(app = makeApp()) {
  return async (path: string, init: CallInit = {}) => {
    const headers: Record<string, string> = { ...init.headers };
    if (init.json !== undefined) headers["content-type"] = "application/json";
    if (init.ip) headers["x-forwarded-for"] = init.ip;
    const hasBody = init.json !== undefined || init.raw !== undefined;
    const res = await app.request(path, {
      method: init.method ?? (hasBody ? "POST" : "GET"),
      headers,
      body:
        init.raw ??
        (init.json !== undefined ? JSON.stringify(init.json) : undefined),
    });
    const text = await res.text();
    return {
      status: res.status,
      headers: res.headers,
      text,
      body: text ? JSON.parse(text) : null,
    };
  };
}

export type Call = ReturnType<typeof client>;

export async function createOrder(
  call: Call,
  w: World,
  options: {
    promoCode?: string;
    items?: { dishId: string; quantity: number }[];
  } = {},
) {
  return call("/v1/orders", {
    json: {
      userId: w.userId,
      restaurantId: w.restaurantId,
      items: options.items ?? [
        { dishId: w.dishA.id, quantity: 2 },
        { dishId: w.dishB.id, quantity: 1 },
      ],
      ...(options.promoCode !== undefined && { promoCode: options.promoCode }),
    },
  });
}

/** Forme exacte d'une erreur : error.code, error.message, error.details, rien d'autre. */
export function isErrorShape(body: unknown): boolean {
  const b = body as { error?: Record<string, unknown> };
  if (!b || typeof b !== "object" || Object.keys(b).join() !== "error")
    return false;
  const keys = Object.keys(b.error ?? {})
    .sort()
    .join();
  return keys === "code,details,message" && Array.isArray(b.error?.details);
}

/** Compte les appels à la base : sert à prouver qu'une requête refusée n'y touche pas. */
export function countingSql(real: SQL) {
  let calls = 0;
  const proxy = new Proxy(real as unknown as (...a: unknown[]) => unknown, {
    apply(target, thisArg, args) {
      calls++;
      return Reflect.apply(target, thisArg, args);
    },
    get(target, prop, receiver) {
      if (prop === "begin") {
        return (...args: unknown[]) => {
          calls++;
          return (target as unknown as SQL).begin(...(args as [never]));
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return { sql: proxy as unknown as SQL, calls: () => calls };
}
