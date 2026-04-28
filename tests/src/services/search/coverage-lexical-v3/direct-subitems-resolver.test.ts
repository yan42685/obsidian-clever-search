jest.mock("src/services/search/coverage-lexical-v3/direct-subitems/evidence", () => ({
	buildV3DirectSubitemCandidates: jest.fn(),
	prepareV3DirectSubitemSnapshotText: jest.fn((snapshotText: string) => ({
		text: snapshotText,
	})),
}));

jest.mock("src/services/search/coverage-lexical-v3/direct-subitems/renderer", () => ({
	renderV3DirectSubitemCandidate: jest.fn(),
}));

import { buildV3DirectSubitems } from "src/services/search/coverage-lexical-v3/direct-subitems";
import type {
	V3DirectSubitemAtom,
	V3DirectSubitemCandidate,
	V3DirectSubitemComponent,
	V3DirectSubitemRenderPayload,
} from "src/services/search/coverage-lexical-v3/direct-subitems/contracts";
import { buildV3DirectSubitemCandidates } from "src/services/search/coverage-lexical-v3/direct-subitems/evidence";
import { renderV3DirectSubitemCandidate } from "src/services/search/coverage-lexical-v3/direct-subitems/renderer";

const mockedBuildCandidates = jest.mocked(buildV3DirectSubitemCandidates);
const mockedRenderCandidate = jest.mocked(renderV3DirectSubitemCandidate);

function createAtom(
	overrides: Partial<V3DirectSubitemAtom> = {},
): V3DirectSubitemAtom {
	return {
		kind: overrides.kind ?? "realized_family_atom",
		evidenceKind: overrides.evidenceKind ?? "real_exact",
		queryUnitIndex: overrides.queryUnitIndex ?? 0,
		surfaceGroupIndex: overrides.surfaceGroupIndex ?? 0,
		blockId: overrides.blockId ?? 0,
		start: overrides.start ?? 0,
		end: overrides.end ?? 5,
		matchedText: overrides.matchedText ?? "alpha",
		anchorTier: overrides.anchorTier ?? "real_lexical",
		highlightTier: overrides.highlightTier ?? "strong",
		bigramText: overrides.bigramText ?? null,
	};
}

function createComponent(atoms: readonly V3DirectSubitemAtom[]): V3DirectSubitemComponent {
	return {
		scopeStart: atoms[0]?.start ?? 0,
		scopeEnd: atoms[atoms.length - 1]?.end ?? 10,
		scopeTier: "body_window",
		blockIds: [...new Set(atoms.map((atom) => atom.blockId))],
		atoms,
	};
}

function createCandidate(
	overrides: Partial<V3DirectSubitemCandidate>,
): V3DirectSubitemCandidate {
	const atoms = overrides.atoms ?? [
		createAtom({
			start: overrides.start ?? 0,
			end: (overrides.start ?? 0) + 5,
		}),
	];
	return {
		start: overrides.start ?? atoms[0]?.start ?? 0,
		end: overrides.end ?? atoms[atoms.length - 1]?.end ?? 10,
		anchorOffset: overrides.anchorOffset ?? overrides.start ?? 0,
		component: overrides.component ?? createComponent(atoms),
		atoms,
		displayAtoms: overrides.displayAtoms ?? atoms,
		hasAnchor: overrides.hasAnchor ?? true,
		anchorTier: overrides.anchorTier ?? "real_lexical",
		coveredRealPrimaryCount: overrides.coveredRealPrimaryCount ?? 1,
		confirmedSurfaceGroupCount: overrides.confirmedSurfaceGroupCount ?? 0,
		singletonHanCompletionTier: overrides.singletonHanCompletionTier ?? "none",
		matchedOpaqueBigramCount: overrides.matchedOpaqueBigramCount ?? 0,
		opaqueCoverageRatio: overrides.opaqueCoverageRatio ?? 0,
		preservesQueryOrder: overrides.preservesQueryOrder ?? true,
		windowWidth: overrides.windowWidth ?? 10,
		maxAdjacentGap: overrides.maxAdjacentGap ?? 0,
		totalGap: overrides.totalGap ?? 0,
	};
}

