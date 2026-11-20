import { beforeEach, describe, expect, test } from "bun:test";
import {
  client,
  createOrder,
  makeWorld,
  resetDb,
  SECRETS,
  type World,
} from "./helpers";

const call = client();
let w: World;

describe("profil sans fuite (étape 5)", () => {
  beforeEach(async () => {
    await resetDb();
    w = await makeWorld();
  });

  test("le profil n'expose que id, firstName et createdAt", async () => {
    const res = await call(`/v1/users/${w.userId}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      "createdAt",
      "firstName",
      "id",
    ]);
    expect(res.body.firstName).toBe("Léa");
  });

  test("ni l'e-mail, ni le téléphone, ni le hash n'apparaissent dans AUCUNE réponse", async () => {
    const created = await createOrder(call, w);
    const orderId = created.body.id;
    await call(`/v1/orders/${orderId}/payments`, {
      json: { method: "card" },
      headers: { "idempotency-key": "cle-profil-0001" },
    });

    const everything = [
      created.text,
      (await call(`/v1/users/${w.userId}`)).text,
      (await call(`/v1/orders/${orderId}`)).text,
      (await call("/v1/orders?limit=100")).text,
      (await call(`/v1/orders?userId=${w.userId}`)).text,
    ].join("\n");

    for (const secret of Object.values(SECRETS))
      expect(everything).not.toContain(secret);
    for (const key of [
      "email",
      "phone",
      "password",
      "passwordHash",
      "password_hash",
    ]) {
      expect(everything).not.toContain(`"${key}"`);
    }
    // témoin positif : le détecteur n'est pas muet, le prénom (exposé) est bien trouvé
    expect(everything).toContain("Léa");
  });

  test("une commande ne porte que l'identifiant de l'utilisateur, jamais l'objet complet", async () => {
    const { body } = await createOrder(call, w);
    expect(body.userId).toBe(w.userId);
    expect(body.user).toBeUndefined();
  });

  test("le garde-fou du contrat refuse un champ en trop dans le profil", async () => {
    const { checkResponse } = await import("../src/contract");
    const leaky = {
      id: w.userId,
      firstName: "Léa",
      createdAt: "2026-01-01T00:00:00Z",
      email: SECRETS.email,
    };
    const problems = checkResponse("getUser", 200, leaky);
    expect(problems).not.toBeNull();
    expect(problems?.[0]?.field).toBe("email");
  });
});
