jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

import type { IndexedDocument } from "src/globals/search-types";
import { CoverageLexicalV3FileSearchEngine } from "src/services/search/coverage-lexical-v3/file-search-engine";
import type { CoverageLexicalV3SearchResult } from "src/services/search/coverage-lexical-v3/engine";
import type { ResidentBase } from "src/services/search/coverage-lexical-v3/layout/types";
import type {
	BodyWindowContainer,
	EvidencePackingProfile,
} from "src/services/search/coverage-lexical-v3/ranking/types";
import { container } from "tsyringe";

const { Tokenizer } = jest.requireMock("src/services/search/tokenizer") as {
	Tokenizer: new () => unknown;
};

function createDocument(
	overrides: Partial<IndexedDocument> &
		Pick<IndexedDocument, "path" | "basename" | "folder">,
): IndexedDocument {
	return {
		path: overrides.path,
		basename: overrides.basename,
		folder: overrides.folder,
		content: overrides.content,
		aliases: overrides.aliases,
		tags: overrides.tags,
		headings: overrides.headings,
		generation: overrides.generation,
		size: overrides.size,
	};
}

function createBodyWindowContainer(blockIds: readonly number[]): BodyWindowContainer {
	return {
		tier: "bodyWindow",
		blockIds,
		boundaryCrossingCount: Math.max(0, blockIds.length - 1),
		coveredUnitIndices: [0],
		coveredDistinctUnitCount: 1,
		containerCompactness: 260,
		exactUnitCount: 1,
		windowWidth: 1,
		gapCount: 0,
		density: 1,
		headingCorroboration: {
			coveredUnitIndices: [],
			unitCount: 0,
		},
	};
}

function createPackingProfile(
	overrides: Partial<EvidencePackingProfile> &
		Pick<EvidencePackingProfile, "docId" | "path">,
): EvidencePackingProfile {
	return {
		docId: overrides.docId,
		path: overrides.path,
		stableKey: overrides.stableKey ?? overrides.path,
		surfaceCoverageShapeKey: overrides.surfaceCoverageShapeKey ?? "h",
		realizedCoverageCount: overrides.realizedCoverageCount ?? 1,
		coverageGate: overrides.coverageGate ?? {
			realizedCoverageCount: overrides.realizedCoverageCount ?? 1,
			fullySatisfiedSurfaceGroupCount: 1,
			startedSurfaceGroupCount: 1,
			crossScriptSatisfiedGroupCount: 1,
		},
		exactUnitCount: overrides.exactUnitCount ?? 1,
		completedHanSurfaceGroupCount: overrides.completedHanSurfaceGroupCount ?? 1,
		hanSurfaceCompletionTierScoreTotal:
			overrides.hanSurfaceCompletionTierScoreTotal ?? 1,
		strongestHanSurfaceCompletionTier:
			overrides.strongestHanSurfaceCompletionTier ?? "body_residue",
		hanSurfaceCompletionGroups: overrides.hanSurfaceCompletionGroups ?? [
			{
				surfaceGroupIndex: 0,
				surfaceText: "lifeforce",
				tier: "body_residue",
			},
		],
		prefixCompletionGainTotal: overrides.prefixCompletionGainTotal ?? 0,
		compoundPrefixCount: overrides.compoundPrefixCount ?? 0,
		realizedFamilies: overrides.realizedFamilies ?? [
			{
				queryUnitIndex: 0,
				queryUnitText: "life",
				familyId: 0,
				familyText: "life",
				matchKind: "exact",
				inIdentity: false,
				inRoute: false,
				inHeading: false,
				inBestBodyWindow: true,
				inBodyResidue: false,
			},
		],
		identityContainer: overrides.identityContainer ?? null,
		routeContainer: overrides.routeContainer ?? null,
		bodyWindowContainer: overrides.bodyWindowContainer ?? createBodyWindowContainer([0]),
		strongestContainer: overrides.strongestContainer ?? createBodyWindowContainer([0]),
		secondStrongestContainer: overrides.secondStrongestContainer ?? null,
		fragmentationPenalty:
			overrides.fragmentationPenalty ?? {
				bodyResidueUnitCount: 0,
				uncoveredByTopTwoCount: 0,
				activeContainerCount: 1,
			},
	};
}

