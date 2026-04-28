// @ts-nocheck
import type { IndexedDocument } from "src/globals/search-types";
import { buildResidentBase } from "src/services/search/coverage-lexical-v3/build";
import {
	ANCHORED_SOFT_BLOCK_BUDGET,
	computeAnchoredSoftBlockBudget,
	computeBodyBlockGuard,
	TOTAL_BODY_BLOCK_GUARD,
	applyPrefixFanoutGuard,
	hasMetadataAnchor,
} from "src/services/search/coverage-lexical-v3/prefix-fanout-guard";
import { analyzeQuery, type V3DocumentTokenizer } from "src/services/search/coverage-lexical-v3/query";
import {
	lookupQueryUnitFamilies,
	recallCandidateDocs,
	type V3CandidateBodyBlockRecall,
	type V3CandidateDocRecall,
} from "src/services/search/coverage-lexical-v3/recall";

const STRONG_HAN_STATS = {
	matchedBigramCount: 2,
	longestContiguousBigramChain: 2,
	bigramCoverageRatio: 1,
} as const;

function createDocument(
	overrides: Partial<IndexedDocument> & Pick<IndexedDocument, "path" | "basename" | "folder">,
): IndexedDocument {
	return {
		path: overrides.path,
		basename: overrides.basename,
		folder: overrides.folder,
		content: overrides.content,
		aliases: overrides.aliases,
		tags: overrides.tags,
		headings: overrides.headings,
		generation: overrides.generation ?? 1,
		size: overrides.size,
	};
}

function createDocumentTokenizer(
	termMap: Readonly<Record<string, readonly string[]>>,
): V3DocumentTokenizer {
	return (text) => termMap[text] ?? [];
}

function recallDocs(
	documents: readonly IndexedDocument[],
	queryText: string,
	queryTerms: readonly string[] = [queryText],
	tokenizeDocumentText?: V3DocumentTokenizer,
) {
	const residentBase = buildResidentBase(documents, tokenizeDocumentText);
	const queryAnalysis = analyzeQuery(queryText, queryTerms);
	const unitFamilyMatches = lookupQueryUnitFamilies(residentBase, queryAnalysis, {
		allowPrefixMatch: true,
		allowFuzzyMatch: false,
	});
	return recallCandidateDocs(residentBase, queryAnalysis, unitFamilyMatches);
}

function createBodyBlockRecall(
	blockId: number,
	overrides: Partial<V3CandidateBodyBlockRecall> = {},
): V3CandidateBodyBlockRecall {
	return {
		blockId,
		hasExactSupport: overrides.hasExactSupport ?? false,
		hasPrefixSupport: overrides.hasPrefixSupport ?? false,
		hasStrongHanSupport: overrides.hasStrongHanSupport ?? false,
		hasSingletonHanSupport: overrides.hasSingletonHanSupport ?? false,
		hasScopedSingletonHanSupport:
			overrides.hasScopedSingletonHanSupport ?? false,
	};
}

function createCandidateRecall(
	docId: number,
	options: Readonly<{
		shardId?: string;
		shardGeneration?: number;
		liveDocSlot?: number;
		identity?: readonly number[];
		route?: readonly number[];
		heading?: readonly number[];
		bodyBlocks?: readonly V3CandidateBodyBlockRecall[];
		hanMetadata?: boolean;
	}> = {},
): V3CandidateDocRecall {
	const bodyBlocks = options.bodyBlocks ?? [];
	const strongHanBlockIds = bodyBlocks
		.filter((block) => block.hasStrongHanSupport)
		.map((block) => block.blockId);
	return {
		shardId: options.shardId ?? "test-shard",
		shardGeneration: options.shardGeneration ?? 1,
		docId,
		liveDocSlot: options.liveDocSlot ?? docId,
		matchedIdentityUnitIndices: options.identity ?? [],
		matchedRouteUnitIndices: options.route ?? [],
		matchedHeadingUnitIndices: options.heading ?? [],
		hasQuerySingletonHanMetadataSupport: false,
		hasScopedSingletonHanMetadataSupport: false,
		shortlistedBodyBlocks: bodyBlocks,
		shortlistedBodyBlockIds: bodyBlocks.map((block) => block.blockId),
		hanMetadataGateStats: options.hanMetadata ? STRONG_HAN_STATS : null,
		hanBodyBlockGateStats: strongHanBlockIds.map((blockId) => ({
			blockId,
			stats: STRONG_HAN_STATS,
		})),
		hanSurfaceGroupRecalls:
			options.hanMetadata || strongHanBlockIds.length > 0
				? [
					{
						surfaceGroupIndex: 0,
						metadataGateStats: options.hanMetadata ? STRONG_HAN_STATS : null,
						bodySeedBlockIds: strongHanBlockIds,
						bodySeedBlockGates: strongHanBlockIds.map((blockId) => ({
							blockId,
							stats: STRONG_HAN_STATS,
						})),
					},
				]
				: [],
	};
}