function createQueryAnalysis() {
	return {
		queryText: "alpha",
		normalizedQueryText: "alpha",
		querySingletonHanChar: null,
		querySingletonHanCodePoint: null,
		querySingletonHanRecallEligible: false,
		surfaceGroups: [
			{
				index: 0,
				text: "alpha",
				kind: "latin" as const,
				hanBigramTexts: [],
				coveredCharMask: [],
				queryResidualUniqueBigrams: [],
				hasQueryResidualHanCoverage: false,
			},
		],
		primaryUnits: [
			{ index: 0, text: "alpha", source: "surface" as const, surfaceGroupIndex: 0 },
		],
		hanBackstopGroups: [],
		surfaceCoverageShapeKey: "l",
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

	test("keeps all canonical candidates when weak pruning is off", () => {
		const first = createCandidate({ start: 10, end: 20, anchorOffset: 10 });
		const second = createCandidate({ start: 120, end: 130, anchorOffset: 120 });
		mockedBuildCandidates.mockReturnValue([first, second]);
		mockedRenderCandidate.mockImplementation(({ candidate }) =>
			createRenderPayload({
				text: `${candidate.start}`,
				snippetText: `${candidate.start}`,
				displayStart: candidate.start,
				displayEnd: candidate.end + 20,
			}),
		);

		const result = buildV3DirectSubitems({
			snapshotText: "alpha",
			queryAnalysis: createQueryAnalysis(),
			candidate: {} as never,
			candidateRecall: {} as never,
			residentBase: {} as never,
			maxSubItemResults: 5,
			hideWeaklyRelatedResults: false,
		});

		expect(result.candidates).toEqual([first, second]);
	});

	test("weak pruning keeps only candidates in the top anchor gate", () => {
		const topCandidate = createCandidate({
			start: 10,
			end: 20,
			anchorOffset: 10,
			anchorTier: "confirmed_surface",
			confirmedSurfaceGroupCount: 1,
		});
		const sameGate = createCandidate({
			start: 40,
			end: 55,
			anchorOffset: 40,
			anchorTier: "confirmed_surface",
			confirmedSurfaceGroupCount: 1,
		});
		const weakerTail = createCandidate({
			start: 80,
			end: 95,
			anchorOffset: 80,
			anchorTier: "real_lexical",
			confirmedSurfaceGroupCount: 0,
		});
		mockedBuildCandidates.mockReturnValue([topCandidate, sameGate, weakerTail]);
		mockedRenderCandidate.mockImplementation(({ candidate }) =>
			createRenderPayload({
				text: `${candidate.start}`,
				snippetText: `${candidate.start}`,
				displayStart: candidate.start,
				displayEnd: candidate.end + 20,
			}),
		);

		const result = buildV3DirectSubitems({
			snapshotText: "alpha",
			queryAnalysis: createQueryAnalysis(),
			candidate: {} as never,
			candidateRecall: {} as never,
			residentBase: {} as never,
			maxSubItemResults: 5,
			hideWeaklyRelatedResults: true,
		});

		expect(result.candidates).toEqual([topCandidate, sameGate]);
	});

	test("weak pruning keeps singleton-completed candidates ahead of singleton-incomplete peers", () => {
		const tightSingleton = createCandidate({
			start: 10,
			end: 20,
			anchorOffset: 10,
			singletonHanCompletionTier: "tight",
		});
		const sameTightSingleton = createCandidate({
			start: 40,
			end: 50,
			anchorOffset: 40,
			singletonHanCompletionTier: "tight",
		});
		const missingSingleton = createCandidate({
			start: 80,
			end: 90,
			anchorOffset: 80,
			singletonHanCompletionTier: "none",
		});
		mockedBuildCandidates.mockReturnValue([
			tightSingleton,
			sameTightSingleton,
			missingSingleton,
		]);
		mockedRenderCandidate.mockImplementation(({ candidate }) =>
			createRenderPayload({
				text: `${candidate.start}`,
				snippetText: `${candidate.start}`,
			}),
		);

		const result = buildV3DirectSubitems({
			snapshotText: "alpha",
			queryAnalysis: createQueryAnalysis(),
			candidate: {} as never,
			candidateRecall: {} as never,
			residentBase: {} as never,
			maxSubItemResults: 5,
			hideWeaklyRelatedResults: true,
		});

		expect(result.candidates).toEqual([tightSingleton, sameTightSingleton]);
	});

	test("anchorless candidates are dropped defensively", () => {
		const anchorless = createCandidate({
			start: 10,
			end: 20,
			anchorOffset: 10,
			hasAnchor: false,
			anchorTier: "none",
		});
		const anchored = createCandidate({
			start: 40,
			end: 50,
			anchorOffset: 40,
		});
		mockedBuildCandidates.mockReturnValue([anchorless, anchored]);
		mockedRenderCandidate.mockImplementation(({ candidate }) =>
			createRenderPayload({
				text: `${candidate.start}`,
				snippetText: `${candidate.start}`,
			}),
		);

		const result = buildV3DirectSubitems({
			snapshotText: "alpha",
			queryAnalysis: createQueryAnalysis(),
			candidate: {} as never,
			candidateRecall: {} as never,
			residentBase: {} as never,
			maxSubItemResults: 5,
			hideWeaklyRelatedResults: false,
		});

		expect(result.candidates).toEqual([anchored]);
	});
});
