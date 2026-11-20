import { type Server, SQL } from "bun";
import { createApp } from "./app";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquant (voir .env.example).");
  process.exit(1);
}

const app = createApp(new SQL(url));

export default {
  port: Number(process.env.PORT ?? 3000),
  // `server` donne accès à l'IP de la connexion (clé du limiteur).
  fetch: (request: Request, server: Server<unknown>) =>
    app.fetch(request, { server }),
};