function buildWeakPrefixBlocks(count: number, startBlockId = 1): V3CandidateBodyBlockRecall[] {
	return Array.from({ length: count }, (_, index) =>
		createBodyBlockRecall(startBlockId + index, { hasPrefixSupport: true }),
	);
}

describe("coverage lexical v3 prefix fanout guard", () => {
	test("body block budget clamps to the configured min and max bounds", () => {
		expect(computeBodyBlockGuard(1)).toBe(160);
		expect(computeBodyBlockGuard(30)).toBe(160);
		expect(computeBodyBlockGuard(50)).toBe(200);
		expect(computeBodyBlockGuard(200)).toBe(TOTAL_BODY_BLOCK_GUARD);
	});

	test("recall marks exact body support provenance", () => {
		const candidateDocs = recallDocs(
			[
				createDocument({
					path: "latin/exact-body.md",
					basename: "note",
					folder: "latin",
					content: "prefer",
				}),
			],
			"prefer",
		);

		expect(candidateDocs[0]?.shortlistedBodyBlocks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					blockId: 0,
					hasExactSupport: true,
				}),
			]),
		);
	});

	test("recall marks prefix body support provenance", () => {
		const candidateDocs = recallDocs(
			[
				createDocument({
					path: "latin/prefix-body.md",
					basename: "note",
					folder: "latin",
					content: "prefer",
				}),
			],
			"prefe",
		);

		expect(candidateDocs[0]?.shortlistedBodyBlocks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					blockId: 0,
					hasPrefixSupport: true,
				}),
			]),
		);
	});

	test("recall marks strong Han body support from rescue gates", () => {
		const tokenizer = createDocumentTokenizer({
			"赢宋体": ["赢宋体"],
		});
		const candidateDocs = recallDocs(
			[
				createDocument({
					path: "zh/body-fallback.md",
					basename: "普通笔记",
					folder: "zh",
					content: "赢宋体",
				}),
			],
			"赢宋",
			["赢宋"],
			tokenizer,
		);

		expect(candidateDocs[0]?.shortlistedBodyBlocks.some((block) => block.hasStrongHanSupport)).toBe(
			true,
		);
	});

	test("metadata anchor accepts identity route heading and Han metadata evidence", () => {
		expect(hasMetadataAnchor(createCandidateRecall(1, { identity: [0] }))).toBe(true);
		expect(hasMetadataAnchor(createCandidateRecall(2, { route: [1] }))).toBe(true);
		expect(hasMetadataAnchor(createCandidateRecall(3, { heading: [2] }))).toBe(true);
		expect(hasMetadataAnchor(createCandidateRecall(4, { hanMetadata: true }))).toBe(true);
		expect(hasMetadataAnchor(createCandidateRecall(5))).toBe(false);
	});

	test("scoped singleton rescue markers do not count as metadata anchors by themselves", () => {
		expect(
			hasMetadataAnchor({
				...createCandidateRecall(6),
				hasScopedSingletonHanMetadataSupport: true,
			}),
		).toBe(false);
	});

	test("guard stays inactive when total body blocks are within the global budget", () => {
		const candidateDocs = [
			createCandidateRecall(1, {
				bodyBlocks: buildWeakPrefixBlocks(TOTAL_BODY_BLOCK_GUARD),
			}),
		];

		const guarded = applyPrefixFanoutGuard(candidateDocs, 64);

		expect(guarded.stats.guardApplied).toBe(false);
		expect(guarded.candidateDocs[0]?.shortlistedBodyBlockIds).toHaveLength(
			TOTAL_BODY_BLOCK_GUARD,
		);
	});

	test("anchored docs are preserved and consume the soft budget first", () => {
		const anchoredDoc = createCandidateRecall(1, {
			identity: [0],
			bodyBlocks: buildWeakPrefixBlocks(220),
		});
		const unanchoredDoc = createCandidateRecall(2, {
			bodyBlocks: buildWeakPrefixBlocks(120, 1000),
		});

		const guarded = applyPrefixFanoutGuard([anchoredDoc, unanchoredDoc], 64);
		const keptAnchored = guarded.candidateDocs.find((candidate) => candidate.docId === 1);
		const keptUnanchored = guarded.candidateDocs.find((candidate) => candidate.docId === 2);

		expect(guarded.stats.guardApplied).toBe(true);
		expect(guarded.stats.anchoredKeptBlockCount).toBe(ANCHORED_SOFT_BLOCK_BUDGET);
		expect(keptAnchored?.shortlistedBodyBlockIds).toHaveLength(
			ANCHORED_SOFT_BLOCK_BUDGET,
		);
		expect(keptUnanchored?.shortlistedBodyBlockIds).toHaveLength(
			TOTAL_BODY_BLOCK_GUARD - ANCHORED_SOFT_BLOCK_BUDGET,
		);
		expect(guarded.stats.postTotalShortlistedBodyBlockCount).toBe(TOTAL_BODY_BLOCK_GUARD);
	});

	test("guard budget tracks max item results for a 50-result request", () => {
		const blockBudget = computeBodyBlockGuard(50);
		const anchoredBudget = computeAnchoredSoftBlockBudget(blockBudget);
		const anchoredDoc = createCandidateRecall(1, {
			identity: [0],
			bodyBlocks: buildWeakPrefixBlocks(220),
		});
		const unanchoredDoc = createCandidateRecall(2, {
			bodyBlocks: buildWeakPrefixBlocks(120, 1000),
		});

		const guarded = applyPrefixFanoutGuard([anchoredDoc, unanchoredDoc], 50);
		const keptAnchored = guarded.candidateDocs.find((candidate) => candidate.docId === 1);
		const keptUnanchored = guarded.candidateDocs.find((candidate) => candidate.docId === 2);

		expect(blockBudget).toBe(200);
		expect(anchoredBudget).toBe(140);
		expect(keptAnchored?.shortlistedBodyBlockIds).toHaveLength(anchoredBudget);
		expect(keptUnanchored?.shortlistedBodyBlockIds).toHaveLength(
			blockBudget - anchoredBudget,
		);
		expect(guarded.stats.postTotalShortlistedBodyBlockCount).toBe(blockBudget);
	});

	test("prefix-only blocks do not consume budget ahead of later core evidence", () => {
		const blockBudget = computeBodyBlockGuard(1);
		const anchoredBudget = computeAnchoredSoftBlockBudget(blockBudget);
		const prefixHeavyAnchored = createCandidateRecall(1, {
			identity: [0],
			bodyBlocks: buildWeakPrefixBlocks(blockBudget),
		});
		const laterExactAnchored = createCandidateRecall(2, {
			route: [1],
			bodyBlocks: [createBodyBlockRecall(5000, { hasExactSupport: true })],
		});

		const guarded = applyPrefixFanoutGuard(
			[prefixHeavyAnchored, laterExactAnchored],
			1,
		);
		const keptPrefixHeavy = guarded.candidateDocs.find((candidate) => candidate.docId === 1);
		const keptLaterExact = guarded.candidateDocs.find((candidate) => candidate.docId === 2);

		expect(blockBudget).toBe(160);
		expect(anchoredBudget).toBe(112);
		expect(keptLaterExact?.shortlistedBodyBlockIds).toEqual([5000]);
		expect(keptPrefixHeavy?.shortlistedBodyBlockIds).toHaveLength(anchoredBudget - 1);
		expect(guarded.stats.anchoredKeptBlockCount).toBe(anchoredBudget);
	});

	test("anchored docs remain even when they receive zero kept body blocks", () => {
		const firstAnchored = createCandidateRecall(1, {
			identity: [0],
			bodyBlocks: buildWeakPrefixBlocks(220),
		});
		const secondAnchored = createCandidateRecall(2, {
			route: [1],
			bodyBlocks: buildWeakPrefixBlocks(40, 1000),
		});
		const filler = createCandidateRecall(3, {
			bodyBlocks: buildWeakPrefixBlocks(40, 2000),
		});

		const guarded = applyPrefixFanoutGuard([firstAnchored, secondAnchored, filler], 64);
		const keptSecondAnchored = guarded.candidateDocs.find((candidate) => candidate.docId === 2);

		expect(keptSecondAnchored).toBeDefined();
		expect(keptSecondAnchored?.shortlistedBodyBlockIds).toHaveLength(0);
	});

	test("unanchored docs without kept body blocks are removed", () => {
		const anchoredDoc = createCandidateRecall(1, {
			identity: [0],
			bodyBlocks: buildWeakPrefixBlocks(220),
		});
		const unanchoredDocs = Array.from({ length: 100 }, (_, index) =>
			createCandidateRecall(index + 2, {
				bodyBlocks: [createBodyBlockRecall(index + 1000, { hasPrefixSupport: true })],
			}),
		);

		const guarded = applyPrefixFanoutGuard([anchoredDoc, ...unanchoredDocs], 64);

		expect(guarded.stats.removedUnanchoredDocCount).toBe(23);
		expect(guarded.candidateDocs).toHaveLength(78);
		expect(
			guarded.candidateDocs.filter((candidate) => !hasMetadataAnchor(candidate)),
		).toHaveLength(TOTAL_BODY_BLOCK_GUARD - ANCHORED_SOFT_BLOCK_BUDGET);
	});

	test("block priority keeps exact and strong Han support ahead of weak prefix-only blocks", () => {
		const anchoredDoc = createCandidateRecall(1, {
			identity: [0],
			bodyBlocks: [
				...buildWeakPrefixBlocks(298),
				createBodyBlockRecall(998, { hasExactSupport: true, hasPrefixSupport: true }),
				createBodyBlockRecall(999, { hasStrongHanSupport: true }),
			],
		});

		const guarded = applyPrefixFanoutGuard([anchoredDoc], 64);
		const keptBlockIds = guarded.candidateDocs[0]?.shortlistedBodyBlockIds ?? [];

		expect(keptBlockIds).toContain(998);
		expect(keptBlockIds).toContain(999);
		expect(keptBlockIds).toHaveLength(ANCHORED_SOFT_BLOCK_BUDGET);
		expect(keptBlockIds).not.toContain(298);
	});

	test("guard keys body block budgets by shard as well as live doc slot", () => {
		const firstShardDoc = createCandidateRecall(1, {
			shardId: "sealed-0",
			liveDocSlot: 0,
			bodyBlocks: buildWeakPrefixBlocks(180, 0),
		});
		const secondShardDoc = createCandidateRecall(2, {
			shardId: "active-1",
			liveDocSlot: 0,
			bodyBlocks: [createBodyBlockRecall(0, { hasExactSupport: true })],
		});

		const guarded = applyPrefixFanoutGuard([firstShardDoc, secondShardDoc], 1);
		const keptFirstShardDoc = guarded.candidateDocs.find(
			(candidate) => candidate.shardId === "sealed-0",
		);
		const keptSecondShardDoc = guarded.candidateDocs.find(
			(candidate) => candidate.shardId === "active-1",
		);

		expect(guarded.stats.guardApplied).toBe(true);
		expect(keptFirstShardDoc?.shortlistedBodyBlockIds).toHaveLength(159);
		expect(keptSecondShardDoc?.shortlistedBodyBlockIds).toEqual([0]);
	});
});
