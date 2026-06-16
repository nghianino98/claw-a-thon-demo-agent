import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { runMigrations } from "@/lib/migrations";

type DidiGlobal = typeof globalThis & {
  __didiDb?: Database.Database;
};

function stateDir() {
  return process.env.STATE_DIR || path.join(process.cwd(), "data");
}

export function getDb() {
  const globalRef = globalThis as DidiGlobal;
  if (!globalRef.__didiDb) {
    fs.mkdirSync(stateDir(), { recursive: true });
    const db = new Database(path.join(stateDir(), "didi.sqlite3"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    globalRef.__didiDb = db;
  }
  return globalRef.__didiDb;
}
