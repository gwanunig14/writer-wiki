import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/server/db/schema/*.ts",
  out: "./src/lib/server/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.ACK_DB_PATH ?? "./project-data/author-canon-keeper.sqlite",
  },
});
