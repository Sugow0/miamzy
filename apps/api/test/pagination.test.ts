import { beforeEach, describe, expect, test } from "bun:test";
import { client, makeWorld, resetDb, sql, type World } from "./helpers";

const call = client();
let w: World;

const insertOrders = (n: number) => sql`
  INSERT INTO orders (user_id, restaurant_id, total_cents)
  SELECT ${w.userId}, ${w.restaurantId}, 0 FROM generate_series(1, ${n})`;

describe("liste plafonnée (étape 3)", () => {
  beforeEach(async () => {
    await resetDb();
    w = await makeWorld();
    await insertOrders(150);
  });

  test("sans paramètre : une page de 20, pas les 150 commandes", async () => {
    const res = await call("/v1/orders");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(20);
    expect(res.body.nextCursor).not.toBeNull();
  });

  test("limit=100 (le maximum) renvoie exactement 100 lignes", async () => {
    const res = await call("/v1/orders?limit=100");
    expect(res.body.data).toHaveLength(100);
  });

  test("limit=101 et limit=100000 sont refusés : jamais plus de 100, et aucune donnée", async () => {
    for (const limit of ["101", "100000", "0", "-5", "abc"]) {
      const res = await call(`/v1/orders?limit=${limit}`);
      expect(res.status).toBe(400);
      expect(res.body.data).toBeUndefined();
      expect(res.body.error.details[0].field).toBe("limit");
    }
  });

  test("les pages se suivent sans doublon ni trou, du plus récent au plus ancien", async () => {
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await call(
        `/v1/orders?limit=40${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(res.body.data.length).toBeLessThanOrEqual(40);
      ids.push(...res.body.data.map((o: { id: string }) => o.id));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor);

    expect(pages).toBe(4); // 40 + 40 + 40 + 30
    expect(ids).toHaveLength(150);
    expect(new Set(ids).size).toBe(150);
    expect(ids).toEqual([...ids].sort().reverse()); // UUIDv7 : l'ordre des id est l'ordre du temps
  });

  test("le curseur est stable : une commande créée entre deux pages ne décale rien", async () => {
    const first = await call("/v1/orders?limit=50");
    await insertOrders(10); // des commandes plus récentes arrivent pendant la lecture
    const second = await call(
      `/v1/orders?limit=50&cursor=${first.body.nextCursor}`,
    );

    const firstIds = first.body.data.map((o: { id: string }) => o.id);
    const secondIds = second.body.data.map((o: { id: string }) => o.id);
    expect(secondIds.filter((id: string) => firstIds.includes(id))).toEqual([]); // 0 doublon
    expect(secondIds).toHaveLength(50);
  });

  test("un curseur invalide est refusé (pas d'erreur 500)", async () => {
    const res = await call("/v1/orders?cursor=n-importe-quoi");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CURSOR");
  });
});