function createRefineSearchResult(): CoverageLexicalV3SearchResult {
	const shorterTerm = "缓存恢复";
	const fullSurface = "缓存恢复步骤";
	const laterPath = createPackingProfile({
		docId: 0,
		path: "z-complete.md",
		bodyWindowContainer: createBodyWindowContainer([0]),
		strongestContainer: createBodyWindowContainer([0]),
	});
	const earlierPath = createPackingProfile({
		docId: 1,
		path: "a-partial.md",
		bodyWindowContainer: createBodyWindowContainer([2]),
		strongestContainer: createBodyWindowContainer([2]),
	});
	return {
		recallState: {
			queryAnalysis: {
				queryText: fullSurface,
				normalizedQueryText: fullSurface,
				surfaceGroups: [{ index: 0, text: fullSurface, kind: "han" }],
				primaryUnits: [
					{
						index: 0,
						text: shorterTerm,
						source: "han_tokenizer_real",
						surfaceGroupIndex: 0,
					},
				],
				hanBackstopGroups: [],
				surfaceCoverageShapeKey: "h",
			},
			unitFamilyMatches: [],
			candidateDocs: [
				{
					docId: 0,
					matchedIdentityUnitIndices: [],
					matchedRouteUnitIndices: [],
					matchedHeadingUnitIndices: [],
					shortlistedBodyBlockIds: [0, 1],
					hanMetadataGateStats: null,
					hanBodyBlockGateStats: [
						{
							blockId: 1,
							stats: {
								matchedBigramCount: 1,
								longestContiguousBigramChain: 1,
								bigramCoverageRatio: 1,
							},
						},
					],
				},
				{
					docId: 1,
					matchedIdentityUnitIndices: [],
					matchedRouteUnitIndices: [],
					matchedHeadingUnitIndices: [],
					shortlistedBodyBlockIds: [2],
					hanMetadataGateStats: null,
					hanBodyBlockGateStats: [
						{
							blockId: 2,
							stats: {
								matchedBigramCount: 1,
								longestContiguousBigramChain: 1,
								bigramCoverageRatio: 1,
							},
						},
					],
				},
			],
		},
		rankedCandidates: [earlierPath, laterPath],
	};
}

function createResidentBase(): ResidentBase {
	return {
		version: 1,
		stringArena: {
			text: "",
			offsets: new Uint32Array(),
			lengths: new Uint32Array(),
			count: 0,
		},
		docTable: {
			docCount: 2,
			pathStringIds: new Uint32Array([0, 0]),
			generationByDocId: new Uint32Array([101, 202]),
			identityStartByDocId: new Uint32Array([0, 0]),
			identityCountByDocId: new Uint32Array([0, 0]),
			routeStartByDocId: new Uint32Array([0, 0]),
			routeCountByDocId: new Uint32Array([0, 0]),
			headingStartByDocId: new Uint32Array([0, 0]),
			headingCountByDocId: new Uint32Array([0, 0]),
			bodyBlockStartByDocId: new Uint32Array([0, 2]),
			bodyBlockCountByDocId: new Uint32Array([2, 1]),
		},
		familyLexicon: {
			familyCount: 0,
			familyStringIds: new Uint32Array(),
			familyFlagsByFamilyId: new Uint8Array(),
		},
		metadataContainers: {
			identityFamiliesByDoc: new Uint32Array(),
			routeFamiliesByDoc: new Uint32Array(),
			headingFamiliesByDoc: new Uint32Array(),
			identityPostings: {
				postingStarts: new Uint32Array(),
				docIds: new Uint32Array(),
			},
			routePostings: {
				postingStarts: new Uint32Array(),
				docIds: new Uint32Array(),
			},
			headingPostings: {
				postingStarts: new Uint32Array(),
				docIds: new Uint32Array(),
			},
		},
		bodySummary: {
			familyIds: new Uint32Array(),
			postingStarts: new Uint32Array(),
			blockIds: new Uint32Array(),
		},
		bodyBlocks: {
			blockCount: 3,
			docIdByBlockId: new Uint32Array([0, 0, 1]),
			blockOrdinalByBlockId: new Uint32Array([0, 1, 0]),
			exactTapeStartByBlockId: new Uint32Array([0, 0, 0]),
			exactTapeCountByBlockId: new Uint32Array([0, 0, 0]),
		},
		exactTapes: {
			familyIds: new Uint32Array(),
		},
		hanRoute: {
			bigramIds: new Uint32Array(),
			metadataPostingStarts: new Uint32Array(),
			metadataDocIds: new Uint32Array(),
			bodyPostingStarts: new Uint32Array(),
			bodyBlockIds: new Uint32Array(),
			identityWitnessStartByDocId: new Uint32Array(),
			identityWitnessStringIds: new Uint32Array(),
			routeWitnessStartByDocId: new Uint32Array(),
			routeWitnessStringIds: new Uint32Array(),
			headingWitnessStartByDocId: new Uint32Array(),
			headingWitnessStringIds: new Uint32Array(),
			bodyWitnessStartByBlockId: new Uint32Array(),
			bodyWitnessStringIds: new Uint32Array(),
		},
		metrics: {
			docArenaBytes: 0,
			stringArenaBytes: 0,
			familyLexiconBytes: 0,
			metadataContainerBytes: 0,
			headingBytes: 0,
			bodySummaryBytes: 0,
			bodyBlockBytes: 0,
			exactTapeBytes: 0,
			hanRouteBytes: 0,
			hanRouteMetadataHanPostingsBytes: 0,
			hanRouteBodyHanPostingsBytes: 0,
			hanRouteMetadataWitnessBytes: 0,
			hanRouteBodyWitnessBytes: 0,
			scaffoldBytes: 0,
			countBytes: 0,
			idPayloadBytes: 0,
			stringPayloadBytes: 0,
			auxiliaryBytes: 0,
			residentBytes: 0,
			indexedSurfaceUtf8Bytes: 0,
			rawMarkdownUtf8Bytes: 0,
			"residentBytes / indexedSurfaceUtf8Bytes": 0,
			"residentBytes / rawMarkdownUtf8Bytes": 0,
		},
	};
}

