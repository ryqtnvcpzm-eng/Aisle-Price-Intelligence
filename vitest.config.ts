import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

const alias = {
  "@": path.resolve(__dirname, "src"),
  "server-only": path.resolve(__dirname, "tests/support/empty.ts"),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: { name: "components", include: ["tests/unit/**/*.test.tsx"], environment: "jsdom", setupFiles: ["tests/support/jsdom-setup.ts"] },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/support/db-setup.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          env: {
            DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/aisle_test",
            REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
            DATA_PROVIDER: "demo",
            LOG_LEVEL: "silent",
          },
        },
      },
    ],
  },
});
