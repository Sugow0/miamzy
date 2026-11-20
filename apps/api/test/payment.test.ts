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

const pay = (orderId: string, key?: string) =>
  call(`/v1/orders/${orderId}/payments`, {
    json: { method: "card" },
    headers: key ? { "idempotency-key": key } : {},
  });
const paymentRows = (orderId: string) =>
  sql`SELECT * FROM payments WHERE order_id = ${orderId}`;

describe("double paiement (étape 4)", () => {
  beforeEach(async () => {
    await resetDb();
    w = await makeWorld();
  });

  test("la même clé envoyée 3 fois : 1 seul paiement en base, 3 réponses identiques", async () => {
    const order = (await createOrder(call, w)).body;
    const responses = [];
    for (let i = 0; i < 3; i++)
      responses.push(await pay(order.id, "cle-de-test-0001"));

    expect(responses.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(new Set(responses.map((r) => r.text)).size).toBe(1); // identiques au caractère près
    expect(await paymentRows(order.id)).toHaveLength(1);
    expect(responses[0]?.body.amountCents).toBe(2450); // 2 x 10,00 + 4,50, pris dans la commande
    const [after] = await sql`SELECT status FROM orders WHERE id = ${order.id}`;
    expect(after.status).toBe("paid");
  });

  test("5 envois SIMULTANÉS avec la même clé : 1 seul paiement", async () => {
    const order = (await createOrder(call, w)).body;
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => pay(order.id, "cle-simultanee-01")),
    );
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(responses.map((r) => r.text)).size).toBe(1);
    expect(await paymentRows(order.id)).toHaveLength(1);
  });

  test("une autre clé sur une commande déjà payée est refusée : jamais un deuxième débit", async () => {
    const order = (await createOrder(call, w)).body;
    await pay(order.id, "premiere-cle-01");
    const second = await pay(order.id, "deuxieme-cle-02");
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("ORDER_ALREADY_PAID");
    expect(await paymentRows(order.id)).toHaveLength(1);
  });

  test("5 clés différentes en parallèle sur la même commande : un seul paiement gagne", async () => {
    const order = (await createOrder(call, w)).body;
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) => pay(order.id, `cle-parallele-0${i}`)),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([
      201, 409, 409, 409, 409,
    ]);
    expect(await paymentRows(order.id)).toHaveLength(1);
  });

  test("une clé différente pour une AUTRE commande crée un nouveau paiement", async () => {
    const a = (await createOrder(call, w)).body;
    const b = (await createOrder(call, w)).body;
    expect((await pay(a.id, "cle-commande-aaa")).status).toBe(201);
    expect((await pay(b.id, "cle-commande-bbb")).status).toBe(201);
    expect(await sql`SELECT 1 FROM payments`).toHaveLength(2);
  });

  test("une clé déjà utilisée pour une autre commande est refusée", async () => {
    const a = (await createOrder(call, w)).body;
    const b = (await createOrder(call, w)).body;
    await pay(a.id, "cle-partagee-001");
    const reuse = await pay(b.id, "cle-partagee-001");
    expect(reuse.status).toBe(409);
    expect(reuse.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await paymentRows(b.id)).toHaveLength(0);
  });

  test("sans clé : refusé avec un message qui nomme l'en-tête, rien n'est écrit", async () => {
    const order = (await createOrder(call, w)).body;
    const res = await pay(order.id);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_HEADER");
    expect(res.body.error.message).toContain("Idempotency-Key");
    expect(await paymentRows(order.id)).toHaveLength(0);
  });
});
