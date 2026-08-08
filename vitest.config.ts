import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Next 빌드에서는 실제 server-only 경계를 사용하고, Node 기반 단위 테스트에서만 빈 모듈로 대체한다.
    alias: {
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
