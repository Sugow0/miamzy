import { beforeEach, describe, expect, test } from "bun:test";
import { createRateLimiter } from "../src/rate-limit";
import {
  client,
  countingSql,
  makeApp,
  makeWorld,
  resetDb,
  sql,
  type World,
} from "./helpers";

const config = { capacity: 3, refillPerSec: 1, trustProxy: false };

describe("seau à jetons (unitaire, horloge simulée)", () => {
  test("laisse passer la rafale, puis refuse avec le temps d'attente exact", () => {
    const t = 0;
    const limiter = createRateLimiter({ ...config, now: () => t });
    expect([1, 2, 3].map(() => limiter.consume("a").allowed)).toEqual([
      true,
      true,
      true,
    ]);
    const refused = limiter.consume("a");
    expect(refused).toEqual({ allowed: false, retryAfterSec: 1 });
  });

  test("Retry-After suit le débit : à 0,1 jeton/s, il faut attendre 10 secondes", () => {
    const limiter = createRateLimiter({
      capacity: 1,
      refillPerSec: 0.1,
      trustProxy: false,
      now: () => 0,
    });
    limiter.consume("a");
    expect(limiter.consume("a").retryAfterSec).toBe(10);
  });

  test("le seau se recharge avec le temps, sans dépasser sa capacité", () => {
    let t = 0;
    const limiter = createRateLimiter({ ...config, now: () => t });
    for (let i = 0; i < 3; i++) limiter.consume("a");
    expect(limiter.consume("a").allowed).toBe(false);
    t += 1000;
    expect(limiter.consume("a").allowed).toBe(true); // 1 jeton rendu
    expect(limiter.consume("a").allowed).toBe(false);
    t += 3_600_000; // une heure plus tard : plafonné à 3, pas 3600
    const burst = [1, 2, 3, 4].map(() => limiter.consume("a").allowed);
    expect(burst).toEqual([true, true, true, false]);
  });

  test("deux clients ont chacun leur seau", () => {
    const limiter = createRateLimiter({ ...config, now: () => 0 });
    for (let i = 0; i < 3; i++) limiter.consume("a");
    expect(limiter.consume("a").allowed).toBe(false);
    expect(limiter.consume("b").allowed).toBe(true);
  });

  test("la mémoire est bornée : au plus maxKeys clients suivis", () => {
    const limiter = createRateLimiter({ ...config, maxKeys: 5, now: () => 0 });
    for (let i = 0; i < 50; i++) limiter.consume(`ip-${i}`);
    expect(limiter.size()).toBe(5);
  });
});

describe("limitation de débit sur l'API (étape 6)", () => {
  let w: World;
  beforeEach(async () => {
    await resetDb();
    w = await makeWorld();
  });

  test("au-delà de la limite : 429, Retry-After numérique, même forme d'erreur", async () => {
    const call = client(makeApp({ capacity: 3, refillPerSec: 0.001 }));
    const statuses = [];
    for (let i = 0; i < 5; i++)
      statuses.push(
        (await call(`/v1/users/${w.userId}`, { ip: "1.1.1.1" })).status,
      );
    expect(statuses).toEqual([200, 200, 200, 429, 429]);

    const refused = await call(`/v1/users/${w.userId}`, { ip: "1.1.1.1" });
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThanOrEqual(
      1,
    );
    expect(refused.body.error.code).toBe("RATE_LIMITED");
    expect(refused.body.error.message).toMatch(/Réessayez dans \d+ seconde/);
  });

  test("un second client n'est pas bloqué pendant que le premier l'est", async () => {
    const call = client(makeApp({ capacity: 2, refillPerSec: 0.001 }));
    for (let i = 0; i < 4; i++)
      await call(`/v1/users/${w.userId}`, { ip: "1.1.1.1" });
    expect(
      (await call(`/v1/users/${w.userId}`, { ip: "1.1.1.1" })).status,
    ).toBe(429);
    expect(
      (await call(`/v1/users/${w.userId}`, { ip: "2.2.2.2" })).status,
    ).toBe(200);
  });

  test("une requête refusée ne touche PAS la base", async () => {
    const spy = countingSql(sql);
    const call = client(makeApp({ capacity: 2, refillPerSec: 0.001 }, spy.sql));
    await call(`/v1/users/${w.userId}`, { ip: "3.3.3.3" });
    await call(`/v1/users/${w.userId}`, { ip: "3.3.3.3" });
    const accepted = spy.calls();
    expect(accepted).toBeGreaterThan(0); // témoin : les requêtes acceptées, elles, lisent la base

    for (let i = 0; i < 20; i++) {
      expect(
        (await call(`/v1/users/${w.userId}`, { ip: "3.3.3.3" })).status,
      ).toBe(429);
    }
    expect(spy.calls()).toBe(accepted); // 20 refus, 0 appel de plus
  });

  test("sans TRUST_PROXY, un en-tête X-Forwarded-For forgé ne contourne pas la limite", async () => {
    const call = client(
      makeApp({ capacity: 2, refillPerSec: 0.001, trustProxy: false }),
    );
    const statuses = [];
    for (let i = 0; i < 4; i++)
      statuses.push(
        (await call(`/v1/users/${w.userId}`, { ip: `9.9.9.${i}` })).status,
      );
    expect(statuses).toEqual([200, 200, 429, 429]); // tous comptés comme un seul client
  });
});
