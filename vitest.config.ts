import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Next 빌드에서는 실제 server-only 경계를 사용하고, Node 기반 단위 테스트에서만 빈 모듈로 대체한다.
    alias: {
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
      // tsconfig의 `@/*`와 같은 뿌리. app/ 컴포넌트를 테스트에서 부르려면 필요하다 —
      // 그 파일들이 자기 의존을 `@/lib/...`로 적는다 (PR #122 리뷰 실검증)
      "@": fileURLToPath(new URL("./", import.meta.url)).replace(/\/$/, ""),
    },
  },
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
