# 촬영지 관련성 랭킹 입력 규칙 v1

관련: #48, #51

## 범위

- 촬영지 후보는 데이터 범위 내에서 모두 유지한다.
- AI 점수는 같은 관계 범주의 정렬과 검증된 장면 근거 표시만 보조한다.
- 미검토·하한 미달·스냅샷 누락은 후보 제외 조건이 아니다. 하한 미달의 활성 점수는 정렬에는 사용한다.
- 촬영지 랭킹용 OpenAI API는 Python 오프라인 파이프라인에서만 호출한다.
- 런타임 검색 입력 해석(#78)은 별도 서버 경계에서 OpenAI API를 사용한다(`API_SPEC.md` 2.2).

## 임베딩 입력

- 작품: `제목 — 공식 근거의 장르·시대 배경 1문장 + 핵심 서사 1문장`
- 장소: `장소명(검토된 별칭) — 공간 성격 1문장 + 근거 있는 작품 장면 맥락 1문장`
- 작품 장면 맥락은 #51의 검토된 `WorkPlaceRelation.sceneNote`를 재사용하며 근거가 없으면 생략한다.
- 임베딩 입력은 한국어 한 벌로 고정하고 저장소에 보관한다. 규칙이 바뀌면 `inputRuleVersion`을 올린다.
- 영어는 사용자에게 표시할 `reason.en`에만 사용한다.

## 스냅샷 계약

```json
{
  "meta": {
    "model": "text-embedding-model",
    "inputRuleVersion": "v1",
    "generatedAt": "2026-08-08T12:00:00+09:00",
    "badgeThreshold": 0.25
  },
  "rankings": [
    {
      "workId": "work-encounter",
      "placeId": "place-namsan-library",
      "score": 0.309219,
      "reviewed": true,
      "reviewedAt": "2026-08-10",
      "reviewedBy": "pipeline:verified-relation-v1",
      "reviewMethod": "verified_relation_auto",
      "reason": {
        "ko": "2화에서 김진혁(박보검)이 이 도서관을 찾는다.",
        "en": "Kim Jin-hyuk visits this library in episode 2."
      }
    }
  ]
}
```

`reviewed: true`는 작품–장소 관계 검증이 완료되어 정렬에 사용할 수 있다는 뜻이다. 신규 검증 관계의
자동 활성화는 `reviewMethod: "verified_relation_auto"`로 명시한다. 기존 사람 검토 항목은 원래의
`reviewedBy`·`reviewedAt`·이유를 보존하며, 과거 데이터는 `reviewMethod`를 생략할 수 있다.
자동 활성화는 새 사실이나 설명을 생성하지 않고 관계의 `sceneNote.ko/en`을 그대로 `reason`으로 옮긴다.
`reason.ko/en`은 `score >= badgeThreshold`인 활성 항목에 필수이며 내부 점수와 검토 메타는 화면에 노출하지 않는다.

## 결정적 정렬

1. 관련성순: `selected_work → actor_other_work → 활성 AI 점수 내림차순 → officialSourceCount 내림차순 → placeId 오름차순`
2. 공식 출처순: `officialSourceCount 내림차순 → 관계 유형 → placeId 오름차순`

스냅샷이 없거나 항목이 미검토이면 AI 점수를 건너뛰고 기존 관계·출처·ID 순서로 폴백한다.
`badgeThreshold`는 장면 근거 표시 게이트일 뿐 정렬 게이트가 아니다. 하한 미달의 검증 점수도
관련성 정렬에 사용하되 `aiReason`은 내리지 않는다.

## 오프라인 생성

오프라인 랭킹 생성은 이 명령을 실행하는 셸의 `OPENAI_API_KEY`를 사용한다.
런타임 검색 입력 해석(#78)은 서버 환경변수의 같은 키를 사용하며 클라이언트에는 노출하지 않는다.

```bash
python scripts/build_place_rankings.py --dry-run
python scripts/build_place_rankings.py
python scripts/build_place_rankings.py --check
```

- 모델 기본값: `text-embedding-3-small`
- 배지 기본값: `0.25` (장면 근거 표시 하한)
- 입력: `data/place-ranking-inputs.json`의 한국어 작품 10개 + 장소 36개
- 비용 방어: 한 번에 최대 100개·총 50,000자까지만 호출
- 출력: 검증 완료된 `work-place-relations.json`의 관계만 1:1 활성 랭킹으로 생성
- API 실패·키 누락·응답 이상 시 기존 `place-rankings.json`을 변경하지 않음
- 기존 수동 검토 이력·이유는 보존하고 신규 검증 관계는 `verified_relation_auto`로 활성화
- 관계 미검토·장면 설명 ko/en 누락·입력 참조 불일치는 전체 생성을 중단해 사람이 예외만 검토
- 런타임 승격 중 랭킹 생성이 실패하면 승격 데이터도 이전 상태로 복원
- `--check`와 CI는 검증 관계와 활성 랭킹이 정확히 1:1인지 API 호출 없이 검사

## v1 현재 스냅샷 (2026-08-10, PR #120)

- API 입력: 작품 10개 + 장소 36개 = 46개·3,185자·3,376토큰, API 호출 1회
- 출력: 검증 관계 42쌍, 점수 분포 `0.1792~0.4857`
- 기존 사람 검토 14건의 이력·이유를 보존하고 신규 관계 28건을 자동 활성화
- 자동 활성화 28건 중 하한 이상 20건은 `검증된 장면 근거`를 표시하고, 하한 미달 8건은
  점수를 정렬에만 사용한다.
- 자동 활성화 이유는 `WorkPlaceRelation.sceneNote` ko/en을 그대로 복사한다. 기존 수동 이유는 검증된
  장면 내용을 바탕으로 사람이 확정한 문장을 보존하며 일반 관광 추천을 추가하지 않는다.

## 런타임 연결 (구현됨)

- `getCandidatePlaces` 서버 액션이 `data/place-rankings.json`을 로드해
  (`lib/place-rankings-snapshot.ts` — 미탑재는 null, 계약 위반은 로드 실패)
  후보별 **안전 파생값만** 응답에 싣는다: `aiRank`(선택 관련 작품 범위의
  활성 점수 dense rank)·`aiReason`(하한 이상인 검증된 장면 근거 ko/en).
- 원시 점수·검토 메타(`score`·`reviewedBy` 등)는 RSC/액션 응답으로 직렬화되지 않는다
  (PR #70 리뷰). 정렬·이유 모두 후보의 선택 관련 작품(relationDetails) 범위만 사용해
  무관 작품 고득점이 순서에 영향을 주지 않는다.
