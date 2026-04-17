jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

import type { IndexedDocument } from "src/globals/search-types";
import { CoverageLexicalV3FileSearchEngine } from "src/services/search/coverage-lexical-v3/file-search-engine";
import type { CoverageLexicalV3SearchResult } from "src/services/search/coverage-lexical-v3/engine";
import type { ResidentBase } from "src/services/search/coverage-lexical-v3/layout/types";
import { buildBlockPositionLane } from "src/services/search/coverage-lexical-v3/layout/position-lanes";
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
			generation: overrides.generation ?? 1,
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
		hanStrongRescueGroupCount: overrides.hanStrongRescueGroupCount ?? 0,
		hanWeakRescueGroupCount: overrides.hanWeakRescueGroupCount ?? 0,
		hanRescueSupportWeightTotal: overrides.hanRescueSupportWeightTotal ?? 0,
		hasOnlyWeakHanRescue: overrides.hasOnlyWeakHanRescue ?? false,
		hasAnyHanRescueAssessment: overrides.hasAnyHanRescueAssessment ?? false,
		hanRescueAssessments: overrides.hanRescueAssessments ?? [],
		prefixCompletionGainTotal: overrides.prefixCompletionGainTotal ?? 0,
		compoundPrefixCount: overrides.compoundPrefixCount ?? 0,
		realizedFamilies: overrides.realizedFamilies ?? [
			{
				queryUnitIndex: 0,
				queryUnitText: "life",
				querySurfaceGroupIndex: 0,
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
				explanatoryContainerCount: 1,
			},
	};
}

