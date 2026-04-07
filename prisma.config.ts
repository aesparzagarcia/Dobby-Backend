import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7+ deprecates package.json#prisma; seed and paths live here.
 * @see https://pris.ly/prisma-config
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
