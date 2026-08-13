# 촬영지 대표성 제안·승인 파이프라인 (#208)

## 목적

촬영지의 일반 인기도와 특정 작품에서의 대표성은 다르다. 이 파이프라인은 검증된 작품–장소
근거를 OpenAI가 먼저 구조화해 등급을 제안하게 하되, AI의 기억이나 제안이 일정에 직접 영향을
주지 못하게 한다.

## 처리 순서

1. `works.json`, `places.json`, `work-place-relations.json`에서 검토 완료된 장면 설명, 장소 추천
   사유, 관계 출처만 추출한다.
2. `scripts/build_place_representativeness.py`가 작품–장소 관계 42건(고유 장소 36곳)을 OpenAI
   Responses API에 전달한다. 장소가 여러 작품에 쓰일 수 있으므로 판정 단위는 장소가 아니라
   작품–장소 관계다.
3. Structured Outputs의 엄격한 JSON Schema로 `iconic | major | standard | insufficient` 등급,
   신뢰도, 근거 URL, 요약과 판단 사유를 받는다.
4. 로컬 규칙 검증기가 관계 전수 포함, 중복 없음, 근거 URL의 관계 출처 부분집합 여부,
   `requiresHumanReview: true`, 현재 입력 SHA-256을 검사한다.
5. 검증된 결과를 `data/place-representativeness-proposals.json`에 제안 스냅샷으로 고정한다.
6. 사람이 제안을 확인하고 승인한 `iconic`만 `work-place-relations.json`의
   `representativeness`로 승격한다. `openai_assisted` 승인에는 모델, 생성시각, 입력 digest,
   승인자와 승인일을 모두 기록한다.
7. 일정 엔진은 관계 시드의 승인 값만 읽는다. OpenAI API는 사용자 요청이나 일정 생성·변경 때
   호출되지 않는다.

## 등급 의미

- `iconic`: 제공된 근거가 해당 작품의 대표적·상징적·유명한 장면 또는 장소임을 명시한다.
- `major`: 서사적으로 중요한 장면이지만 대표성을 단정할 근거는 부족하다.
- `standard`: 촬영 관계는 검증됐으나 일반적인 촬영지다.
- `insufficient`: 제공된 검증 텍스트만으로 등급을 제안하기 어렵다.

일반 관광 인기도나 공식 출처 개수만으로 `iconic`을 만들지 않는다. 모델에도 외부 기억을 쓰지
말고 입력으로 제공한 검증 텍스트와 URL만 사용하도록 지시한다.

## 실행

```bash
# 실제 제안 생성 (OPENAI_API_KEY 필요, 런타임과 분리된 운영 작업)
python3 scripts/build_place_representativeness.py

# 네트워크 없이 스냅샷·현재 입력·사람 승인 정합성 검사
python3 scripts/build_place_representativeness.py --check
```

API 오류, JSON 불일치, 관계 누락이 발생하면 명령은 실패하며 기존 스냅샷을 덮어쓰지 않는다.
CI는 `--check`만 실행하므로 키와 네트워크가 필요 없다.
