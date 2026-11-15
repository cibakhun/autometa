import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    projects: [
      { extends: true, test: { name: "unit", include: ["src/**/*.test.ts"] } },
      // Integration tests share one database and reset it, so their files run one after another.
      { extends: true, test: { name: "integration", include: ["tests/**/*.test.ts"], fileParallelism: false } },
    ],
  },
});