function createResidentBaseForBlockCounts(
	blockCountsByDoc: readonly number[],
): ResidentBase {
	const base = createResidentBase();
	let blockStart = 0;
	const bodyBlockStartByDocId: number[] = [];
	const bodyBlockCountByDocId: number[] = [];
	const docIdByBlockId: number[] = [];
	const blockOrdinalByBlockId: number[] = [];
	for (let docId = 0; docId < blockCountsByDoc.length; docId += 1) {
		bodyBlockStartByDocId.push(blockStart);
		bodyBlockCountByDocId.push(blockCountsByDoc[docId]);
		for (let ordinal = 0; ordinal < blockCountsByDoc[docId]; ordinal += 1) {
			docIdByBlockId.push(docId);
			blockOrdinalByBlockId.push(ordinal);
		}
		blockStart += blockCountsByDoc[docId];
	}
	return {
		...base,
		docTable: {
			...base.docTable,
			docCount: blockCountsByDoc.length,
			pathStringIds: new Uint32Array(blockCountsByDoc.map(() => 0)),
			generationByDocId: new Uint32Array(blockCountsByDoc.map((_, index) => 100 + index)),
			identityStartByDocId: new Uint32Array(blockCountsByDoc.map(() => 0)),
			identityCountByDocId: new Uint32Array(blockCountsByDoc.map(() => 0)),
			routeStartByDocId: new Uint32Array(blockCountsByDoc.map(() => 0)),
			routeCountByDocId: new Uint32Array(blockCountsByDoc.map(() => 0)),
			headingStartByDocId: new Uint32Array(blockCountsByDoc.map(() => 0)),
			headingCountByDocId: new Uint32Array(blockCountsByDoc.map(() => 0)),
			bodyBlockStartByDocId: new Uint32Array(bodyBlockStartByDocId),
			bodyBlockCountByDocId: new Uint32Array(bodyBlockCountByDocId),
		},
		bodyBlocks: {
			...base.bodyBlocks,
			blockCount: blockStart,
			docIdByBlockId: new Uint32Array(docIdByBlockId),
			blockOrdinalByBlockId: new Uint32Array(blockOrdinalByBlockId),
			exactTapeStartByBlockId: new Uint32Array(Array.from({ length: blockStart }, () => 0)),
			exactTapeCountByBlockId: new Uint32Array(Array.from({ length: blockStart }, () => 0)),
		},
	};
}

function createBlockText(
	blockCount: number,
	surfaceText: string,
	surfaceBlockOrdinals: readonly number[] = [],
): string {
	const surfaceBlocks = new Set(surfaceBlockOrdinals);
	return Array.from({ length: blockCount }, (_, ordinal) =>
		surfaceBlocks.has(ordinal)
			? surfaceText + " block-" + ordinal
			: "block-" + ordinal,
	).join("\n\n");
}

