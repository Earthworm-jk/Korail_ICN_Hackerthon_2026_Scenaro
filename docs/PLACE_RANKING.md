# 촬영지 관련성 랭킹 입력 규칙 v1

관련: #48, #51

## 범위

- 촬영지 후보는 데이터 범위 내에서 모두 유지한다.
- AI 점수는 같은 관계 범주의 정렬과 검토된 설명만 보조한다.
- 미검토·점수 미달·스냅샷 누락은 후보 제외 조건이 아니다.
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
      "workId": "work-goblin",
      "placeId": "place-yeongjin-beach",
      "score": 0.82,
      "reviewed": true,
      "reviewedAt": "2026-08-08",
      "reviewedBy": "reviewer",
      "reason": {
        "ko": "검토된 관련 이유",
        "en": "Reviewed relevance reason"
      }
    }
  ]
}
```

`reason.ko/en`은 `reviewed: true`이고 `score >= badgeThreshold`인 항목에 필수다. 내부 점수는 화면에 노출하지 않는다.

## 결정적 정렬

1. 관련성순: `selected_work → actor_other_work → 검토된 AI 점수 내림차순 → officialSourceCount 내림차순 → placeId 오름차순`
2. 공식 출처순: `officialSourceCount 내림차순 → 관계 유형 → placeId 오름차순`

스냅샷이 없거나 항목이 미검토이면 AI 점수를 건너뛰고 기존 관계·출처·ID 순서로 폴백한다.

## 오프라인 생성

오프라인 랭킹 생성은 이 명령을 실행하는 셸의 `OPENAI_API_KEY`를 사용한다.
런타임 검색 입력 해석(#78)은 서버 환경변수의 같은 키를 사용하며 클라이언트에는 노출하지 않는다.

```bash
python scripts/build_place_rankings.py --dry-run
python scripts/build_place_rankings.py
```

- 모델 기본값: `text-embedding-3-small`
- 배지 기본값: `0.25` (v1 실스냅 검토 하한)
- 입력: `data/place-ranking-inputs.json`의 한국어 작품 4개 + 장소 12개
- 비용 방어: 한 번에 최대 100개·총 50,000자까지만 호출
- 출력: 모든 작품×장소 조합을 `reviewed: false`로 생성
- API 실패·키 누락·응답 이상 시 기존 `place-rankings.json`을 변경하지 않음
- 사람 검토 후에만 `reviewed: true`, `reviewedAt`, `reviewedBy`, `reason.ko/en`을 확정

`badgeThreshold` 미만은 검토됐더라도 런타임 정렬에서 AI 점수 없음으로 취급한다.
후보를 숨기지 않고 `officialSourceCount → placeId` 폴백을 사용한다.

## v1 실스냅 검토 (2026-08-09)

- API 입력: 16개·1,014자·1,078토큰, API 호출 1회
- 작품×장소: 48쌍, 점수 분포 `0.104232~0.461840`
- 검토 통과: `WorkPlaceRelation` 공식 촬영 관계와 일치하는 12쌍
- 하한 `0.25`: 검토 통과 12쌍의 최저점 `0.259498`을 포함하면서 하한 미만을 미탑재·미검토와 동일하게 폴백하는 값
- 검토 사유는 검증된 `WorkPlaceRelation.sceneNote` 내용을 ko/en으로 재사용하고, 일반 관광 추천은 추가하지 않았다.

## v1 증분 갱신 (2026-08-09, #72 부산 팩)

- 기존 48쌍·검토 12쌍은 원값 그대로 보존하고, 신규 2곳(벡스코·영화의전당)×4작품 = 8쌍만
  증분 계산해 추가했다(임베딩 입력 6건·445토큰·API 호출 1회).
- 검증된 관계 2쌍(더 킹×벡스코 0.310068·더 킹×영화의전당 0.368012)은 장면 근거로 검토
  완료 처리했다 — 둘 다 하한 0.25 이상. 나머지 신규 6쌍은 미검토 유지.
- 합계 56쌍(4작품×14곳)·검토 14쌍 = 검증된 관계 전체.

## 런타임 연결 (구현됨)

- `getCandidatePlaces` 서버 액션이 `data/place-rankings.json`을 로드해
  (`lib/place-rankings-snapshot.ts` — 미탑재는 null, 계약 위반은 로드 실패)
  후보별 **안전 파생값만** 응답에 싣는다: `aiRank`(선택 관련 작품 범위의
  검토·배지 통과 점수 dense rank)·`aiReason`(검토된 관련 이유 ko/en).
- 원시 점수·검토 메타(`score`·`reviewedBy` 등)는 RSC/액션 응답으로 직렬화되지 않는다
  (PR #70 리뷰). 정렬·이유 모두 후보의 선택 관련 작품(relationDetails) 범위만 사용해
  무관 작품 고득점이 순서에 영향을 주지 않는다.
