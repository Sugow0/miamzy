import { beforeEach, describe, expect, test } from "bun:test";
import {
  client,
  createOrder,
  isErrorShape,
  makeWorld,
  resetDb,
  type World,
} from "./helpers";

const call = client();
const UNKNOWN = "00000000-0000-7000-8000-000000000000";
let w: World;

describe("erreurs qui disent la vérité (étape 2) et 404", () => {
  beforeEach(async () => {
    await resetDb();
    w = await makeWorld();
  });

  test("commande inconnue : 404, code stable, message lisible", async () => {
    const res = await call(`/v1/orders/${UNKNOWN}`);
    expect(res.status).toBe(404);
    expect(isErrorShape(res.body)).toBe(true);
    expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
    expect(res.body.error.message.length).toBeGreaterThan(10);
  });

  test("utilisateur inconnu et route inconnue : 404 avec la même forme", async () => {
    const user = await call(`/v1/users/${UNKNOWN}`);
    const route = await call("/v1/n-existe-pas");
    expect(user.status).toBe(404);
    expect(route.status).toBe(404);
    expect(route.body.error.code).toBe("ROUTE_NOT_FOUND");
    expect(isErrorShape(user.body) && isErrorShape(route.body)).toBe(true);
  });

  test("JSON illisible ou corps vide : 400, jamais une 500", async () => {
    for (const raw of ['{"userId": ', "", "pas du json", "[1,2"]) {
      const res = await call("/v1/orders", {
        raw,
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_JSON");
      expect(isErrorShape(res.body)).toBe(true);
    }
  });

  test("panier vide : 422 qui dit ce qu'il faut corriger", async () => {
    const res = await createOrder(call, w, { items: [] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("EMPTY_CART");
    expect(res.body.error.details[0].field).toBe("items");
  });

  test("mauvais type, champ inconnu, prix imposé par le client : 422 avec le champ en cause", async () => {
    const wrongType = await createOrder(call, w, {
      items: [{ dishId: w.dishA.id, quantity: "deux" as never }],
    });
    expect(wrongType.status).toBe(422);
    expect(wrongType.body.error.details[0]).toEqual({
      field: "items.0.quantity",
      issue: "doit être un nombre entier",
    });

    const forcedPrice = await call("/v1/orders", {
      json: {
        userId: w.userId,
        restaurantId: w.restaurantId,
        items: [{ dishId: w.dishA.id, quantity: 1, unitPriceCents: 1 }],
      },
    });
    expect(forcedPrice.status).toBe(422);
    expect(forcedPrice.body.error.details[0].field).toBe(
      "items.0.unitPriceCents",
    );
  });

  test("identifiant mal formé : 400 (pas 404, pas 500)", async () => {
    const res = await call("/v1/orders/pas-un-uuid");
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe("id");
  });

  test("règles métier : plat inconnu 404, plat d'un autre restaurant 422, plat en double 422", async () => {
    const unknown = await createOrder(call, w, {
      items: [{ dishId: UNKNOWN, quantity: 1 }],
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("DISH_NOT_FOUND");

    const duplicate = await createOrder(call, w, {
      items: [
        { dishId: w.dishA.id, quantity: 1 },
        { dishId: w.dishA.id, quantity: 1 },
      ],
    });
    expect(duplicate.status).toBe(422);
    expect(duplicate.body.error.code).toBe("DUPLICATE_DISH");
  });

  test("toutes ces erreurs ont exactement la même forme", async () => {
    const all = await Promise.all([
      call(`/v1/orders/${UNKNOWN}`),
      call("/v1/orders/x"),
      call("/v1/zzz"),
      call("/v1/orders", {
        raw: "{",
        headers: { "content-type": "application/json" },
      }),
      createOrder(call, w, { items: [] }),
      call("/v1/orders?limit=100000"),
    ]);
    for (const r of all) expect(isErrorShape(r.body)).toBe(true);
  });
});
