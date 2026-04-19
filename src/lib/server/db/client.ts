import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getAppPaths } from "$lib/server/settings/config";

let database: Database.Database | null = null;

export function getDatabase() {
  if (!database) {
    const { dbPath } = getAppPaths();
    database = new Database(dbPath);
    database.pragma("journal_mode = WAL");
  }

  return database;
}

export function getDb() {
  return drizzle(getDatabase());
}

export function nowIso() {
  return new Date().toISOString();
}

export function makeId() {
  return crypto.randomUUID();
}

export function hashText(value: string) {
  return createHash("sha1").update(value).digest("hex");
}

export function resetDatabaseForTests() {
  if (database) {
    database.close();
    database = null;
  }
}
