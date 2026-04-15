jest.mock("src/services/search/coverage-lexical-v3/direct-subitems/evidence", () => ({
	buildV3DirectSubitemCandidates: jest.fn(),
}));

jest.mock("src/services/search/coverage-lexical-v3/direct-subitems/renderer", () => ({
	renderV3DirectSubitemCandidate: jest.fn(),
}));

import { buildV3DirectSubitems } from "src/services/search/coverage-lexical-v3/direct-subitems";
import type {
	V3DirectSubitemCandidate,
	V3DirectSubitemRenderPayload,
} from "src/services/search/coverage-lexical-v3/direct-subitems/contracts";
import { buildV3DirectSubitemCandidates } from "src/services/search/coverage-lexical-v3/direct-subitems/evidence";
import { renderV3DirectSubitemCandidate } from "src/services/search/coverage-lexical-v3/direct-subitems/renderer";

const mockedBuildCandidates = jest.mocked(buildV3DirectSubitemCandidates);
const mockedRenderCandidate = jest.mocked(renderV3DirectSubitemCandidate);

function createCandidate(
	overrides: Partial<V3DirectSubitemCandidate>,
): V3DirectSubitemCandidate {
	return {
		start: overrides.start ?? 0,
		end: overrides.end ?? 10,
		anchorOffset: overrides.anchorOffset ?? overrides.start ?? 0,
		occurrences: overrides.occurrences ?? [
			{
				kind: "real_exact",
				start: overrides.start ?? 0,
				end: (overrides.start ?? 0) + 5,
				queryUnitIndex: 0,
				surfaceGroupIndex: null,
				text: "alpha",
			},
		],
		displayOccurrences: overrides.displayOccurrences ?? [],
		coveredRealPrimaryCount: overrides.coveredRealPrimaryCount ?? 1,
		completedHanSurfaceGroupCount: overrides.completedHanSurfaceGroupCount ?? 0,
		preservesQueryOrder: overrides.preservesQueryOrder ?? true,
		windowWidth: overrides.windowWidth ?? 10,
		maxAdjacentGap: overrides.maxAdjacentGap ?? 0,
		totalGap: overrides.totalGap ?? 0,
	};
}

function createRenderPayload(
	overrides: Partial<V3DirectSubitemRenderPayload>,
): V3DirectSubitemRenderPayload {
	return {
		text: overrides.text ?? "alpha snippet",
		html: overrides.html ?? "alpha snippet",
		snippetText: overrides.snippetText ?? "alpha snippet",
		row: overrides.row ?? 0,
		col: overrides.col ?? 0,
		coreStart: overrides.coreStart ?? 0,
		coreEnd: overrides.coreEnd ?? 5,
		displayStart: overrides.displayStart ?? 0,
		displayEnd: overrides.displayEnd ?? 20,
		anchorOffset: overrides.anchorOffset ?? 0,
		highlightRanges: overrides.highlightRanges ?? [{ start: 0, end: 5 }],
	};
}

describe("coverage lexical v3 direct subitems resolver", () => {
	beforeEach(() => {
		mockedBuildCandidates.mockReset();
		mockedRenderCandidate.mockReset();
	});

	test("weakly dedupes tail snippets that render almost the same display window", () => {
		const topCandidate = createCandidate({
			start: 10,
			end: 20,
			anchorOffset: 10,
			windowWidth: 10,
		});
		const nearDuplicateTail = createCandidate({
			start: 12,
			end: 24,
			anchorOffset: 12,
			windowWidth: 12,
			occurrences: [
				{
					kind: "real_exact",
					start: 13,
					end: 18,
					queryUnitIndex: 0,
					surfaceGroupIndex: null,
					text: "alpha",
				},
			],
		});
		const distantTail = createCandidate({
			start: 120,
			end: 130,
			anchorOffset: 120,
			windowWidth: 10,
		});
		mockedBuildCandidates.mockReturnValue([
			topCandidate,
			nearDuplicateTail,
			distantTail,
		]);
		mockedRenderCandidate.mockImplementation(({ candidate }) => {
			if (candidate === topCandidate) {
				return createRenderPayload({
					text: "top",
					snippetText: "top",
					displayStart: 0,
					displayEnd: 40,
					highlightRanges: [{ start: 0, end: 5 }],
				});
			}
			if (candidate === nearDuplicateTail) {
				return createRenderPayload({
					text: "tail-dup",
					snippetText: "tail-dup",
					displayStart: 2,
					displayEnd: 41,
					highlightRanges: [{ start: 0, end: 5 }],
				});
			}
			return createRenderPayload({
				text: "tail-distant",
				snippetText: "tail-distant",
				displayStart: 100,
				displayEnd: 140,
				highlightRanges: [{ start: 0, end: 5 }],
			});
		});

		const result = buildV3DirectSubitems({
			snapshotText: "alpha",
			queryAnalysis: {
				queryText: "alpha",
				normalizedQueryText: "alpha",
				surfaceGroups: [{ index: 0, text: "alpha", kind: "latin" }],
				primaryUnits: [
					{ index: 0, text: "alpha", source: "surface", surfaceGroupIndex: 0 },
				],
				hanBackstopGroups: [],
				surfaceCoverageShapeKey: "l",
			},
			candidate: {} as never,
			candidateRecall: {} as never,
			residentBase: {} as never,
			maxSubItemResults: 5,
		});

		expect(result.candidates).toEqual([topCandidate, distantTail]);
		expect(result.renderPayloads.map((payload) => payload.text)).toEqual([
			"top",
			"tail-distant",
		]);
	});

	test("keeps genuinely distant tails even when highlight signatures match", () => {
		const topCandidate = createCandidate({ start: 10, end: 20, anchorOffset: 10 });
		const distantTail = createCandidate({ start: 200, end: 210, anchorOffset: 200 });
		mockedBuildCandidates.mockReturnValue([topCandidate, distantTail]);
		mockedRenderCandidate.mockImplementation(({ candidate }) =>
			candidate === topCandidate
				? createRenderPayload({
					text: "top",
					snippetText: "top",
					displayStart: 0,
					displayEnd: 40,
					highlightRanges: [{ start: 0, end: 5 }],
				})
				: createRenderPayload({
					text: "distant",
					snippetText: "distant",
					displayStart: 120,
					displayEnd: 160,
					highlightRanges: [{ start: 0, end: 5 }],
				}),
		);

		const result = buildV3DirectSubitems({
			snapshotText: "alpha",
			queryAnalysis: {
				queryText: "alpha",
				normalizedQueryText: "alpha",
				surfaceGroups: [{ index: 0, text: "alpha", kind: "latin" }],
				primaryUnits: [
					{ index: 0, text: "alpha", source: "surface", surfaceGroupIndex: 0 },
				],
				hanBackstopGroups: [],
				surfaceCoverageShapeKey: "l",
			},
			candidate: {} as never,
			candidateRecall: {} as never,
			residentBase: {} as never,
			maxSubItemResults: 5,
		});

		expect(result.candidates).toEqual([topCandidate, distantTail]);
		expect(result.renderPayloads.map((payload) => payload.text)).toEqual([
			"top",
			"distant",
		]);
	});
});
