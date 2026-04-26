import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }

  if (!dbInstance) {
    const client = postgres(connectionString, {
      prepare: false,
    });

    dbInstance = drizzle(client, { schema });
  }

  return dbInstance;
}

export { schema };
