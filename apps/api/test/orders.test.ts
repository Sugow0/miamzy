import { beforeEach, describe, expect, test } from "bun:test";
import {
  client,
  createOrder,
  makeWorld,
  resetDb,
  sql,
  type World,
} from "./helpers";

const call = client();
let w: World;

describe("création et lecture d'une commande (étape 1)", () => {
  beforeEach(async () => {
    await resetDb();
    w = await makeWorld();
  });

  test("201, en-tête Location, total calculé par le serveur, lignes figées", async () => {
    const res = await createOrder(call, w);
    expect(res.status).toBe(201);
    expect(res.headers.get("location")).toBe(`/v1/orders/${res.body.id}`);
    expect(res.body.status).toBe("pending");
    expect(res.body.totalCents).toBe(2 * 1000 + 450);
    expect(res.body.items).toEqual([
      { dishId: w.dishA.id, name: "Plat A", quantity: 2, unitPriceCents: 1000 },
      { dishId: w.dishB.id, name: "Plat B", quantity: 1, unitPriceCents: 450 },
    ]);
  });

  test("changer le prix d'un plat ne modifie pas les commandes déjà passées", async () => {
    const res = await createOrder(call, w);
    await sql`UPDATE dishes SET price_cents = 9999 WHERE id = ${w.dishA.id}`;
    const reread = await call(`/v1/orders/${res.body.id}`);
    expect(reread.body.totalCents).toBe(2450);
    expect(reread.body.items[0].unitPriceCents).toBe(1000);
  });

  test("la commande créée se relit à l'identique par son identifiant", async () => {
    const created = await createOrder(call, w);
    const read = await call(`/v1/orders/${created.body.id}`);
    expect(read.status).toBe(200);
    expect(read.text).toBe(created.text);
  });

  test("un plat d'un autre restaurant est refusé et rien n'est écrit", async () => {
    const [other] =
      await sql`INSERT INTO restaurants (name) VALUES ('Autre') RETURNING id`;
    const [foreign] =
      await sql`INSERT INTO dishes (restaurant_id, name, price_cents) VALUES (${other.id}, 'Étranger', 100) RETURNING id`;
    const res = await createOrder(call, w, {
      items: [{ dishId: foreign.id, quantity: 1 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("DISH_NOT_IN_RESTAURANT");
    expect(await sql`SELECT 1 FROM orders`).toHaveLength(0);
  });
});
