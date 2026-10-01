import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "app/**/*.test.tsx"],
    exclude: ["node_modules", "vendor", "contracts", ".next", "lib/long-running-app-harness/**"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
