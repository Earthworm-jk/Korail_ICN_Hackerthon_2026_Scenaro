import { describe, expect, it } from "vitest";

import { parseCommand } from "@/lib/itinerary-command-fallback";
import { messages } from "@/lib/i18n/messages";

/**
 * 채우기 버튼이 보내는 문장 (#171).
 *
 * 버튼은 자연어 문장을 만들어 기존 명령 경로로 보낸다 — 새 명령 타입을 만들지 않으려는
 * 선택이다. 그래서 **그 문장이 파서를 통과하는지가 곧 버튼의 계약**이다. 문구를 손보다
 * 패턴에서 벗어나면 버튼이 조용히 "못 알아들었다"를 돌려준다.
 *
 * 키가 없는 환경(폴백 파서)에서도 되어야 한다 — 발표장에서 네트워크가 끊겨도 눌린다.
 */
describe("채우기 버튼 문장", () => {
  it("두 로케일 모두 동선 추천 명령으로 읽힌다", () => {
    for (const locale of ["ko", "en"] as const) {
      for (const day of [1, 2, 3]) {
        const sentence = messages[locale]["ai.fillPrompt"].replace("{day}", String(day));
        expect(parseCommand(sentence), `${locale}: ${sentence}`)
          .toEqual({ intent: "recommend_along_route", dayIndex: day });
      }
    }
  });

  it("자리표시자가 남아 있다 — 치환을 빠뜨리면 날짜를 못 읽는다", () => {
    for (const locale of ["ko", "en"] as const) {
      expect(messages[locale]["ai.fillPrompt"]).toContain("{day}");
      expect(messages[locale]["ai.fillDay"]).toContain("{day}");
    }
  });
});