function createHanSurfaceGroup(index: number, text: string) {
	const chars = Array.from(text);
	const hanBigramTexts = chars.slice(0, -1).map((_, charIndex) => {
		return chars[charIndex] + chars[charIndex + 1];
	});
	return {
		index,
		text,
		kind: "han" as const,
		hanBigramTexts,
		coveredCharMask: Array.from({ length: chars.length }, () => false),
		queryResidualUniqueBigrams: hanBigramTexts,
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
				surfaceGroups: [createHanSurfaceGroup(0, fullSurface)],
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
				generationByDocId: new Float64Array([101, 202]),
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
		bodyFamilyPosting: {
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
			positionEncodingByBlockId: new Uint8Array(),
			positionStartByBlockId: new Uint32Array(),
			positionDeltaU8Tape: new Uint8Array(),
			positionDeltaU16Tape: new Uint16Array(),
			positionDeltaU32Tape: new Uint32Array(),
		},
		hanRoute: {
			bigramIds: new Uint32Array(),
			bodyBigramIds: new Uint32Array(),
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
			bodyWitnessOccurrenceStartByBlockId: new Uint32Array(),
			bodyWitnessOccurrenceStringIds: new Uint32Array(),
			bodyWitnessPositionEncodingByBlockId: new Uint8Array(),
			bodyWitnessPositionStartByBlockId: new Uint32Array(),
			bodyWitnessPositionDeltaU8Tape: new Uint8Array(),
			bodyWitnessPositionDeltaU16Tape: new Uint16Array(),
			bodyWitnessPositionDeltaU32Tape: new Uint32Array(),
		},
		metrics: {
			docArenaBytes: 0,
			stringArenaBytes: 0,
			stringArenaPathBytes: 0,
			stringArenaFamilyBytes: 0,
			stringArenaIdentityWitnessBytes: 0,
			stringArenaRouteWitnessBytes: 0,
			stringArenaHeadingWitnessBytes: 0,
			stringArenaBodyWitnessBytes: 0,
			stringArenaMultiSourceBytes: 0,
			stringArenaUnattributedBytes: 0,
			familyLexiconBytes: 0,
			metadataContainerBytes: 0,
			headingBytes: 0,
			familyPostingBytes: 0,
			bodyBlockBytes: 0,
			exactTapeBytes: 0,
			hanRouteBytes: 0,
			hanRouteSharedBigramIdsBytes: 0,
			hanRouteMetadataHanPostingsBytes: 0,
			hanRouteMetadataHanPostingStartsBytes: 0,
			hanRouteMetadataHanDocIdsBytes: 0,
			hanRouteBodyHanPostingsBytes: 0,
			hanRouteBodyBigramIdsBytes: 0,
			hanRouteBodyHanPostingStartsBytes: 0,
			hanRouteBodyHanBodyBlockIdsBytes: 0,
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
				generationByDocId: new Float64Array(blockCountsByDoc.map((_, index) => 100 + index)),
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

function withBodyWitnessTexts(
	base: ResidentBase,
	bodyWitnessTextsByBlock: ReadonlyArray<readonly string[]>,
): ResidentBase {
	const uniqueStrings = new Map<string, number>([["", 0]]);
	const orderedStrings = [""];
	const bodyWitnessOccurrenceStartByBlockId: number[] = [];
	const bodyWitnessOccurrenceStringIds: number[] = [];
	const bodyWitnessStartOffsetsByBlock = bodyWitnessTextsByBlock.map((texts) =>
		texts.map((_, index) => index),
	);
	for (let blockId = 0; blockId < base.bodyBlocks.blockCount; blockId += 1) {
		bodyWitnessOccurrenceStartByBlockId.push(bodyWitnessOccurrenceStringIds.length);
		for (const text of bodyWitnessTextsByBlock[blockId] ?? []) {
			let stringId = uniqueStrings.get(text);
			if (stringId == null) {
				stringId = orderedStrings.length;
				uniqueStrings.set(text, stringId);
				orderedStrings.push(text);
			}
			bodyWitnessOccurrenceStringIds.push(stringId);
		}
	}
	bodyWitnessOccurrenceStartByBlockId.push(bodyWitnessOccurrenceStringIds.length);
	const positionLane = buildBlockPositionLane(
		Array.from({ length: base.bodyBlocks.blockCount }, (_, blockId) =>
			bodyWitnessStartOffsetsByBlock[blockId] ?? [],
		),
	);
	const offsets: number[] = [];
	const lengths: number[] = [];
	let stringArenaText = "";
	for (const text of orderedStrings) {
		offsets.push(stringArenaText.length);
		lengths.push(text.length);
		stringArenaText += text;
	}
	return {
		...base,
		stringArena: {
			text: stringArenaText,
			offsets: new Uint32Array(offsets),
			lengths: new Uint32Array(lengths),
			count: orderedStrings.length,
		},
		hanRoute: {
			...base.hanRoute,
			bodyWitnessOccurrenceStartByBlockId: new Uint32Array(bodyWitnessOccurrenceStartByBlockId),
			bodyWitnessOccurrenceStringIds: new Uint32Array(bodyWitnessOccurrenceStringIds),
			bodyWitnessPositionEncodingByBlockId: positionLane.positionEncodingByBlockId,
			bodyWitnessPositionStartByBlockId: positionLane.positionStartByBlockId,
			bodyWitnessPositionDeltaU8Tape: positionLane.positionDeltaU8Tape,
			bodyWitnessPositionDeltaU16Tape: positionLane.positionDeltaU16Tape,
			bodyWitnessPositionDeltaU32Tape: positionLane.positionDeltaU32Tape,
		},
	};
}

async function runHanRefine(
	result: CoverageLexicalV3SearchResult,
	options: {
		indexedTexts?: Map<string, string>;
		residentBase?: ResidentBase;
	},
): Promise<readonly EvidencePackingProfile[]> {
	const engine = new CoverageLexicalV3FileSearchEngine();
	const residentBase = options.residentBase ?? createResidentBase();
	const readIndexedTexts = jest.fn(async () => options.indexedTexts ?? new Map<string, string>());
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
					surfaceGroups: [createHanSurfaceGroup(0, fullSurface)],
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
						hanSurfaceGroupRecalls: [],
					},
				],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "notes/lifeforce.md",
					realizedFamilies: [
						{
							queryUnitIndex: 0,
							queryUnitText: shorterTerm,
							querySurfaceGroupIndex: 0,
							familyId: 0,
							familyText: shorterTerm,
							matchKind: "exact",
							editDistance: 0,
							identityMetadataSource: "none",
							routeMetadataSource: "none",
							metadataPackingSource: "route",
							inIdentity: false,
							inRoute: false,
							inHeading: false,
							inBestBodyWindow: true,
							inBodyResidue: false,
						},
					],
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
			new Map([["notes/lifeforce.md", "\u7f13\u5b58\u6062\u590d\u6b65\u9aa4\n\n\u70ed\u542f\u52a8\u6062\u590d\u8bb0\u5f55\u3002"]]),
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
					surfaceGroups: [createHanSurfaceGroup(0, fullSurface)],
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
						hanSurfaceGroupRecalls: [],
					},
				],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "notes/life-force.md",
					realizedFamilies: [
						{
							queryUnitIndex: 0,
							queryUnitText: shorterTerm,
							querySurfaceGroupIndex: 0,
							familyId: 0,
							familyText: shorterTerm,
							matchKind: "exact",
							editDistance: 0,
							identityMetadataSource: "none",
							routeMetadataSource: "none",
							metadataPackingSource: "route",
							inIdentity: false,
							inRoute: false,
							inHeading: false,
							inBestBodyWindow: true,
							inBodyResidue: false,
						},
					],
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
			new Map([["notes/life-force.md", "\u7f13\u5b58\u6062\u590d\u6b65\u9aa4\u8bf4\u660e\n\n\u7f13\u5b58\u6062\u590d\u6b65\u9aa4\u7528\u4e8e\u70ed\u542f\u52a8\u6062\u590d\u3002"]]),
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

	test("getDirectSubItems guarantees a body witness when bodyWindow is the dominant evidence", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "notes/body-dominant.md",
				basename: "body dominant",
				folder: "notes",
				generation: 101,
				content: "placeholder",
			}),
		]);
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: {
					queryText: "runtime access",
					normalizedQueryText: "runtime access",
					surfaceGroups: [
						{
							index: 0,
							text: "runtime",
							kind: "latin",
							hanBigramTexts: [],
							coveredCharMask: [],
							queryResidualUniqueBigrams: [],
							hasQueryResidualHanCoverage: false,
						},
						{
							index: 1,
							text: "access",
							kind: "latin",
							hanBigramTexts: [],
							coveredCharMask: [],
							queryResidualUniqueBigrams: [],
							hasQueryResidualHanCoverage: false,
						},
					],
					primaryUnits: [
						{ index: 0, text: "runtime", source: "surface", surfaceGroupIndex: 0 },
						{ index: 1, text: "access", source: "surface", surfaceGroupIndex: 1 },
					],
					hanBackstopGroups: [],
					surfaceCoverageShapeKey: "ll",
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
						hanSurfaceGroupRecalls: [],
					},
				],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "notes/body-dominant.md",
					realizedFamilies: [
						{
							queryUnitIndex: 0,
							queryUnitText: "runtime",
							querySurfaceGroupIndex: 0,
							familyId: 0,
							familyText: "runtime",
							matchKind: "exact",
							editDistance: 0,
							identityMetadataSource: "none",
							routeMetadataSource: "none",
							metadataPackingSource: "none",
							inIdentity: false,
							inRoute: false,
							inHeading: false,
							inBestBodyWindow: true,
							inBodyResidue: false,
						},
						{
							queryUnitIndex: 1,
							queryUnitText: "access",
							querySurfaceGroupIndex: 1,
							familyId: 1,
							familyText: "access",
							matchKind: "exact",
							editDistance: 0,
							identityMetadataSource: "none",
							routeMetadataSource: "none",
							metadataPackingSource: "none",
							inIdentity: false,
							inRoute: false,
							inHeading: false,
							inBestBodyWindow: true,
							inBodyResidue: false,
						},
					],
					bodyWindowContainer: {
						tier: "bodyWindow",
						blockIds: [0],
						boundaryCrossingCount: 0,
						coveredUnitIndices: [0, 1],
						coveredDistinctUnitCount: 2,
						containerCompactness: 200,
						exactUnitCount: 2,
						windowWidth: 2,
						gapCount: 1,
						density: 1,
						headingCorroboration: { coveredUnitIndices: [], unitCount: 0 },
					},
					strongestContainer: {
						tier: "bodyWindow",
						blockIds: [0],
						boundaryCrossingCount: 0,
						coveredUnitIndices: [0, 1],
						coveredDistinctUnitCount: 2,
						containerCompactness: 200,
						exactUnitCount: 2,
						windowWidth: 2,
						gapCount: 1,
						density: 1,
						headingCorroboration: { coveredUnitIndices: [], unitCount: 0 },
					},
				}),
			],
		}));
		const readIndexedTexts = jest.fn(async () =>
			new Map([
				["notes/body-dominant.md", "runtime access restores the session quickly"],
			]),
		);
		(
			engine as unknown as {
				engine: {
					search: typeof search;
					getResidentBase: () => ResidentBase;
				};
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: jest.Mock;
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
					readCurrentTexts: jest.Mock;
				};
			}
		).getFileSnapshotStore = () => ({
			readIndexedTexts,
			readCurrentTexts: jest.fn(),
		});

		const subItems = await engine.getDirectSubItems(
			"runtime access",
			"notes/body-dominant.md",
			3,
		);

		expect(subItems).not.toBeNull();
		expect(subItems?.length ?? 0).toBeGreaterThan(0);
		expect(subItems?.[0]?.snippetText ?? "").toContain("runtime access");
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
					surfaceGroups: [createHanSurfaceGroup(0, fullSurface)],
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
						hanSurfaceGroupRecalls: [],
					},
				],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "notes/missing-snapshot.md",
					realizedFamilies: [
						{
							queryUnitIndex: 0,
							queryUnitText: shorterTerm,
							querySurfaceGroupIndex: 0,
							familyId: 0,
							familyText: shorterTerm,
							matchKind: "exact",
							editDistance: 0,
							identityMetadataSource: "none",
							routeMetadataSource: "none",
							metadataPackingSource: "route",
							inIdentity: false,
							inRoute: false,
							inHeading: false,
							inBestBodyWindow: true,
							inBodyResidue: false,
						},
					],
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
			new Map([["notes/missing-snapshot.md", "\u7f13\u5b58\u6062\u590d\u6b65\u9aa4\n\n\u56de\u653e\u68c0\u67e5\u4e0e\u70ed\u542f\u52a8\u6062\u590d\u3002"]]),
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
					surfaceGroups: [createHanSurfaceGroup(0, fullSurface)],
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
					surfaceGroups: [createHanSurfaceGroup(0, fullSurface)],
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
		expect(readIndexedTexts).not.toHaveBeenCalled();
		expect(readCurrentTexts).not.toHaveBeenCalled();
	});
	test("searchFiles skips Han surface refine when no near-tie risk exists", async () => {
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

	test("resident Han witness refine promotes best-window surface confirms above residue confirms", async () => {
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
		const residentBase = withBodyWitnessTexts(createResidentBase(), [
			["lifeforce"],
			[],
			["lifeforce"],
		]);
		const refined = await runHanRefine(result, {
			residentBase,
		});

		expect(refined.map((candidate) => candidate.path)).toEqual([
			"a-window.md",
			"b-residue.md",
		]);
		expect(refined[0].strongestHanSurfaceCompletionTier).toBe("body_window");
		expect(refined[1].strongestHanSurfaceCompletionTier).toBe("body_residue");
	});

	test("resident Han witness refine checks all shortlisted blocks without raw query budget caps", async () => {
		const blockCounts = [100, 100, 100, 100, 100] as const;
		const residentBaseWithoutWitness = createResidentBaseForBlockCounts(blockCounts);
		const candidateDocs = blockCounts.map((blockCount, docId) => ({
			docId,
			matchedIdentityUnitIndices: [],
			matchedRouteUnitIndices: [],
			matchedHeadingUnitIndices: [],
			shortlistedBodyBlockIds: Array.from({ length: blockCount }, (_, ordinal) =>
				residentBaseWithoutWitness.docTable.bodyBlockStartByDocId[docId] + ordinal,
			),
			hanMetadataGateStats: null,
			hanBodyBlockGateStats: [],
		}));
		const rankedCandidates = blockCounts.map((_, docId) =>
			createPackingProfile({
				docId,
				path: String.fromCharCode(97 + docId) + ".md",
				bodyWindowContainer: createBodyWindowContainer([
					residentBaseWithoutWitness.docTable.bodyBlockStartByDocId[docId],
				]),
				strongestContainer: createBodyWindowContainer([
					residentBaseWithoutWitness.docTable.bodyBlockStartByDocId[docId],
				]),
			}),
		);
		const result: CoverageLexicalV3SearchResult = {
			recallState: {
				...createRefineSearchResult().recallState,
				candidateDocs,
			},
			rankedCandidates,
		};
		const residentBase = withBodyWitnessTexts(
			residentBaseWithoutWitness,
			Array.from(
				{ length: residentBaseWithoutWitness.bodyBlocks.blockCount },
				(_, blockId) => {
					const blockOrdinal =
						residentBaseWithoutWitness.bodyBlocks.blockOrdinalByBlockId[blockId] ?? 0;
					return blockOrdinal === 0 ? ["lifeforce"] : [];
				},
			),
		);
		const refined = await runHanRefine(result, { residentBase });

		expect(
			refined.every(
				(candidate) => candidate.strongestHanSurfaceCompletionTier === "body_window",
			),
		).toBe(true);
	});
});











