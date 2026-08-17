import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      PLATFORM_SECRET: "test-platform-secret-for-vitest",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./src/test/server-only-stub.ts"),
      "@fsm/byok-gateway": path.resolve(
        __dirname,
        "../../packages/byok-gateway/src/index.ts"
      ),
      "@fsm/engine": path.resolve(
        __dirname,
        "../../packages/fsm-engine/src/index.ts"
      ),
    },
  },
});
