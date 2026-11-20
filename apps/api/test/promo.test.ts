import { beforeEach, describe, expect, test } from "bun:test";
import { discountFor } from "../src/pricing";
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

/** Les 8 clés d'une commande dans le contrat 1.0.0 : sans code promo, rien d'autre. */
const V1_KEYS = [
  "createdAt",
  "currency",
  "id",
  "items",
  "restaurantId",
  "status",
  "totalCents",
  "userId",
];

describe("codes promo, évolution sans casse (étape 7)", () => {
  beforeEach(async () => {
    await resetDb();
    w = await makeWorld();
    await sql`INSERT INTO promo_codes (code, percent_off) VALUES ('BIENVENUE10', 10)`;
    await sql`INSERT INTO promo_codes (code, percent_off, expires_at) VALUES ('EXPIRE5', 5, now() - interval '1 day')`;
    await sql`INSERT INTO promo_codes (code, percent_off, active) VALUES ('INACTIF15', 15, false)`;
  });

  test("sans code promo : la réponse a EXACTEMENT les clés de la 1.0.0", async () => {
    const res = await createOrder(call, w);
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(V1_KEYS);
    expect(res.body.totalCents).toBe(2450);
    const [row] =
      await sql`SELECT promo_code, discount_cents FROM orders WHERE id = ${res.body.id}`;
    expect(row).toEqual({ promo_code: null, discount_cents: 0 });
  });

  test("avec un code : le total en tient compte, la remise est figée en base", async () => {
    const res = await createOrder(call, w, { promoCode: "BIENVENUE10" });
    expect(res.status).toBe(201);
    expect(res.body.discountCents).toBe(245);
    expect(res.body.totalCents).toBe(2450 - 245);
    expect(res.body.promoCode).toBe("BIENVENUE10");

    await sql`UPDATE promo_codes SET percent_off = 50 WHERE code = 'BIENVENUE10'`;
    const reread = await call(`/v1/orders/${res.body.id}`);
    expect(reread.body.totalCents).toBe(2205); // changer le code ne réécrit pas le passé
  });

  test("inconnu, expiré, désactivé : trois codes, la MÊME réponse (on ne révèle pas les codes)", async () => {
    const bodies = [];
    for (const promoCode of ["INCONNU99", "EXPIRE5", "INACTIF15"]) {
      const res = await createOrder(call, w, { promoCode });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("PROMO_CODE_INVALID");
      bodies.push(res.text);
    }
    expect(new Set(bodies).size).toBe(1);
    expect(await sql`SELECT 1 FROM orders`).toHaveLength(0); // aucune commande créée
  });

  test("un code en minuscules est refusé par le contrat (format)", async () => {
    const res = await createOrder(call, w, { promoCode: "bienvenue10" });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0]).toEqual({
      field: "promoCode",
      issue: "format invalide",
    });
  });

  test("arrondi à l'entier le plus proche, 0,5 vers le haut, en entiers", () => {
    expect(discountFor(4505, 10)).toBe(451); // 450,5 -> 451
    expect(discountFor(4504, 10)).toBe(450); // 450,4 -> 450
    expect(discountFor(1, 50)).toBe(1); // 0,5 -> 1
    expect(discountFor(1, 49)).toBe(0); // 0,49 -> 0
    expect(discountFor(2450, 10)).toBe(245); // exact
    expect(discountFor(0, 10)).toBe(0);
    expect(discountFor(1999, 100)).toBe(1999); // 100 % = gratuit, pas de total négatif
  });

  test("la base refuse une remise sans code (contrainte CHECK)", async () => {
    const order = (await createOrder(call, w)).body;
    const forceDiscount = async () => {
      await sql`UPDATE orders SET discount_cents = 100 WHERE id = ${order.id}`;
    };
    await expect(forceDiscount()).rejects.toThrow(
      /orders_promo_discount_check/,
    );
    const [row] =
      await sql`SELECT discount_cents FROM orders WHERE id = ${order.id}`;
    expect(row.discount_cents).toBe(0); // la ligne n'a pas bougé
  });
});
