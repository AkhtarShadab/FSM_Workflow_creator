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
      "@fsm/grpc-bridge": path.resolve(
        __dirname,
        "../../packages/grpc-bridge/src/index.ts"
      ),
      "@fsm/proto": path.resolve(
        __dirname,
        "../../packages/proto/src/index.ts"
      ),
    },
  },
});
