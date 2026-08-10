import fs from "node:fs";

const path = "app/planner-wizard.tsx";
let text = fs.readFileSync(path, "utf8");

function replaceOnce(before, after, label) {
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  text = text.replace(before, after);
}

replaceOnce(
  'import { excludedPlaceIdsFrom, initialCandidateIds, initialSelectedIds } from "@/lib/candidates";',
  'import { excludedPlaceIdsFrom, initialCandidateIds } from "@/lib/candidates";\nimport { initialPlaceIdsFromItinerary } from "@/lib/initial-place-selection";',
  "imports",
);

replaceOnce(
`  const loadCandidates = useCallback(async () => {
    const data = await getCandidatePlaces({
      selectedActorIds: selectedActors.map((a) => a.id),
      selectedWorkIds: selectedWorks.map((w) => w.id),
    });
    setCandidateData(data);
    // #51 최종 계약: 서버가 엄격한 배우 후보 ∪ 검토된 작품 후보만 반환하므로 전체 초기 선택.
    setSelectedPlaceIds(new Set(initialSelectedIds(data.candidates)));
    setVisibleCount(PLACES_PAGE_SIZE); // 새 후보는 처음부터 다시 센다
    setStep(3);
  }, [selectedActors, selectedWorks]);`,
`  const loadCandidates = useCallback(async () => {
    const actorIds = selectedActors.map((a) => a.id);
    const workIds = selectedWorks.map((w) => w.id);
    const data = await getCandidatePlaces({
      selectedActorIds: actorIds,
      selectedWorkIds: workIds,
    });
    const allCandidateIds = initialCandidateIds(data.candidates);
    const sequence = ++planSequence.current;

    /**
     * 첫 Step 3은 후보 전체를 체크한 뒤 DOM에서 다시 끄는 방식이 아니라,
     * 실제 일정 엔진 결과와 선택 state를 먼저 맞춘 뒤 연다.
     *
     * 엔진이 부분집합만 배치했다면 그 장소만 선택한 조건으로 다시 계산해
     * rejectedPlaces/selectionGroups까지 현재 선택과 일치시키며, 최대 3회 안에서 고정점에 도달한다.
     */
    const constraintsFor = (selectedIds: readonly string[]) => {
      const selected = new Set(selectedIds);
      return constraintsFromTripInputs(
        {
          arrivalAt: arrival.at,
          departureAt: departure.at,
          airportReadyAt: airportReady.at,
          airportArrivalDeadline: airportDeadline.at,
        },
        actorIds,
        workIds,
        data.candidates.filter((candidate) => !selected.has(candidate.id)).map((candidate) => candidate.id),
      );
    };

    dispatchView({ type: "PLAN_START" });
    setThemeExperience(null);

    let selectedIds = allCandidateIds;
    let finalConstraints = constraintsFor(selectedIds);

    try {
      let finalAction = await planItinerary(finalConstraints);
      if (sequence !== planSequence.current) return;

      for (let pass = 0; pass < 2 && finalAction.ok && finalAction.result.status === "planned"; pass += 1) {
        const nextSelectedIds = initialPlaceIdsFromItinerary(selectedIds, finalAction.result);
        const sameSelection =
          nextSelectedIds.length === selectedIds.length &&
          nextSelectedIds.every((id, index) => id === selectedIds[index]);
        if (sameSelection) break;

        selectedIds = nextSelectedIds;
        finalConstraints = constraintsFor(selectedIds);
        finalAction = await planItinerary(finalConstraints);
        if (sequence !== planSequence.current) return;
      }

      setCandidateData(data);
      setSelectedPlaceIds(new Set(selectedIds));
      setVisibleCount(PLACES_PAGE_SIZE);
      setSettledSelectionKey([...selectedIds].sort().join("|"));

      if (!finalAction.ok) {
        dispatchView({ type: "PLAN_INVALID" });
        setStep(3);
        return;
      }

      dispatchView({ type: "PLAN_SUCCESS", result: finalAction.result });
      saveStub.markDirty();
      setStep(3);

      if (finalAction.result.status === "planned") {
        const baseline = gatewayPlanningBaselineOf(finalAction.result);
        if (baseline) {
          void planGatewayAlternatives(finalConstraints, baseline).then((gateway) => {
            if (sequence !== planSequence.current || !gateway.ok) return;
            dispatchView({ type: "GATEWAY_ALTERNATIVES_SUCCESS", alternatives: gateway.alternatives });
          }).catch(() => {
            // 핵심 철도 일정은 이미 확정됐으므로 대안 조회 실패가 추천을 되돌리지는 않는다.
          });
        }
        void refreshThemeExperience(finalAction.result.days, finalConstraints.selectedWorkIds);
      }
    } catch {
      if (sequence !== planSequence.current) return;
      setCandidateData(data);
      setSelectedPlaceIds(new Set(allCandidateIds));
      setVisibleCount(PLACES_PAGE_SIZE);
      setSettledSelectionKey([...allCandidateIds].sort().join("|"));
      dispatchView({ type: "PLAN_FAILED" });
      setStep(3);
    }
  }, [
    selectedActors,
    selectedWorks,
    arrival.at,
    departure.at,
    airportReady.at,
    airportDeadline.at,
    saveStub,
    refreshThemeExperience,
  ]);`,
  "loadCandidates",
);

replaceOnce(
`  const reopened = view.reopened;
  useEffect(() => {
    const decision = autoPlanDecision({`,
`  const reopened = view.reopened;
  useEffect(() => {
    // loadCandidates가 이미 현재 선택의 최종 일정까지 계산해 Step 3을 연 경우 중복 호출하지 않는다.
    // 이후 사용자가 장소를 켜거나 끄면 selectionKey가 달라져 아래 자동 재계산 경로로 들어간다.
    if (
      step === 3 &&
      candidateData !== null &&
      reopened === null &&
      selectedPlaceIds.size > 0 &&
      selectionKey === settledSelectionKey &&
      view.result !== null &&
      !view.planning
    ) return;

    const decision = autoPlanDecision({`,
  "auto-plan guard",
);

replaceOnce(
`  }, [selectedPlaceIds, step, candidateData, reopened]);`,
`  }, [
    selectedPlaceIds,
    step,
    candidateData,
    reopened,
    selectionKey,
    settledSelectionKey,
    view.result,
    view.planning,
  ]);`,
  "auto-plan dependencies",
);

fs.writeFileSync(path, text);
console.log("planner-wizard.tsx patched successfully");
