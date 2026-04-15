import { renderV3DirectSubitemCandidate } from "src/services/search/coverage-lexical-v3/direct-subitems/renderer";
import type { V3DirectSubitemCandidate } from "src/services/search/coverage-lexical-v3/direct-subitems/contracts";

function createCandidate(
	overrides: Partial<V3DirectSubitemCandidate> = {},
): V3DirectSubitemCandidate {
	return {
		start: overrides.start ?? 0,
		end: overrides.end ?? 3,
		anchorOffset: overrides.anchorOffset ?? 0,
		occurrences:
			overrides.occurrences ?? [
				{
					kind: "surface_completion",
					start: 0,
					end: 3,
					queryUnitIndex: null,
					surfaceGroupIndex: 0,
					text: "???",
				},
			],
		displayOccurrences: overrides.displayOccurrences ?? [],
		coveredRealPrimaryCount: overrides.coveredRealPrimaryCount ?? 1,
		completedHanSurfaceGroupCount: overrides.completedHanSurfaceGroupCount ?? 1,
		preservesQueryOrder: overrides.preservesQueryOrder ?? true,
		windowWidth: overrides.windowWidth ?? 3,
		maxAdjacentGap: overrides.maxAdjacentGap ?? 0,
		totalGap: overrides.totalGap ?? 0,
	};
}

describe("coverage lexical v3 direct subitems renderer", () => {
	test("falls back to raw occurrences when display occurrences are empty", () => {
		const payload = renderV3DirectSubitemCandidate({
			snapshotText: "??? rest of snippet",
			candidate: createCandidate(),
		});

		expect(payload.highlightRanges).toEqual([{ start: 0, end: 3 }]);
		expect(payload.snippetText.slice(0, 3)).toBe("???");
	});
});
