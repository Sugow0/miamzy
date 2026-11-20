// Exécuté UNE fois avant tous les tests. Les tests vident les tables : on refuse
// donc catégoriquement de tourner sur autre chose qu'une base locale « *_test ».

import { SQL } from "bun";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error(
    "TEST_DATABASE_URL manquant (voir .env.example). Lancez `bun run test` depuis la racine ou apps/api.",
  );
}
const url = new URL(testUrl);
const dbName = url.pathname.slice(1);

if (!dbName.endsWith("_test")) {
  throw new Error(
    `Refus : "${dbName}" ne finit pas par _test. Les tests vident les tables.`,
  );
}
if (testUrl === process.env.DATABASE_URL) {
  throw new Error("Refus : TEST_DATABASE_URL est identique à DATABASE_URL.");
}
if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
  throw new Error(`Refus : l'hôte "${url.hostname}" n'est pas local.`);
}

// 1. Créer la base de test si elle n'existe pas (on passe par la base « postgres »).
const adminUrl = new URL(testUrl);
adminUrl.pathname = "/postgres";
const admin = new SQL(adminUrl.toString());
try {
  const found =
    await admin`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
  if (found.length === 0) await admin.unsafe(`CREATE DATABASE "${dbName}"`);
} finally {
  await admin.close();
}

// 2. Appliquer les migrations (les mêmes que la base de développement).
const migrate = Bun.spawnSync(["bunx", "prisma", "migrate", "deploy"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: testUrl },
});
if (migrate.exitCode !== 0) {
  throw new Error(
    `Échec des migrations de test :\n${migrate.stderr.toString()}${migrate.stdout.toString()}`,
  );
}

// 3. Toute réponse qui s'écarte du contrat devient une 500 : les tests la voient.
//    (VALIDATE_RESPONSES=false le désactive : utile pour vérifier que les tests détectent seuls.)
process.env.VALIDATE_RESPONSES ??= "true";
