import type { V3QueryAnalysis } from "src/services/search/coverage-lexical-v3/query/analysis";
import type { V3CandidateDocRecall } from "src/services/search/coverage-lexical-v3/recall";
import type { EvidencePackingProfile } from "src/services/search/coverage-lexical-v3/ranking";
import { buildV3DirectSubitems } from "src/services/search/coverage-lexical-v3/direct-subitems";
import {
	createMinimalCandidate as createBaseCandidate,
	createMinimalCandidateRecall,
	createMinimalResidentBaseForBlockCounts as createResidentBaseForBlockCounts,
	createRealizedFamily as createBaseRealizedFamily,
} from "./test-fixtures";

function createQueryAnalysis(params: {
	queryText: string;
	surfaceGroups: V3QueryAnalysis["surfaceGroups"];
	primaryUnits: V3QueryAnalysis["primaryUnits"];
	surfaceCoverageShapeKey?: string;
	querySingletonHanChar?: string | null;
	querySingletonHanCodePoint?: number | null;
	querySingletonHanRecallEligible?: boolean;
}): V3QueryAnalysis {
	return {
		queryText: params.queryText,
		normalizedQueryText: params.queryText,
		querySingletonHanChar: params.querySingletonHanChar ?? null,
		querySingletonHanCodePoint: params.querySingletonHanCodePoint ?? null,
		querySingletonHanRecallEligible:
			params.querySingletonHanRecallEligible ?? false,
		surfaceGroups: params.surfaceGroups,
		primaryUnits: params.primaryUnits,
		hanBackstopGroups: [],
		surfaceCoverageShapeKey: params.surfaceCoverageShapeKey ?? "h",
	};
}

function createCandidate(overrides: Partial<EvidencePackingProfile>): EvidencePackingProfile {
	const defaultBodyWindow = {
		tier: "bodyWindow" as const,
		blockIds: [0],
		boundaryCrossingCount: 0,
		coveredUnitIndices: [0],
		coveredDistinctUnitCount: 1,
		containerCompactness: 100,
		exactUnitCount: 1,
		windowWidth: 1,
		gapCount: 0,
		density: 1,
		isLocalityTight: true,
		localityTightness: 1,
		headingCorroboration: { coveredUnitIndices: [], unitCount: 0 },
	};
	const bodyWindowContainer =
		"bodyWindowContainer" in overrides
			? (overrides.bodyWindowContainer ?? null)
			: defaultBodyWindow;
	const strongestContainer =
		"strongestContainer" in overrides
			? (overrides.strongestContainer ?? null)
			: overrides.bodyWindowContainer ?? defaultBodyWindow;
	return createBaseCandidate({
		...overrides,
		bodyWindowContainer,
		strongestContainer,
		secondStrongestContainer: overrides.secondStrongestContainer ?? null,
		fragmentationPenalty:
			overrides.fragmentationPenalty ?? {
				bodyResidueUnitCount: 0,
				uncoveredByTopTwoCount: 0,
				explanatoryContainerCount: 1,
			},
	});
}

function createRealizedFamily(
	queryUnitIndex: number,
	queryUnitText: string,
	familyText = queryUnitText,
	matchKind: "exact" | "prefix" | "fuzzy" | "opaque_exact" = "exact",
	querySurfaceGroupIndex: number | null = queryUnitIndex,
) {
	return createBaseRealizedFamily({
		queryUnitIndex,
		queryUnitText,
		querySurfaceGroupIndex,
		familyId: queryUnitIndex,
		familyText,
		matchKind,
		editDistance: matchKind === "fuzzy" ? 1 : 0,
		identityMetadataSource: "none",
		routeMetadataSource: "none",
		metadataPackingSource: "route",
		inIdentity: false,
		inRoute: false,
		inHeading: false,
		inBestBodyWindow: true,
		inBodyResidue: false,
	});
}

function createCandidateRecall(overrides: Partial<V3CandidateDocRecall>): V3CandidateDocRecall {
	return createMinimalCandidateRecall(
		overrides.shortlistedBodyBlockIds ?? [0],
		overrides,
	);
}

