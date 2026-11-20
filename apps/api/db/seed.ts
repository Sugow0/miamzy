import { SQL } from "bun";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquant (voir .env.example).");
  process.exit(1);
}

// Le seed vide les tables : on refuse tout ce qui n'est pas une base locale.
const host = new URL(url).hostname;
if (host !== "localhost" && host !== "127.0.0.1") {
  console.error(
    `Refus : le seed vide les tables, et "${host}" n'est pas local.`,
  );
  process.exit(1);
}

const sql = new SQL(url);
try {
  const script = await Bun.file(new URL("./seed.sql", import.meta.url)).text();
  await sql.unsafe(script);

  const [counts] = await sql`
    SELECT (SELECT count(*) FROM restaurants)::int AS restaurants,
           (SELECT count(*) FROM dishes)::int      AS dishes,
           (SELECT count(*) FROM users)::int       AS users,
           (SELECT count(*) FROM orders)::int      AS orders,
           (SELECT count(*) FROM order_items)::int AS order_items,
           (SELECT count(*) FROM payments)::int    AS payments`;
  console.table(counts);
} finally {
  await sql.close();
}