async function runHanRefine(
	result: CoverageLexicalV3SearchResult,
	options: {
		indexedTexts: Map<string, string>;
		residentBase?: ResidentBase;
	},
): Promise<readonly EvidencePackingProfile[]> {
	const engine = new CoverageLexicalV3FileSearchEngine();
	const residentBase = options.residentBase ?? createResidentBase();
	const readIndexedTexts = jest.fn(async () => options.indexedTexts);
	(
		engine as unknown as {
			engine: {
				search: () => CoverageLexicalV3SearchResult;
				getResidentBase: () => ResidentBase;
			};
			getFileSnapshotStore: () => {
				readIndexedTexts: typeof readIndexedTexts;
				readCurrentTexts: jest.Mock;
			};
		}
	).engine = {
		search: () => result,
		getResidentBase: () => residentBase,
	};
	(
		engine as unknown as {
			getFileSnapshotStore: () => {
				readIndexedTexts: typeof readIndexedTexts;
				readCurrentTexts: jest.Mock;
			};
		}
	).getFileSnapshotStore = () => ({
		readIndexedTexts,
		readCurrentTexts: jest.fn(),
	});
	return await (engine as unknown as {
		refineHanSurfaceCompletion: (
			searchResult: CoverageLexicalV3SearchResult,
		) => Promise<readonly EvidencePackingProfile[]>;
	}).refineHanSurfaceCompletion(result);
}