function extractHighlightTexts(result: ReturnType<typeof buildV3DirectSubitems>): string[] {
	return result.subItems[0]?.highlightRanges?.map((range) =>
		(result.subItems[0]?.snippetText ?? "").slice(range.start, range.end),
	) ?? [];
}
describe("coverage lexical v3 direct subitems", () => {
	test("prefers a full Han surface snippet over a shorter real term", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "\u751f\u547d\u529b",
			surfaceGroups: [
				{
					index: 0,
					text: "\u751f\u547d\u529b",
					kind: "han",
					hanBigramTexts: ["\u751f\u547d", "\u547d\u529b"],
					coveredCharMask: [true, true, false],
					queryResidualUniqueBigrams: ["\u547d\u529b"],
					hasQueryResidualHanCoverage: true,
				},
			],
			primaryUnits: [
				{ index: 0, text: "\u751f\u547d", source: "han_tokenizer_real", surfaceGroupIndex: 0 },
			],
		});

		const result = buildV3DirectSubitems({
			snapshotText: "\u751f\u547d\u529b\u5341\u8db3\n\u8fd9\u91cc\u53ea\u8c08\u751f\u547d\u73b0\u8c61",
			queryAnalysis,
			candidate: createCandidate({
				path: "life.md",
				realizedFamilies: [createRealizedFamily(0, "\u751f\u547d", "\u751f\u547d", "exact", 0)],
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0, 1] }),
			residentBase: createResidentBaseForBlockCounts([2]),
		});

		expect(result.candidates[0]?.confirmedSurfaceGroupCount).toBe(1);
		expect(extractHighlightTexts(result)).toContain("\u751f\u547d\u529b");
	});

	test("whole-group Han rescue still yields a direct subitem when query-time residual bigrams are empty", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "\u8d62\u5b8b",
			surfaceGroups: [
				{
					index: 0,
					text: "\u8d62\u5b8b",
					kind: "han",
					hanBigramTexts: ["\u8d62\u5b8b"],
					coveredCharMask: [true, true],
					queryResidualUniqueBigrams: [],
					hasQueryResidualHanCoverage: false,
				},
			],
			primaryUnits: [
				{ index: 0, text: "\u8d62\u5b8b", source: "han_tokenizer_real", surfaceGroupIndex: 0 },
			],
		});

		const result = buildV3DirectSubitems({
			snapshotText: "\u8d62\u5b8b\u4f53",
			queryAnalysis,
			candidate: createCandidate({
				path: "winsong.md",
				realizedFamilies: [
					createRealizedFamily(500001, "\u8d62\u5b8b", "\u8d62\u5b8b", "opaque_exact", 0),
				],
			}),
			candidateRecall: createCandidateRecall({
				shortlistedBodyBlockIds: [0],
				hanSurfaceGroupRecalls: [
					{
						surfaceGroupIndex: 0,
						metadataGateStats: null,
						bodySeedBlockIds: [0],
						bodySeedBlockGates: [],
					},
				],
			}),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0]?.anchorTier).toBe("confirmed_surface");
		expect(extractHighlightTexts(result)).toContain("\u8d62\u5b8b");
	});

	test("does not attribute singleton bigram anchors across Han surface groups", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "\u751f\u547d\u529b \u5b87\u5b99",
			surfaceGroups: [
				{
					index: 0,
					text: "\u751f\u547d\u529b",
					kind: "han",
					hanBigramTexts: ["\u751f\u547d", "\u547d\u529b"],
					coveredCharMask: [true, true, false],
					queryResidualUniqueBigrams: ["\u547d\u529b"],
					hasQueryResidualHanCoverage: true,
				},
				{
					index: 1,
					text: "\u5b87\u5b99",
					kind: "han",
					hanBigramTexts: ["\u5b87\u5b99"],
					coveredCharMask: [true, true],
					queryResidualUniqueBigrams: [],
					hasQueryResidualHanCoverage: false,
				},
			],
			primaryUnits: [],
			surfaceCoverageShapeKey: "hh",
		});

		const result = buildV3DirectSubitems({
			snapshotText: "\u5b87\u5b99\u7684\u529b\u91cf",
			queryAnalysis,
			candidate: createCandidate({
				path: "cross-group.md",
				realizedFamilies: [],
				singletonHanCompletion: {
					singletonHanChar: "\u529b",
					singletonHanCharIndex: 2,
					singletonHanSurfaceGroupIndex: 0,
					matched: true,
					matchSource: "body_adjacent_block",
					bestAnchorKind: "bigram",
					bestAnchorDistance: 1,
					sameBlockAsAnchor: true,
					sameBlockAsBestBodyWindow: true,
					tier: "tight",
				},
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		const matchedBigramAtoms = result.candidates.flatMap((candidate) =>
			candidate.atoms.filter((atom) => atom.kind === "matched_bigram_atom"),
		);
		expect(matchedBigramAtoms).not.toContainEqual(
			expect.objectContaining({
				surfaceGroupIndex: 1,
				bigramText: "\u5b87\u5b99",
			}),
		);
		expect(matchedBigramAtoms).not.toContainEqual(
			expect.objectContaining({
				surfaceGroupIndex: 0,
				bigramText: "\u5b87\u5b99",
			}),
		);
	});

	test("keeps higher real coverage ahead of a full Han surface snippet", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "abc \u751f\u547d\u529b",
			surfaceGroups: [
				{
					index: 0,
					text: "abc",
					kind: "latin",
					hanBigramTexts: [],
					coveredCharMask: [],
					queryResidualUniqueBigrams: [],
					hasQueryResidualHanCoverage: false,
				},
				{
					index: 1,
					text: "\u751f\u547d\u529b",
					kind: "han",
					hanBigramTexts: ["\u751f\u547d", "\u547d\u529b"],
					coveredCharMask: [true, true, false],
					queryResidualUniqueBigrams: ["\u547d\u529b"],
					hasQueryResidualHanCoverage: true,
				},
			],
			primaryUnits: [
				{ index: 0, text: "abc", source: "surface", surfaceGroupIndex: 0 },
				{ index: 1, text: "\u751f\u547d", source: "han_tokenizer_real", surfaceGroupIndex: 1 },
			],
			surfaceCoverageShapeKey: "lh",
		});

		const result = buildV3DirectSubitems({
			snapshotText: "\u751f\u547d\u529b\u5341\u8db3\nabc \u4e0e\u751f\u547d\u5206\u5f00\u51fa\u73b0",
			queryAnalysis,
			candidate: createCandidate({
				path: "mixed.md",
				realizedFamilies: [
					createRealizedFamily(0, "abc", "abc", "exact", 0),
					createRealizedFamily(1, "\u751f\u547d", "\u751f\u547d", "exact", 1),
				],
				bodyWindowContainer: {
					tier: "bodyWindow",
					blockIds: [0, 1],
					boundaryCrossingCount: 1,
					coveredUnitIndices: [0, 1],
					coveredDistinctUnitCount: 2,
					containerCompactness: 100,
					exactUnitCount: 2,
					windowWidth: 2,
					gapCount: 1,
					density: 1,
					isLocalityTight: true,
					localityTightness: 1,
					headingCorroboration: { coveredUnitIndices: [], unitCount: 0 },
				},

			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0, 1] }),
			residentBase: createResidentBaseForBlockCounts([2]),
		});

		expect(result.candidates[0]?.coveredRealPrimaryCount).toBe(2);
		expect(extractHighlightTexts(result)).toEqual(
			expect.arrayContaining(["abc", expect.stringMatching(/^\u751f\u547d/)]),
		);
	});

	test("materializes a body snippet from unresolved bigrams even without a full surface span", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "\u751f\u547d\u529b",
			surfaceGroups: [
				{
					index: 0,
					text: "\u751f\u547d\u529b",
					kind: "han",
					hanBigramTexts: ["\u751f\u547d", "\u547d\u529b"],
					coveredCharMask: [true, false, false],
					queryResidualUniqueBigrams: ["\u547d\u529b"],
					hasQueryResidualHanCoverage: true,
				},
			],
			primaryUnits: [
				{ index: 0, text: "\u751f\u547d", source: "han_tokenizer_real", surfaceGroupIndex: 0 },
			],
		});

		const result = buildV3DirectSubitems({
			snapshotText: "\u8fd9\u91cc\u5148\u8bf4\u751f\u547d\uff0c\u7136\u540e\u547d\u529b\u88ab\u5355\u72ec\u63d0\u53ca",
			queryAnalysis,
			candidate: createCandidate({
				path: "bigram.md",
				realizedFamilies: [createRealizedFamily(0, "\u751f\u547d", "\u751f\u547d", "exact", 0)],
				bodyWindowContainer: null,
				strongestContainer: null,
			}),
			candidateRecall: createCandidateRecall({
				shortlistedBodyBlockIds: [0],
				hanSurfaceGroupRecalls: [
					{
						surfaceGroupIndex: 0,
						metadataGateStats: null,
						bodySeedBlockIds: [0],
						bodySeedBlockGates: [],
					},
				],
			}),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		expect(result.candidates[0]?.matchedOpaqueBigramCount).toBe(1);
		expect(result.subItems).toHaveLength(1);
		expect(result.subItems[0]?.snippetText).toContain("\u547d\u529b");
	});

	test("does not fabricate a full Han surface when only partial Han evidence exists", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "\u751f\u547d\u529b",
			surfaceGroups: [
				{
					index: 0,
					text: "\u751f\u547d\u529b",
					kind: "han",
					hanBigramTexts: ["\u751f\u547d", "\u547d\u529b"],
					coveredCharMask: [true, true, false],
					queryResidualUniqueBigrams: ["\u547d\u529b"],
					hasQueryResidualHanCoverage: true,
				},
			],
			primaryUnits: [
				{ index: 0, text: "\u751f\u547d", source: "han_tokenizer_real", surfaceGroupIndex: 0 },
			],
		});

		const result = buildV3DirectSubitems({
			snapshotText: "\u8fd9\u91cc\u53ea\u6709\u751f\u547d\uff0c\u6ca1\u6709\u5b8c\u6574\u8bcd",
			queryAnalysis,
			candidate: createCandidate({
				path: "partial.md",
				realizedFamilies: [createRealizedFamily(0, "\u751f\u547d", "\u751f\u547d", "exact", 0)],
				bodyWindowContainer: null,
				strongestContainer: null,
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		expect(result.candidates[0]?.confirmedSurfaceGroupCount).toBe(0);
		expect(extractHighlightTexts(result)).toContain("\u751f\u547d");
		expect(extractHighlightTexts(result)).not.toContain("\u751f\u547d\u529b");
	});

	test("uses only the nearest residual singleton highlight in a local block", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "\u751f\u547d\u529b",
			surfaceGroups: [
				{
					index: 0,
					text: "\u751f\u547d\u529b",
					kind: "han",
					hanBigramTexts: ["\u751f\u547d", "\u547d\u529b"],
					coveredCharMask: [true, true, false],
					queryResidualUniqueBigrams: ["\u547d\u529b"],
					hasQueryResidualHanCoverage: true,
				},
			],
			primaryUnits: [
				{ index: 0, text: "\u751f\u547d", source: "han_tokenizer_real", surfaceGroupIndex: 0 },
			],
		});

		const result = buildV3DirectSubitems({
			snapshotText: "\u529b \u751f\u547d\u529b",
			queryAnalysis,
			candidate: createCandidate({
				path: "nearest-singleton.md",
				realizedFamilies: [createRealizedFamily(0, "\u751f\u547d", "\u751f\u547d", "exact", 0)],
				singletonHanCompletion: {
					singletonHanChar: "\u529b",
					singletonHanCharIndex: 2,
					singletonHanSurfaceGroupIndex: 0,
					matched: true,
					matchSource: "body_same_block",
					bestAnchorKind: "exact",
					bestAnchorDistance: 0,
					sameBlockAsAnchor: true,
					sameBlockAsBestBodyWindow: true,
					tier: "tight",
				},
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		expect(extractHighlightTexts(result)).toEqual(["\u751f\u547d\u529b"]);
	});

	test("matched bigram singleton anchors stay scoped to their Han surface group", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "\u5b87\u5b99\u529b \u5b87\u5b99",
			surfaceGroups: [
				{
					index: 0,
					text: "\u5b87\u5b99\u529b",
					kind: "han",
					hanBigramTexts: ["\u5b87\u5b99", "\u5b99\u529b"],
					coveredCharMask: [false, false, false],
					queryResidualUniqueBigrams: ["\u5b87\u5b99", "\u5b99\u529b"],
					hasQueryResidualHanCoverage: true,
				},
				{
					index: 1,
					text: "\u5b87\u5b99",
					kind: "han",
					hanBigramTexts: ["\u5b87\u5b99"],
					coveredCharMask: [false, false],
					queryResidualUniqueBigrams: ["\u5b87\u5b99"],
					hasQueryResidualHanCoverage: true,
				},
			],
			primaryUnits: [],
			surfaceCoverageShapeKey: "hh",
		});

		const result = buildV3DirectSubitems({
			snapshotText: "\u5b87\u5b99 \u529b",
			queryAnalysis,
			candidate: createCandidate({
				path: "scoped-bigram-singleton.md",
				realizedFamilies: [],
				singletonHanCompletion: {
					singletonHanChar: "\u529b",
					singletonHanCharIndex: 2,
					singletonHanSurfaceGroupIndex: 0,
					matched: true,
					matchSource: "body_same_block",
					bestAnchorKind: "bigram",
					bestAnchorDistance: 1,
					sameBlockAsAnchor: true,
					sameBlockAsBestBodyWindow: true,
					tier: "tight",
				},
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		const matchedBigramAtoms = result.candidates[0]?.atoms.filter(
			(atom) => atom.kind === "matched_bigram_atom",
		) ?? [];
		expect(result.candidates[0]?.matchedOpaqueBigramCount).toBe(1);
		expect(matchedBigramAtoms.map((atom) => atom.surfaceGroupIndex)).toEqual([0]);
	});

	test("splits distant latin evidence when the weighted gap exceeds the local budget", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "alpha beta",
			surfaceGroups: [
				{
					index: 0,
					text: "alpha",
					kind: "latin",
					hanBigramTexts: [],
					coveredCharMask: [],
					queryResidualUniqueBigrams: [],
					hasQueryResidualHanCoverage: false,
				},
				{
					index: 1,
					text: "beta",
					kind: "latin",
					hanBigramTexts: [],
					coveredCharMask: [],
					queryResidualUniqueBigrams: [],
					hasQueryResidualHanCoverage: false,
				},
			],
			primaryUnits: [
				{ index: 0, text: "alpha", source: "surface", surfaceGroupIndex: 0 },
				{ index: 1, text: "beta", source: "surface", surfaceGroupIndex: 1 },
			],
			surfaceCoverageShapeKey: "ll",
		});

		const result = buildV3DirectSubitems({
			snapshotText: `alpha${"x".repeat(125)}beta`,
			queryAnalysis,
			candidate: createCandidate({
				path: "gap.md",
				realizedFamilies: [
					createRealizedFamily(0, "alpha"),
					createRealizedFamily(1, "beta"),
				],
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
			maxSubItemResults: 5,
		});

		expect(result.candidates).toHaveLength(2);
		expect(result.subItems).toHaveLength(2);
	});

	test("exposes all canonical candidates before maxSubItemResults truncation", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "alpha beta gamma",
			surfaceGroups: [
				{
					index: 0,
					text: "alpha",
					kind: "latin",
					hanBigramTexts: [],
					coveredCharMask: [],
					queryResidualUniqueBigrams: [],
					hasQueryResidualHanCoverage: false,
				},
				{
					index: 1,
					text: "beta",
					kind: "latin",
					hanBigramTexts: [],
					coveredCharMask: [],
					queryResidualUniqueBigrams: [],
					hasQueryResidualHanCoverage: false,
				},
				{
					index: 2,
					text: "gamma",
					kind: "latin",
					hanBigramTexts: [],
					coveredCharMask: [],
					queryResidualUniqueBigrams: [],
					hasQueryResidualHanCoverage: false,
				},
			],
			primaryUnits: [
				{ index: 0, text: "alpha", source: "surface", surfaceGroupIndex: 0 },
				{ index: 1, text: "beta", source: "surface", surfaceGroupIndex: 1 },
				{ index: 2, text: "gamma", source: "surface", surfaceGroupIndex: 2 },
			],
			surfaceCoverageShapeKey: "lll",
		});

		const result = buildV3DirectSubitems({
			snapshotText: `alpha${"x".repeat(125)}beta${"x".repeat(125)}gamma`,
			queryAnalysis,
			candidate: createCandidate({
				path: "complete.md",
				realizedFamilies: [
					createRealizedFamily(0, "alpha"),
					createRealizedFamily(1, "beta"),
					createRealizedFamily(2, "gamma"),
				],
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
			maxSubItemResults: 2,
		});

		expect(result.candidates).toHaveLength(3);
		expect(result.subItems).toHaveLength(2);
	});

	test("anchors prefix snippets to realized family text instead of the raw short query unit", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "st",
			surfaceGroups: [
				{
					index: 0,
					text: "st",
					kind: "latin",
					hanBigramTexts: [],
					coveredCharMask: [],
					queryResidualUniqueBigrams: [],
					hasQueryResidualHanCoverage: false,
				},
			],
			primaryUnits: [
				{ index: 0, text: "st", source: "surface", surfaceGroupIndex: 0 },
			],
			surfaceCoverageShapeKey: "l",
		});

		const result = buildV3DirectSubitems({
			snapshotText: "status lines drift here\nstart strong in this paragraph",
			queryAnalysis,
			candidate: createCandidate({
				path: "prefix.md",
				bodyWindowContainer: null,
				strongestContainer: null,
				realizedFamilies: [createRealizedFamily(0, "st", "start", "prefix", 0)],
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		expect(extractHighlightTexts(result)).toContain("start");
		expect(extractHighlightTexts(result)).not.toContain("st");
	});

	test("hideWeaklyRelatedResults drops same-query weaker snippets once a confirmed full surface wins", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "\u751f\u547d\u529b",
			surfaceGroups: [
				{
					index: 0,
					text: "\u751f\u547d\u529b",
					kind: "han",
					hanBigramTexts: ["\u751f\u547d", "\u547d\u529b"],
					coveredCharMask: [true, true, false],
					queryResidualUniqueBigrams: ["\u547d\u529b"],
					hasQueryResidualHanCoverage: true,
				},
			],
			primaryUnits: [
				{ index: 0, text: "\u751f\u547d", source: "han_tokenizer_real", surfaceGroupIndex: 0 },
			],
		});

		const result = buildV3DirectSubitems({
			snapshotText: "\u5148\u8bf4\u751f\u547d\n\n\u540e\u6765\u8bf4\u751f\u547d\u529b\u5341\u8db3",
			queryAnalysis,
			candidate: createCandidate({
				path: "hide-weak.md",
				realizedFamilies: [createRealizedFamily(0, "\u751f\u547d", "\u751f\u547d", "exact", 0)],
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0, 1] }),
			residentBase: createResidentBaseForBlockCounts([2]),
			hideWeaklyRelatedResults: true,
		});

		expect(result.subItems).toHaveLength(1);
		expect(extractHighlightTexts(result)).toContain("\u751f\u547d\u529b");
	});

	test("singleton Han body snippets render the matched char as a strong highlight", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "\u952e",
			querySingletonHanChar: "\u952e",
			querySingletonHanCodePoint: "\u952e".codePointAt(0) ?? null,
			querySingletonHanRecallEligible: true,
			surfaceGroups: [
				{
					index: 0,
					text: "\u952e",
					kind: "han",
					hanBigramTexts: [],
					coveredCharMask: [false],
					queryResidualUniqueBigrams: [],
					hasQueryResidualHanCoverage: false,
				},
			],
			primaryUnits: [],
		});

		const result = buildV3DirectSubitems({
			snapshotText: "\u70b9\u51fb\u5feb\u6377\u952e\u7ee7\u7eed",
			queryAnalysis,
			candidate: createCandidate({
				path: "menu.md",
				realizedCoverageCount: 0,
				coverageGate: {
					realizedCoverageCount: 0,
					fullySatisfiedSurfaceGroupCount: 0,
					startedSurfaceGroupCount: 0,
					crossScriptSatisfiedGroupCount: 0,
				},
				exactUnitCount: 0,
				realizedFamilies: [],
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		expect(result.subItems).toHaveLength(1);
		expect(result.candidates[0]?.anchorTier).toBe("singleton_han");
		expect(extractHighlightTexts(result)).toContain("\u952e");
		expect(result.subItems[0]?.weakHighlightRanges ?? []).toEqual([]);
	});

	test("returns no body snippet when there is no legal local body evidence", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "st",
			surfaceGroups: [
				{
					index: 0,
					text: "st",
					kind: "latin",
					hanBigramTexts: [],
					coveredCharMask: [],
					queryResidualUniqueBigrams: [],
					hasQueryResidualHanCoverage: false,
				},
			],
			primaryUnits: [
				{ index: 0, text: "st", source: "surface", surfaceGroupIndex: 0 },
			],
			surfaceCoverageShapeKey: "l",
		});

		const result = buildV3DirectSubitems({
			snapshotText: "status lines drift here\nstart strong in this paragraph",
			queryAnalysis,
			candidate: createCandidate({
				path: "no-local.md",
				bodyWindowContainer: null,
				strongestContainer: null,
				realizedFamilies: [createRealizedFamily(0, "st", "start", "prefix", 0)],
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [] }),
			residentBase: createResidentBaseForBlockCounts([1]),
			candidateRangeMode: "whole_document",
		});

		expect(result.candidates).toHaveLength(0);
		expect(result.subItems).toHaveLength(0);
	});

	test("maps resident block ordinals through the indexed body block sequence", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "\u5feb\u6377\u952e",
			surfaceGroups: [
				{
					index: 0,
					text: "\u5feb\u6377\u952e",
					kind: "han",
					hanBigramTexts: ["\u5feb\u6377", "\u6377\u952e"],
					coveredCharMask: [true, true, true],
					queryResidualUniqueBigrams: [],
					hasQueryResidualHanCoverage: false,
				},
			],
			primaryUnits: [
				{
					index: 0,
					text: "\u5feb\u6377\u952e",
					source: "han_tokenizer_real",
					surfaceGroupIndex: 0,
				},
			],
		});

		const result = buildV3DirectSubitems({
			snapshotText: "......\n\u8fd9\u4e00\u6bb5\u5305\u542b\u5feb\u6377\u952e\u8bf4\u660e",
			queryAnalysis,
			candidate: createCandidate({
				path: "shortcut.md",
				realizedFamilies: [
					createRealizedFamily(
						0,
						"\u5feb\u6377\u952e",
						"\u5feb\u6377\u952e",
						"exact",
						0,
					),
				],
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		expect(result.subItems).toHaveLength(1);
		expect(result.subItems[0]?.snippetText).toContain("\u5feb\u6377\u952e");
		expect(extractHighlightTexts(result)).toContain("\u5feb\u6377\u952e");
	});

	test("renders direct subitem snippets with original offsets after normalization expands text", () => {
		const result = buildV3DirectSubitems({
			snapshotText: "ﬁ\ncache restore",
			queryAnalysis: createQueryAnalysis({
				queryText: "cache",
				surfaceGroups: [
					{
						index: 0,
						text: "cache",
						kind: "latin",
						hanBigramTexts: [],
						coveredCharMask: [],
						queryResidualUniqueBigrams: [],
						hasQueryResidualHanCoverage: false,
					},
				],
				primaryUnits: [
					{ index: 0, text: "cache", source: "surface", surfaceGroupIndex: 0 },
				],
			}),
			candidate: createCandidate({
				realizedFamilies: [createRealizedFamily(0, "cache")],
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		expect(result.renderPayloads[0]?.row).toBe(1);
		expect(result.renderPayloads[0]?.col).toBe(0);
		expect(result.subItems[0]?.snippetText).toContain("ﬁ\ncache");
		expect(extractHighlightTexts(result)).toContain("cache");
	});
});
