import { defineConfig } from "drizzle-kit";

export default defineConfig({
    dialect: "mysql",
    schema: "./src/lib/db/schema.ts",
    out: "./migrations",
    dbCredentials: {
        // Used for introspection/push; `generate` only needs the schema.
        url:
            process.env.DATABASE_URL ??
            "mysql://elimination:elimination@localhost:3306/elimination",
    },
});