describe("coverage lexical v3 file search engine", () => {
	beforeEach(() => {
		container.registerInstance(
			Tokenizer,
			{
				tokenizeSequence: (text: string) =>
					text
						.toLowerCase()
						.split(/\s+/u)
						.map((token) => token.trim())
						.filter((token) => token.length > 0),
			} as unknown as Tokenizer,
		);
	});

	test("reIndexAll builds a searchable runtime index", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "infra/projected-token.md",
				basename: "projected token runtime access",
				folder: "infra/kubernetes",
				content: "Projected token runtime access in pod.",
			}),
			createDocument({
				path: "infra/other.md",
				basename: "runtime note",
				folder: "infra",
				content: "misc runtime note",
			}),
		]);

		const matchedFiles = await engine.searchFiles({
			queryText: "projected token runtime access",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(matchedFiles[0]?.path).toBe("infra/projected-token.md");
		expect(matchedFiles[0]?.queryTerms).toEqual([
			"projected",
			"token",
			"runtime",
			"access",
		]);
		expect(matchedFiles[0]?.matchedTerms).toContain("projected");
	});

	test("getDirectSubItems uses V3 query analysis with indexed snapshots", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		const shorterTerm = "缓存恢复";
		const fullSurface = "缓存恢复步骤";
		await engine.reIndexAll([
			createDocument({
				path: "notes/lifeforce.md",
				basename: "life note",
				folder: "notes",
				generation: 101,
				content: "placeholder",
			}),
		]);
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: {
					queryText: fullSurface,
					normalizedQueryText: fullSurface,
					surfaceGroups: [{ index: 0, text: fullSurface, kind: "han" }],
					primaryUnits: [
						{
							index: 0,
							text: shorterTerm,
							source: "han_tokenizer_real",
							surfaceGroupIndex: 0,
						},
					],
					hanBackstopGroups: [],
					surfaceCoverageShapeKey: "h",
				},
				unitFamilyMatches: [],
				candidateDocs: [
					{
						docId: 0,
						matchedIdentityUnitIndices: [],
						matchedRouteUnitIndices: [],
						matchedHeadingUnitIndices: [],
						shortlistedBodyBlockIds: [0, 1],
						hanMetadataGateStats: null,
						hanBodyBlockGateStats: [],
					},
				],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "notes/lifeforce.md",
					bodyWindowContainer: createBodyWindowContainer([0]),
					strongestContainer: createBodyWindowContainer([0]),
					hanSurfaceCompletionGroups: [
						{
							surfaceGroupIndex: 0,
							surfaceText: fullSurface,
							tier: "body_window",
						},
					],
					completedHanSurfaceGroupCount: 1,
					hanSurfaceCompletionTierScoreTotal: 2,
					strongestHanSurfaceCompletionTier: "body_window",
				}),
			],
		}));
		const readIndexedTexts = jest.fn(async () =>
			new Map([["notes/lifeforce.md", "缓存恢复步骤\n\n热启动恢复记录。"]]),
		);
		const readCurrentTexts = jest.fn();
		(
			engine as unknown as {
				engine: {
					search: typeof search;
					getResidentBase: () => ResidentBase;
				};
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: typeof readCurrentTexts;
				};
			}
		).engine = {
			search,
			getResidentBase: () => createResidentBaseForBlockCounts([2]),
		};
		(
			engine as unknown as {
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: typeof readCurrentTexts;
				};
			}
		).getFileSnapshotStore = () => ({
			readIndexedTexts,
			readCurrentTexts,
		});

		const subItems = await engine.getDirectSubItems(fullSurface, "notes/lifeforce.md", 3);

		expect(subItems).not.toBeNull();
		expect(subItems?.length).toBeGreaterThan(0);
		const snippet = subItems?.[0]?.snippet ?? subItems?.[0]?.text ?? "";
		expect(snippet).toContain(fullSurface);
		const highlightTexts = subItems?.[0]?.highlightRanges?.map((range) =>
			(subItems?.[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		expect(highlightTexts?.length ?? 0).toBeGreaterThan(0);
		expect(readIndexedTexts).toHaveBeenCalledWith([
			{ path: "notes/lifeforce.md", generation: 100 },
		]);
		expect(readCurrentTexts).not.toHaveBeenCalled();
	});

	test("getDirectSubItems highlights a full Han surface instead of only the shorter real term", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		const shorterTerm = "缓存恢复";
		const fullSurface = "缓存恢复步骤";
		await engine.reIndexAll([
			createDocument({
				path: "notes/life-force.md",
				basename: "life force",
				folder: "notes",
				generation: 101,
				content: "placeholder",
			}),
		]);
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: {
					queryText: fullSurface,
					normalizedQueryText: fullSurface,
					surfaceGroups: [{ index: 0, text: fullSurface, kind: "han" }],
					primaryUnits: [
						{
							index: 0,
							text: shorterTerm,
							source: "han_tokenizer_real",
							surfaceGroupIndex: 0,
						},
					],
					hanBackstopGroups: [],
					surfaceCoverageShapeKey: "h",
				},
				unitFamilyMatches: [],
				candidateDocs: [
					{
						docId: 0,
						matchedIdentityUnitIndices: [],
						matchedRouteUnitIndices: [],
						matchedHeadingUnitIndices: [],
						shortlistedBodyBlockIds: [0, 1],
						hanMetadataGateStats: null,
						hanBodyBlockGateStats: [],
					},
				],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "notes/life-force.md",
					bodyWindowContainer: createBodyWindowContainer([0]),
					strongestContainer: createBodyWindowContainer([0]),
					hanSurfaceCompletionGroups: [
						{
							surfaceGroupIndex: 0,
							surfaceText: fullSurface,
							tier: "body_residue",
						},
					],
					completedHanSurfaceGroupCount: 1,
					hanSurfaceCompletionTierScoreTotal: 1,
					strongestHanSurfaceCompletionTier: "body_residue",
				}),
			],
		}));
		const readIndexedTexts = jest.fn(async () =>
			new Map([["notes/life-force.md", "缓存恢复步骤说明\n\n缓存恢复步骤用于热启动恢复。"]]),
		);
		(
			engine as unknown as {
				engine: {
					search: typeof search;
					getResidentBase: () => ResidentBase;
				};
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
				};
			}
		).engine = {
			search,
			getResidentBase: () => createResidentBaseForBlockCounts([2]),
		};
		(
			engine as unknown as {
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
				};
			}
		).getFileSnapshotStore = () => ({
			readIndexedTexts,
		});

		const subItems = await engine.getDirectSubItems(fullSurface, "notes/life-force.md", 3);

		expect(subItems).not.toBeNull();
		const highlightTexts = subItems?.[0]?.highlightRanges?.map((range) =>
			(subItems?.[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		expect(highlightTexts).toContain(fullSurface);
		expect(highlightTexts).not.toContain(shorterTerm);
	});

	
	test("getDirectSubItems falls back to current text when generation-aligned indexed text is unavailable", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		const shorterTerm = "缓存恢复";
		const fullSurface = "缓存恢复步骤";
		await engine.reIndexAll([
			createDocument({
				path: "notes/missing-snapshot.md",
				basename: "note",
				folder: "notes",
				generation: 101,
				content: "placeholder",
			}),
		]);
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: {
					queryText: fullSurface,
					normalizedQueryText: fullSurface,
					surfaceGroups: [{ index: 0, text: fullSurface, kind: "han" }],
					primaryUnits: [
						{
							index: 0,
							text: shorterTerm,
							source: "han_tokenizer_real",
							surfaceGroupIndex: 0,
						},
					],
					hanBackstopGroups: [],
					surfaceCoverageShapeKey: "h",
				},
				unitFamilyMatches: [],
				candidateDocs: [
					{
						docId: 0,
						matchedIdentityUnitIndices: [],
						matchedRouteUnitIndices: [],
						matchedHeadingUnitIndices: [],
						shortlistedBodyBlockIds: [0],
						hanMetadataGateStats: null,
						hanBodyBlockGateStats: [],
					},
				],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "notes/missing-snapshot.md",
					bodyWindowContainer: createBodyWindowContainer([0]),
					strongestContainer: createBodyWindowContainer([0]),
					hanSurfaceCompletionGroups: [
						{
							surfaceGroupIndex: 0,
							surfaceText: fullSurface,
							tier: "body_residue",
						},
					],
					completedHanSurfaceGroupCount: 1,
					hanSurfaceCompletionTierScoreTotal: 1,
					strongestHanSurfaceCompletionTier: "body_residue",
				}),
			],
		}));
		const readIndexedTexts = jest.fn(async () => new Map<string, string>());
		const readCurrentTexts = jest.fn(async () =>
			new Map([["notes/missing-snapshot.md", "缓存恢复步骤\n\n回放检查与热启动恢复。"]]),
		);
		(
			engine as unknown as {
				engine: {
					search: typeof search;
					getResidentBase: () => ResidentBase;
				};
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: typeof readCurrentTexts;
				};
			}
		).engine = {
			search,
			getResidentBase: () => createResidentBaseForBlockCounts([1]),
		};
		(
			engine as unknown as {
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: typeof readCurrentTexts;
				};
			}
		).getFileSnapshotStore = () => ({
			readIndexedTexts,
			readCurrentTexts,
		});

		const subItems = await engine.getDirectSubItems(fullSurface, "notes/missing-snapshot.md", 3);

		expect(subItems).not.toBeNull();
		expect(readCurrentTexts).toHaveBeenCalledWith(["notes/missing-snapshot.md"]);
		const highlightTexts = subItems?.[0]?.highlightRanges?.map((range) =>
			(subItems?.[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		expect(highlightTexts).toContain(fullSurface);
		expect(highlightTexts).not.toContain(shorterTerm);
	});

test("searchFiles passes tokenizer query terms into engine.search", async () => {
		const tokenizeSequence = jest.fn((text: string, mode?: "index" | "search") => {
			if (text === "systemproxy" && mode === "search") {
				return ["system", "proxy"];
			}
			return text
				.toLowerCase()
				.split(/\s+/u)
				.map((token) => token.trim())
				.filter((token) => token.length > 0);
		});
		container.registerInstance(
			Tokenizer,
			{ tokenizeSequence } as unknown as Tokenizer,
		);
		const engine = new CoverageLexicalV3FileSearchEngine();
		const shorterTerm = "缓存恢复";
		const fullSurface = "缓存恢复步骤";
		await engine.reIndexAll([
			createDocument({
				path: "zh/split-hit.md",
				basename: "system",
				folder: "zh",
				content: "proxy",
			}),
		]);
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: {
					queryText: fullSurface,
					normalizedQueryText: fullSurface,
					surfaceGroups: [{ index: 0, text: fullSurface, kind: "han" }],
					primaryUnits: [
						{
							index: 0,
							text: shorterTerm,
							source: "han_tokenizer_real",
							surfaceGroupIndex: 0,
						},
					],
					hanBackstopGroups: [],
					surfaceCoverageShapeKey: "h",
				},
				unitFamilyMatches: [],
				candidateDocs: [],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "partial.md",
					coverageGate: {
						realizedCoverageCount: 1,
						fullySatisfiedSurfaceGroupCount: 1,
						startedSurfaceGroupCount: 1,
						crossScriptSatisfiedGroupCount: 1,
					},
					hanSurfaceCompletionGroups: [
						{ surfaceGroupIndex: 0, surfaceText: fullSurface, tier: "none" },
					],
					completedHanSurfaceGroupCount: 0,
					hanSurfaceCompletionTierScoreTotal: 0,
					strongestHanSurfaceCompletionTier: "none",
				}),
				createPackingProfile({
					docId: 1,
					path: "complete.md",
					coverageGate: {
						realizedCoverageCount: 1,
						fullySatisfiedSurfaceGroupCount: 1,
						startedSurfaceGroupCount: 1,
						crossScriptSatisfiedGroupCount: 1,
					},
					hanSurfaceCompletionGroups: [
						{ surfaceGroupIndex: 0, surfaceText: fullSurface, tier: "body_residue" },
					],
					completedHanSurfaceGroupCount: 1,
					hanSurfaceCompletionTierScoreTotal: 1,
					strongestHanSurfaceCompletionTier: "body_residue",
				}),
			],
		}));
		(engine as unknown as {
			engine: {
				search: typeof search;
				getResidentBase: () => ResidentBase | null;
			};
		}).engine = {
			search,
			getResidentBase: () => null,
		};

		const matchedFiles = await engine.searchFiles({
			queryText: "systemproxy",
			isPrefixMatch: true,
			isFuzzy: false,
			hideWeaklyRelatedResults: false,
			maxItemResults: 5,
		});

		expect(tokenizeSequence).toHaveBeenCalledWith("systemproxy", "search");
		expect(matchedFiles.map((file) => file.path)).toEqual(["complete.md", "partial.md"]);
	});

	test("searchFiles hides same-band Han partials when weak results are hidden", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		const shorterTerm = "缓存恢复";
		const fullSurface = "缓存恢复步骤";
		await engine.reIndexAll([
			createDocument({
				path: "partial.md",
				basename: "partial",
				folder: "notes",
				content: "缓存恢复",
			}),
			createDocument({
				path: "complete.md",
				basename: "complete",
				folder: "notes",
				content: "缓存恢复步骤",
			}),
		]);
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: {
					queryText: fullSurface,
					normalizedQueryText: fullSurface,
					surfaceGroups: [{ index: 0, text: fullSurface, kind: "han" }],
					primaryUnits: [
						{
							index: 0,
							text: shorterTerm,
							source: "han_tokenizer_real",
							surfaceGroupIndex: 0,
						},
					],
					hanBackstopGroups: [],
					surfaceCoverageShapeKey: "h",
				},
				unitFamilyMatches: [],
				candidateDocs: [],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "partial.md",
					coverageGate: {
						realizedCoverageCount: 1,
						fullySatisfiedSurfaceGroupCount: 1,
						startedSurfaceGroupCount: 1,
						crossScriptSatisfiedGroupCount: 1,
					},
					hanSurfaceCompletionGroups: [
						{ surfaceGroupIndex: 0, surfaceText: fullSurface, tier: "none" },
					],
					completedHanSurfaceGroupCount: 0,
					hanSurfaceCompletionTierScoreTotal: 0,
					strongestHanSurfaceCompletionTier: "none",
				}),
				createPackingProfile({
					docId: 1,
					path: "complete.md",
					coverageGate: {
						realizedCoverageCount: 1,
						fullySatisfiedSurfaceGroupCount: 1,
						startedSurfaceGroupCount: 1,
						crossScriptSatisfiedGroupCount: 1,
					},
					hanSurfaceCompletionGroups: [
						{ surfaceGroupIndex: 0, surfaceText: fullSurface, tier: "body_window" },
					],
					completedHanSurfaceGroupCount: 1,
					hanSurfaceCompletionTierScoreTotal: 2,
					strongestHanSurfaceCompletionTier: "body_window",
				}),
			],
		}));
		(engine as unknown as {
			engine: {
				search: typeof search;
				getResidentBase: () => ResidentBase | null;
			};
		}).engine = {
			search,
			getResidentBase: () => null,
		};

		const visible = await engine.searchFiles({
			queryText: fullSurface,
			isPrefixMatch: true,
			isFuzzy: false,
			hideWeaklyRelatedResults: true,
			maxItemResults: 5,
		});

		expect(visible.map((file) => file.path)).toEqual(["complete.md"]);
	});

	test("searchFiles keeps weak witness order when indexed snapshots are unavailable", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "z-complete.md",
				basename: "note",
				folder: "zh",
				generation: 101,
				content: "placeholder",
			}),
			createDocument({
				path: "a-partial.md",
				basename: "note",
				folder: "zh",
				generation: 202,
				content: "placeholder",
			}),
		]);
		const readIndexedTexts = jest.fn(async () => new Map<string, string>());
		const readCurrentTexts = jest.fn();
		(
			engine as unknown as {
				engine: {
					search: () => CoverageLexicalV3SearchResult;
					getResidentBase: () => ResidentBase;
				};
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: typeof readCurrentTexts;
				};
			}
		).engine = {
			search: () => createRefineSearchResult(),
			getResidentBase: () => createResidentBase(),
		};
		(
			engine as unknown as {
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: typeof readCurrentTexts;
				};
			}
		).getFileSnapshotStore = () => ({
			readIndexedTexts,
			readCurrentTexts,
		});

		const matchedFiles = await engine.searchFiles({
			queryText: "lifeforce",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(matchedFiles.map((file) => file.path)).toEqual([
			"a-partial.md",
			"z-complete.md",
		]);
		expect(readCurrentTexts).not.toHaveBeenCalled();
	});
	test("searchFiles skips raw Han refine when no near-tie risk exists", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "single.md",
				basename: "note",
				folder: "zh",
				content: "placeholder",
			}),
		]);
		const readIndexedTexts = jest.fn(async () => new Map<string, string>());
		(
			engine as unknown as {
				engine: {
					search: () => CoverageLexicalV3SearchResult;
					getResidentBase: () => ResidentBase;
				};
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: jest.Mock;
				};
			}
		).engine = {
			search: () => ({
				recallState: {
					queryAnalysis: {
					queryText: "缂撳瓨鎭㈠",
					normalizedQueryText: "缂撳瓨鎭㈠",
					surfaceGroups: [{ index: 0, text: "缂撳瓨鎭㈠", kind: "han" }],
					primaryUnits: [
						{
							index: 0,
							text: "缂撳瓨鎭㈠",
							source: "han_tokenizer_real",
							surfaceGroupIndex: 0,
						},
					],
					hanBackstopGroups: [],
					surfaceCoverageShapeKey: "h",
				},
					unitFamilyMatches: [],
					candidateDocs: [{
						docId: 0,
						matchedIdentityUnitIndices: [],
						matchedRouteUnitIndices: [],
						matchedHeadingUnitIndices: [],
						shortlistedBodyBlockIds: [0],
						hanMetadataGateStats: null,
						hanBodyBlockGateStats: [],
					}],
				},
				rankedCandidates: [createPackingProfile({ docId: 0, path: "single.md" })],
			}),
			getResidentBase: () => createResidentBase(),
		};
		(
			engine as unknown as {
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: jest.Mock;
				};
			}
		).getFileSnapshotStore = () => ({
			readIndexedTexts,
			readCurrentTexts: jest.fn(),
		});

		await engine.searchFiles({
			queryText: "lifeforce",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(readIndexedTexts).not.toHaveBeenCalled();
	});

	test("raw Han refine promotes best-window surface confirms above residue confirms", async () => {
		const result: CoverageLexicalV3SearchResult = {
			recallState: createRefineSearchResult().recallState,
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "b-residue.md",
					bodyWindowContainer: createBodyWindowContainer([1]),
					strongestContainer: createBodyWindowContainer([1]),
				}),
				createPackingProfile({
					docId: 1,
					path: "a-window.md",
					bodyWindowContainer: createBodyWindowContainer([2]),
					strongestContainer: createBodyWindowContainer([2]),
				}),
			],
		};
		const residentBase = createResidentBase();
		const refined = await runHanRefine(result, {
			residentBase,
			indexedTexts: new Map<string, string>([
				["b-residue.md", "lifeforce block-0"],
				["a-window.md", "lifeforce block-0"],
			]),
		});

		expect(refined.map((candidate) => candidate.path)).toEqual([
			"a-window.md",
			"b-residue.md",
		]);
		expect(refined[0].strongestHanSurfaceCompletionTier).toBe("body_window");
		expect(refined[1].strongestHanSurfaceCompletionTier).toBe("body_residue");
	});

	test("raw Han refine respects query-wide block budget", async () => {
		const blockCounts = [100, 100, 100, 100, 100] as const;
		const residentBase = createResidentBaseForBlockCounts(blockCounts);
		const candidateDocs = blockCounts.map((blockCount, docId) => ({
			docId,
			matchedIdentityUnitIndices: [],
			matchedRouteUnitIndices: [],
			matchedHeadingUnitIndices: [],
			shortlistedBodyBlockIds: Array.from({ length: blockCount }, (_, ordinal) =>
				residentBase.docTable.bodyBlockStartByDocId[docId] + ordinal,
			),
			hanMetadataGateStats: null,
			hanBodyBlockGateStats: [],
		}));
		const rankedCandidates = blockCounts.map((_, docId) =>
			createPackingProfile({
				docId,
				path: String.fromCharCode(97 + docId) + ".md",
				bodyWindowContainer: createBodyWindowContainer([residentBase.docTable.bodyBlockStartByDocId[docId]]),
				strongestContainer: createBodyWindowContainer([residentBase.docTable.bodyBlockStartByDocId[docId]]),
			}),
		);
		const result: CoverageLexicalV3SearchResult = {
			recallState: {
				...createRefineSearchResult().recallState,
				candidateDocs,
			},
			rankedCandidates,
		};
		const indexedTexts = new Map<string, string>(
			rankedCandidates.map((candidate) => [
				candidate.path,
				createBlockText(100, "lifeforce", [0]),
			]),
		);
		const refined = await runHanRefine(result, { residentBase, indexedTexts });

		expect(refined.slice(0, 4).every((candidate) => candidate.strongestHanSurfaceCompletionTier === "body_window")).toBe(true);
		expect(refined[4].strongestHanSurfaceCompletionTier).toBe("body_residue");
	});
});



