// Lazy database handle. Nothing connects until getDb() is first called, so a build or a
// panel with login off never needs DATABASE_URL. (The `server-only` package is not
// installed, so this file is not marked with it; only import it from server code.)
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

let db: ReturnType<typeof makeDb> | undefined;

function makeDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in (see README, "Login and database").');
  }
  return drizzle(new Pool({ connectionString: url }), { schema });
}

export function getDb() {
  return (db ??= makeDb());
}
