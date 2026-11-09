// 统一开库:所有脚本经此拿 db 连接(中文路径需 fileURLToPath 解码)
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import "./env.ts";
import { migrate } from "../db/migrate.ts";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const configuredPath = process.env.EVERYONE_CONTENT_DB_PATH;
const defaultPath = fileURLToPath(new URL("../db/everyone-content.db", import.meta.url));
export const DB_PATH = configuredPath ? resolve(configuredPath)
  : defaultPath;

export function openDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=OFF");
  try {
    migrate(db, DB_PATH);
    db.exec("PRAGMA foreign_keys=ON");
    return db;
  } catch (e) { db.close(); throw e; }
}
