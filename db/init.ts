import { openDb, DB_PATH } from '../lib/db.ts';
const db = openDb();
db.close();
console.log(`db ready: ${DB_PATH}`);
