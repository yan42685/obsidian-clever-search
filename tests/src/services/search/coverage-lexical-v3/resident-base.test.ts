import type { IndexedDocument } from "src/globals/search-types";
import {
	buildResidentBase,
	buildResidentBaseArtifacts,
} from "src/services/search/coverage-lexical-v3/build";
import { buildIntegerArray } from "src/services/search/coverage-lexical-v3/layout/integer-arrays";
import { buildBlockPositionLane } from "src/services/search/coverage-lexical-v3/layout/position-lanes";
import type { ResidentBase } from "src/services/search/coverage-lexical-v3/layout/types";
import { describeResidentBase } from "src/services/search/coverage-lexical-v3/metrics";
import {
	IDENTITY_METADATA_SOURCE_ALIAS,
	IDENTITY_METADATA_SOURCE_BASENAME,
} from "src/services/search/coverage-lexical-v3/metadata-source";
import {
	getBodyBlockFamilySupportEntries,
	getBodyBlockFamilySupportMask,
	getDocPath,
	getBodyBlockExactTokenPositions,
	getBodyBlockHanWitnessOccurrences,
	getDocIdForLiveDocSlot,
	getDocIdentityFamilyIds,
	getDocIdentitySourceMasks,
	getFamilyIdForShardLocalFamilySlot,
	getLiveDocBodyBlockIds,
	getLiveDocPath,
	getDocRef,
	getDocStableKey,
	getLiveDocSlot,
	getLiveDocStableKey,
	getFamilyText,
	getShardLocalFamilySlot,
	getShardLocalFamilyText,
} from "src/services/search/coverage-lexical-v3/recall";

function createDocument(
	overrides: Partial<IndexedDocument> &
		Pick<IndexedDocument, "path" | "basename" | "folder">,
): IndexedDocument {
	return {
		docRef: overrides.docRef,
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

function sumMetricBuckets(metrics: ReturnType<typeof buildResidentBase>["metrics"]): number {
	return (
		metrics.docArenaBytes +
		metrics.stringArenaBytes +
		metrics.familyLexiconBytes +
		metrics.metadataContainerBytes +
		metrics.headingBytes +
		metrics.familyPostingBytes +
		metrics.bodyBlockBytes +
		metrics.exactTapeBytes +
		metrics.hanRouteBytes +
		metrics.auxiliaryBytes
	);
}

function countAdaptiveTerms(
	field: ReturnType<typeof buildResidentBase>["bodyFamilyPosting"],
): number {
	return (
		field.singletonTermIds.length +
		field.pairTermIds.length +
		field.smallTermIds.length +
		field.deltaTermIds.length
	);
}

function countAdaptiveValues(
	field: ReturnType<typeof buildResidentBase>["bodyFamilyPosting"],
): number {
	return (
		field.singletonValueIds.length +
		field.pairFirstValueIds.length +
		field.pairSecondValueIds.length +
		field.smallValueIds.length +
		field.postingTape.length
	);
}

describe("coverage lexical v3 resident base", () => {
	test("builds an empty resident base", () => {
		const residentBase = buildResidentBase([]);
		const summary = describeResidentBase(residentBase);

		expect(residentBase.docTable.docCount).toBe(0);
		expect(residentBase.familyLexicon.familyCount).toBe(0);
		expect(residentBase.bodyBlocks.blockCount).toBe(0);
		expect(residentBase.metrics.residentBytes).toBe(sumMetricBuckets(residentBase.metrics));
		expect(residentBase.metrics["residentBytes / indexedSurfaceUtf8Bytes"]).toBe(0);
		expect(residentBase.metrics["residentBytes / rawMarkdownUtf8Bytes"]).toBe(0);
		expect(summary.buckets).toHaveLength(10);
	});

	test("builds a single latin document", () => {
		const residentBase = buildResidentBase([
			createDocument({
				docRef: 9001,
				path: "notes/cache-restore.md",
				generation: 1775395495598,
				basename: "cache restore",
				folder: "notes",
				aliases: "restore cache replay",
				tags: "#incident #cache",
				headings: "warm start",
				content: "Cache restore replay steps and warm start checks.",
			}),
		]);

		expect(residentBase.docTable.docCount).toBe(1);
		expect(residentBase.familyLexicon.familyCount).toBeGreaterThan(0);
		expect(residentBase.metadataContainers.identityPostings.docIds.length).toBeGreaterThan(0);
		expect(countAdaptiveValues(residentBase.bodyFamilyPosting)).toBeGreaterThan(0);
		expect(residentBase.bodyBlocks.blockCount).toBe(1);
		expect(residentBase.exactTapes.familyIds.length).toBeGreaterThan(0);
		expect(residentBase.metrics.indexedSurfaceUtf8Bytes).toBeGreaterThan(0);
		expect(residentBase.metrics.residentBytes).toBe(sumMetricBuckets(residentBase.metrics));
		expect(residentBase.docTable.docRefsByDocId).toBeInstanceOf(Float64Array);
		expect(residentBase.docTable.docRefsByDocId[0]).toBe(9001);
		expect(residentBase.docTable.docRefsByLiveDocSlot?.[0]).toBe(9001);
		expect(residentBase.docTable.liveDocCount).toBe(1);
		expect(residentBase.docTable.liveDocSlotByDocId[0]).toBe(0);
		expect(residentBase.docTable.docIdByLiveDocSlot[0]).toBe(0);
		expect(residentBase.familyLexicon.shardLocalFamilyCount).toBe(
			residentBase.familyLexicon.familyCount,
		);
		expect(residentBase.familyLexicon.shardLocalFamilySlotByFamilyId[0]).toBe(0);
		expect(residentBase.familyLexicon.familyIdByShardLocalFamilySlot[0]).toBe(0);
		expect(getDocRef(residentBase, 0)).toBe(9001);
		expect(getDocStableKey(residentBase, 0)).toBe("docref:9001");
		expect(getLiveDocSlot(residentBase, 0)).toBe(0);
		expect(getDocIdForLiveDocSlot(residentBase, 0)).toBe(0);
		expect(getLiveDocPath(residentBase, 0)).toBe("notes/cache-restore.md");
		expect(getLiveDocStableKey(residentBase, 0)).toBe("docref:9001");
		expect(getLiveDocBodyBlockIds(residentBase, 0)).toEqual([0]);
		expect(getShardLocalFamilySlot(residentBase, 0)).toBe(0);
		expect(getFamilyIdForShardLocalFamilySlot(residentBase, 0)).toBe(0);
		expect(getShardLocalFamilyText(residentBase, 0)).toBe(
			getFamilyText(residentBase, 0),
		);
		expect(residentBase.docTable.generationByDocId).toBeInstanceOf(Float64Array);
		expect(residentBase.docTable.generationByDocId[0]).toBe(1775395495598);
	});

	test("preserves millisecond document generations without uint32 truncation", () => {
		const residentBase = buildResidentBase([
			createDocument({
				path: "notes/high-mtime.md",
				generation: 1775395495598,
				basename: "high mtime",
				folder: "notes",
				content: "alpha beta gamma",
			}),
		]);

		expect(residentBase.docTable.generationByDocId).toBeInstanceOf(Float64Array);
		expect(residentBase.docTable.generationByDocId[0]).toBe(1775395495598);
		expect(residentBase.docTable.generationByDocId[0]).not.toBe(1574002350);
	});

	test("throws when a document is missing generation", () => {
		expect(() =>
			buildResidentBase([
				{
					path: "notes/missing-generation.md",
					basename: "missing generation",
					folder: "notes",
					content: "alpha beta gamma",
				},
			]),
		).toThrow(
			"coverage-lexical-v3 requires IndexedDocument.generation for notes/missing-generation.md",
		);
	});

	test("builds a single han document", () => {
		const residentBase = buildResidentBase([
			createDocument({
				path: "\u6280\u672f/\u7f13\u5b58\u6062\u590d.md",
				basename: "\u7f13\u5b58\u6062\u590d",
				folder: "\u6280\u672f",
				headings: "\u6545\u969c\u56de\u653e",
				content: "\u7f13\u5b58\u6062\u590d\u6b65\u9aa4\n\n\u56de\u653e\u68c0\u67e5\u4e0e\u70ed\u542f\u52a8\u6062\u590d\u3002",
			}),
		]);

		expect(residentBase.docTable.docCount).toBe(1);
		expect(residentBase.familyLexicon.familyCount).toBeGreaterThan(0);
		expect(residentBase.bodyBlocks.blockCount).toBeGreaterThan(0);
		expect(residentBase.exactTapes.familyIds.length).toBeGreaterThan(0);
		expect(residentBase.metrics.hanRouteBytes).toBeGreaterThan(0);
		expect(residentBase.metrics.residentBytes).toBe(sumMetricBuckets(residentBase.metrics));
	});

	test("builds mixed metadata and body structures with stable byte buckets", () => {
		const documents = [
			createDocument({
				path: "infra/projected-secret-note.md",
				basename: "projected secret note",
				folder: "infra/kubernetes",
				aliases: "pod projected token runtime access",
				tags: "#k8s #runtime",
				headings: "Projected token runtime access",
				content:
					"Pod mounts token and secret together.\n\nProjected secrets and tokens in a pod runtime window.",
			}),
			createDocument({
				path: "daily/cache.md",
				basename: "daily cache replay checks",
				folder: "daily",
				tags: "#daily",
				headings: "cache replay",
				content: "Remember vector cache restore note.",
			}),
		];
		const artifacts = buildResidentBaseArtifacts(documents);
		const residentBase = artifacts.base;
		const summary = describeResidentBase(residentBase);

		expect(residentBase.metrics.docArenaBytes).toBeGreaterThan(0);
		expect(residentBase.metrics.stringArenaBytes).toBeGreaterThan(0);
		expect(residentBase.metrics.metadataContainerBytes).toBeGreaterThan(0);
		expect(residentBase.metrics.headingBytes).toBeGreaterThan(0);
		expect(residentBase.metrics.familyPostingBytes).toBeGreaterThan(0);
		expect(residentBase.metrics.bodyBlockBytes).toBeGreaterThan(0);
		expect(residentBase.metrics.exactTapeBytes).toBe(0);
		expect(artifacts.exactTapeSidecar.bytes).toBeGreaterThan(0);
		expect(artifacts.hanWitnessSidecar.bytes).toBeGreaterThan(0);
		expect(
			residentBase.metrics.hanRouteSharedBigramIdsBytes +
				residentBase.metrics.hanRouteMetadataHanPostingsBytes +
				residentBase.metrics.hanRouteHanBigramPostingBytes +
				residentBase.metrics.hanRouteMetadataHanCharPostingsBytes +
				residentBase.metrics.hanRouteHanCharPostingBytes +
				residentBase.metrics.hanRouteMetadataWitnessBytes +
				residentBase.metrics.hanRouteBodyWitnessBytes +
				residentBase.metrics.hanRouteBodyWitnessPositionBytes,
		).toBe(residentBase.metrics.hanRouteBytes);
		expect(
			residentBase.metrics.stringArenaPathBytes +
				residentBase.metrics.stringArenaFamilyBytes +
				residentBase.metrics.stringArenaIdentityWitnessBytes +
				residentBase.metrics.stringArenaRouteWitnessBytes +
				residentBase.metrics.stringArenaHeadingWitnessBytes +
				residentBase.metrics.stringArenaBodyWitnessBytes +
				residentBase.metrics.stringArenaMultiSourceBytes +
				residentBase.metrics.stringArenaUnattributedBytes,
		).toBe(residentBase.metrics.stringPayloadBytes);
		expect(residentBase.metrics.residentBytes).toBe(sumMetricBuckets(residentBase.metrics));
		expect(summary.documentCount).toBe(2);
		expect(summary.familyCount).toBe(residentBase.familyLexicon.familyCount);
		expect(summary["residentBytes / indexedSurfaceUtf8Bytes"]).toBeGreaterThan(0);
	});

	test("stores real exact and witness positions in resident block lanes", () => {
		const tokenizer = (text: string) =>
			text === "\u751f\u547d\u529b\u6838\u5fc3" ? ["\u751f\u547d", "\u529b\u6838", "\u6838\u5fc3"] : [];
		const documents = [
			createDocument({
				path: "zh/positions.md",
				basename: "\u666e\u901a\u7b14\u8bb0",
				folder: "zh",
				content: "\u524d\u7f00 \u751f\u547d\u529b\u6838\u5fc3 \u751f\u547d",
			}),
		];
		const residentBase = buildResidentBase(documents, tokenizer);
		const artifacts = buildResidentBaseArtifacts(documents, tokenizer);

		expect(getBodyBlockExactTokenPositions(residentBase, 0)).toEqual([3, 5, 6]);
		expect(getBodyBlockHanWitnessOccurrences(residentBase, 0)).toEqual([
			expect.objectContaining({ start: 0 }),
			expect.objectContaining({ start: 3 }),
			expect.objectContaining({ start: 9 }),
		]);
		expect(artifacts.exactTapeSidecar.positionEncodingByBlockId.length).toBeGreaterThan(0);
		expect(artifacts.exactTapeSidecar.positionStartByBlockId.length).toBeGreaterThan(0);
		expect(
			artifacts.exactTapeSidecar.positionDeltaU8Tape.byteLength +
				artifacts.exactTapeSidecar.positionDeltaU16Tape.byteLength +
				artifacts.exactTapeSidecar.positionDeltaU32Tape.byteLength,
		).toBeGreaterThan(0);
		expect(artifacts.hanWitnessSidecar.bodyWitnessPositionEncodingByBlockId.length).toBeGreaterThan(0);
		expect(artifacts.hanWitnessSidecar.bodyWitnessPositionStartByBlockId.length).toBeGreaterThan(0);
		expect(
			artifacts.hanWitnessSidecar.bodyWitnessPositionDeltaU8Tape.byteLength +
				artifacts.hanWitnessSidecar.bodyWitnessPositionDeltaU16Tape.byteLength +
				artifacts.hanWitnessSidecar.bodyWitnessPositionDeltaU32Tape.byteLength,
		).toBeGreaterThan(0);
	});

	test("aggregates standalone and compound latin support separately per block family", () => {
		const residentBase = buildResidentBase([
			createDocument({
				path: "latin/mixed-support.md",
				basename: "notes",
				folder: "latin",
				content: "prefer prefer-cache",
			}),
		]);
		const familyIdsByText = new Map(
			getBodyBlockFamilySupportEntries(residentBase, 0).map((entry) => [
				getFamilyText(residentBase, entry.familyId),
				entry.familyId,
			]),
		);
		const preferFamilyId = familyIdsByText.get("prefer");
		const compoundFamilyId = familyIdsByText.get("prefer-cache");

		expect(preferFamilyId).toBeDefined();
		expect(compoundFamilyId).toBeDefined();
		expect(getBodyBlockFamilySupportMask(residentBase, 0, preferFamilyId ?? -1)).toBe(3);
		expect(getBodyBlockFamilySupportMask(residentBase, 0, compoundFamilyId ?? -1)).toBe(1);
	});

	test("offloads body family support sidecar out of resident base artifacts", () => {
		const artifacts = buildResidentBaseArtifacts([
			createDocument({
				path: "latin/mixed-support.md",
				basename: "notes",
				folder: "latin",
				content: "prefer prefer-cache",
			}),
		]);

		expect(artifacts.bodyFamilySupportSidecar.entryCount).toBeGreaterThan(0);
		expect(artifacts.base.bodyBlocks.familySupportStartByBlockId.length).toBe(1);
		expect(artifacts.base.bodyBlocks.familySupportFamilyIds.length).toBe(0);
		expect(artifacts.base.bodyBlocks.familySupportMaskByEntry.length).toBe(0);
	});

	test("offloads exact tape sidecar out of resident base artifacts", () => {
		const artifacts = buildResidentBaseArtifacts([
			createDocument({
				path: "latin/runtime.md",
				basename: "runtime",
				folder: "latin",
				content: "projected token runtime access",
			}),
		]);

		expect(artifacts.exactTapeSidecar.entryCount).toBeGreaterThan(0);
		expect(artifacts.base.exactTapes.familyIds.length).toBe(0);
		expect(artifacts.base.exactTapes.positionEncodingByBlockId.length).toBe(0);
		expect(artifacts.base.exactTapes.positionStartByBlockId.length).toBe(0);
		expect(artifacts.base.exactTapes.positionDeltaU8Tape.length).toBe(0);
		expect(artifacts.base.exactTapes.positionDeltaU16Tape.length).toBe(0);
		expect(artifacts.base.exactTapes.positionDeltaU32Tape.length).toBe(0);
	});

	test("offloads han witness sidecar out of resident base artifacts", () => {
		const artifacts = buildResidentBaseArtifacts([
			createDocument({
				path: "zh/cache-recovery.md",
				basename: "缓存恢复",
				folder: "zh",
				content: "缓存恢复步骤 缓存恢复检查",
			}),
		]);

		expect(artifacts.hanWitnessSidecar.metadataWitnessEntryCount).toBeGreaterThan(0);
		expect(artifacts.hanWitnessSidecar.bodyWitnessEntryCount).toBeGreaterThan(0);
		expect(artifacts.base.hanRoute.identityWitnessStringIds.length).toBe(0);
		expect(artifacts.base.hanRoute.routeWitnessStringIds.length).toBe(0);
		expect(artifacts.base.hanRoute.headingWitnessStringIds.length).toBe(0);
		expect(artifacts.base.hanRoute.bodyWitnessOccurrenceStringIds.length).toBe(0);
		expect(artifacts.base.hanRoute.bodyWitnessPositionEncodingByBlockId.length).toBe(0);
		expect(artifacts.base.hanRoute.bodyWitnessPositionStartByBlockId.length).toBe(0);
		expect(artifacts.base.hanRoute.bodyWitnessPositionDeltaU8Tape.length).toBe(0);
		expect(artifacts.base.hanRoute.bodyWitnessPositionDeltaU16Tape.length).toBe(0);
		expect(artifacts.base.hanRoute.bodyWitnessPositionDeltaU32Tape.length).toBe(0);
	});

	test("reads exact and witness positions for block ids above uint16 range", () => {
		const highBlockId = 70000;
		const blockCount = highBlockId + 1;
		const exactOffsetsByBlock = Array.from({ length: blockCount }, () => [] as number[]);
		exactOffsetsByBlock[highBlockId] = [9, 320];
		const witnessOffsetsByBlock = Array.from({ length: blockCount }, () => [] as number[]);
		witnessOffsetsByBlock[highBlockId] = [4, 70004];
		const exactPositionLane = buildBlockPositionLane(exactOffsetsByBlock);
		const witnessPositionLane = buildBlockPositionLane(witnessOffsetsByBlock);
		const witnessStarts = new Array(blockCount + 1).fill(0);
		witnessStarts[blockCount] = 2;
		const residentBase = {
			version: 1,
			stringArena: {
				text: "ab",
				offsets: buildIntegerArray([0, 0]),
				lengths: buildIntegerArray([1, 1]),
				count: 2,
			},
			docTable: {
				docCount: 1,
				liveDocCount: 1,
				docRefsByDocId: new Float64Array([1]),
				docRefsByLiveDocSlot: new Float64Array([1]),
				liveDocSlotByDocId: buildIntegerArray([0]),
				docIdByLiveDocSlot: buildIntegerArray([0]),
				pathStringIds: buildIntegerArray([0]),
				pathStringIdsByLiveDocSlot: buildIntegerArray([0]),
				generationByDocId: new Float64Array([1]),
				generationByLiveDocSlot: new Float64Array([1]),
				identityStartByDocId: buildIntegerArray([0]),
				identityCountByDocId: buildIntegerArray([0]),
				identityStartByLiveDocSlot: buildIntegerArray([0]),
				identityCountByLiveDocSlot: buildIntegerArray([0]),
				routeStartByDocId: buildIntegerArray([0]),
				routeCountByDocId: buildIntegerArray([0]),
				routeStartByLiveDocSlot: buildIntegerArray([0]),
				routeCountByLiveDocSlot: buildIntegerArray([0]),
				headingStartByDocId: buildIntegerArray([0]),
				headingCountByDocId: buildIntegerArray([0]),
				headingStartByLiveDocSlot: buildIntegerArray([0]),
				headingCountByLiveDocSlot: buildIntegerArray([0]),
				bodyBlockStartByDocId: buildIntegerArray([0]),
				bodyBlockCountByDocId: buildIntegerArray([blockCount]),
				bodyBlockStartByLiveDocSlot: buildIntegerArray([0]),
				bodyBlockCountByLiveDocSlot: buildIntegerArray([blockCount]),
			},
			familyLexicon: {
				familyCount: 2,
				shardLocalFamilyCount: 2,
				shardLocalFamilySlotByFamilyId: buildIntegerArray([0, 1]),
				familyIdByShardLocalFamilySlot: buildIntegerArray([0, 1]),
				familyStringIds: buildIntegerArray([0, 1]),
				familyFlagsByFamilyId: new Uint8Array([0, 0]),
			},
			metadataContainers: {
				identityFamiliesByDoc: buildIntegerArray([]),
				identitySourceMaskByDocEntry: new Uint8Array(),
				routeFamiliesByDoc: buildIntegerArray([]),
				routeSourceMaskByDocEntry: new Uint8Array(),
				headingFamiliesByDoc: buildIntegerArray([]),
				identityPostings: { postingStarts: buildIntegerArray([]), docIds: buildIntegerArray([]) },
				routePostings: { postingStarts: buildIntegerArray([]), docIds: buildIntegerArray([]) },
				headingPostings: { postingStarts: buildIntegerArray([]), docIds: buildIntegerArray([]) },
			},
			bodyFamilyPosting: {
				singletonTermIds: buildIntegerArray([]),
				singletonValueIds: buildIntegerArray([]),
				pairTermIds: buildIntegerArray([]),
				pairFirstValueIds: buildIntegerArray([]),
				pairSecondValueIds: buildIntegerArray([]),
				smallTermIds: buildIntegerArray([]),
				smallValueStarts: buildIntegerArray([]),
				smallValueIds: buildIntegerArray([]),
				deltaTermIds: buildIntegerArray([]),
				deltaTapeStarts: buildIntegerArray([]),
				postingTape: new Uint8Array(),
			},
			bodyBlocks: {
				blockCount,
				docIdByBlockId: buildIntegerArray(new Array(blockCount).fill(0)),
				blockOrdinalByBlockId: buildIntegerArray(Array.from({ length: blockCount }, (_, index) => index)),
				exactTapeStartByBlockId: buildIntegerArray(new Array(blockCount).fill(0)),
				exactTapeCountByBlockId: buildIntegerArray(new Array(blockCount).fill(0).map((value, index) => index === highBlockId ? 2 : value)),
				familySupportStartByBlockId: buildIntegerArray(new Array(blockCount + 1).fill(0)),
				familySupportFamilyIds: buildIntegerArray([]),
				familySupportMaskByEntry: new Uint8Array(),
			},
			exactTapes: {
				familyIds: buildIntegerArray([0, 1]),
				positionEncodingByBlockId: exactPositionLane.positionEncodingByBlockId,
				positionStartByBlockId: exactPositionLane.positionStartByBlockId,
				positionDeltaU8Tape: exactPositionLane.positionDeltaU8Tape,
				positionDeltaU16Tape: exactPositionLane.positionDeltaU16Tape,
				positionDeltaU32Tape: exactPositionLane.positionDeltaU32Tape,
			},
			hanRoute: {
				bigramIds: new Uint32Array(),
				metadataPostingStarts: buildIntegerArray([]),
				metadataDocIds: buildIntegerArray([]),
				bodyAdaptivePostings: {
					singletonTermIds: buildIntegerArray([]),
					singletonValueIds: buildIntegerArray([]),
					pairTermIds: buildIntegerArray([]),
					pairFirstValueIds: buildIntegerArray([]),
					pairSecondValueIds: buildIntegerArray([]),
					smallTermIds: buildIntegerArray([]),
					smallValueStarts: buildIntegerArray([]),
					smallValueIds: buildIntegerArray([]),
					deltaTermIds: buildIntegerArray([]),
					deltaTapeStarts: buildIntegerArray([]),
					postingTape: new Uint8Array(),
				},
				metadataCharIds: new Uint32Array(),
				metadataCharPostingStarts: buildIntegerArray([]),
				metadataCharDocIds: buildIntegerArray([]),
				bodyCharAdaptivePostings: {
					singletonTermIds: buildIntegerArray([]),
					singletonValueIds: buildIntegerArray([]),
					pairTermIds: buildIntegerArray([]),
					pairFirstValueIds: buildIntegerArray([]),
					pairSecondValueIds: buildIntegerArray([]),
					smallTermIds: buildIntegerArray([]),
					smallValueStarts: buildIntegerArray([]),
					smallValueIds: buildIntegerArray([]),
					deltaTermIds: buildIntegerArray([]),
					deltaTapeStarts: buildIntegerArray([]),
					postingTape: new Uint8Array(),
				},
				identityWitnessStartByDocId: buildIntegerArray([0, 0]),
				identityWitnessStartByLiveDocSlot: buildIntegerArray([0, 0]),
				identityWitnessStringIds: buildIntegerArray([]),
				identityWitnessSourceMaskByDocEntry: new Uint8Array(),
				routeWitnessStartByDocId: buildIntegerArray([0, 0]),
				routeWitnessStartByLiveDocSlot: buildIntegerArray([0, 0]),
				routeWitnessStringIds: buildIntegerArray([]),
				routeWitnessSourceMaskByDocEntry: new Uint8Array(),
				headingWitnessStartByDocId: buildIntegerArray([0, 0]),
				headingWitnessStartByLiveDocSlot: buildIntegerArray([0, 0]),
				headingWitnessStringIds: buildIntegerArray([]),
				bodyWitnessOccurrenceStartByBlockId: buildIntegerArray(witnessStarts),
				bodyWitnessOccurrenceStringIds: buildIntegerArray([0, 1]),
				bodyWitnessPositionEncodingByBlockId: witnessPositionLane.positionEncodingByBlockId,
				bodyWitnessPositionStartByBlockId: witnessPositionLane.positionStartByBlockId,
				bodyWitnessPositionDeltaU8Tape: witnessPositionLane.positionDeltaU8Tape,
				bodyWitnessPositionDeltaU16Tape: witnessPositionLane.positionDeltaU16Tape,
				bodyWitnessPositionDeltaU32Tape: witnessPositionLane.positionDeltaU32Tape,
			},
			fuzzyRescue: {
				candidateMetadataFamilyIdsByFuzzyLookupKey: new Map(),
				indexedMetadataFamilyCount: 0,
				fuzzyLookupKeyCount: 0,
				bytes: 0,
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
				familyPostingTermIdsBytes: 0,
				familyPostingPostingStartsBytes: 0,
				familyPostingBlockIdsBytes: 0,
				familyPostingSingletonTermIdsBytes: 0,
				familyPostingSingletonBlockIdsBytes: 0,
				familyPostingPairTermIdsBytes: 0,
				familyPostingPairFirstBlockIdsBytes: 0,
				familyPostingPairSecondBlockIdsBytes: 0,
				familyPostingSmallTermIdsBytes: 0,
				familyPostingSmallPostingStartsBytes: 0,
				familyPostingSmallBlockIdsBytes: 0,
				familyPostingDeltaTermIdsBytes: 0,
				familyPostingDeltaTapeStartsBytes: 0,
				familyPostingDeltaPostingTapeBytes: 0,
				bodyBlockBytes: 0,
				exactTapeBytes: 0,
				exactTapePositionBytes: 0,
				hanRouteBytes: 0,
				hanRouteSharedBigramIdsBytes: 0,
				hanRouteMetadataHanPostingsBytes: 0,
				hanRouteMetadataHanPostingStartsBytes: 0,
				hanRouteMetadataHanDocIdsBytes: 0,
				hanRouteHanBigramPostingBytes: 0,
				hanRouteBodyBigramIdsBytes: 0,
				hanRouteHanBigramPostingStartsBytes: 0,
				hanRouteHanBigramBlockIdsBytes: 0,
				hanRouteHanBigramSingletonTermIdsBytes: 0,
				hanRouteHanBigramSingletonBlockIdsBytes: 0,
				hanRouteHanBigramPairTermIdsBytes: 0,
				hanRouteHanBigramPairFirstBlockIdsBytes: 0,
				hanRouteHanBigramPairSecondBlockIdsBytes: 0,
				hanRouteHanBigramSmallTermIdsBytes: 0,
				hanRouteHanBigramSmallPostingStartsBytes: 0,
				hanRouteHanBigramSmallBlockIdsBytes: 0,
				hanRouteHanBigramDeltaTermIdsBytes: 0,
				hanRouteHanBigramDeltaTapeStartsBytes: 0,
				hanRouteHanBigramDeltaPostingTapeBytes: 0,
				hanRouteMetadataHanCharPostingsBytes: 0,
				hanRouteMetadataHanCharPostingStartsBytes: 0,
				hanRouteMetadataHanCharDocIdsBytes: 0,
				hanRouteHanCharPostingBytes: 0,
				hanRouteBodyCharIdsBytes: 0,
				hanRouteHanCharPostingStartsBytes: 0,
				hanRouteHanCharBlockIdsBytes: 0,
				hanRouteMetadataWitnessBytes: 0,
				hanRouteBodyWitnessBytes: 0,
				hanRouteBodyWitnessPositionBytes: 0,
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
		} satisfies ResidentBase;

		expect(getBodyBlockExactTokenPositions(residentBase, highBlockId)).toEqual([9, 320]);
		expect(getBodyBlockHanWitnessOccurrences(residentBase, highBlockId)).toEqual([
			{ stringId: 0, start: 4 },
			{ stringId: 1, start: 70004 },
		]);
	});
	test("stores doc-local metadata source masks without collapsing them into a global family mask", () => {
		const residentBase = buildResidentBase([
			createDocument({
				path: "notes/basename-cache.md",
				basename: "cache",
				folder: "notes",
				content: "plain note",
			}),
			createDocument({
				path: "notes/alias-cache.md",
				basename: "plain note",
				folder: "notes",
				aliases: "cache",
				content: "plain note",
			}),
		]);

		const basenameDocId = Array.from(
			{ length: residentBase.docTable.docCount },
			(_, docId) => docId,
		).findIndex((docId) => getDocPath(residentBase, docId) === "notes/basename-cache.md");
		const aliasDocId = Array.from(
			{ length: residentBase.docTable.docCount },
			(_, docId) => docId,
		).findIndex((docId) => getDocPath(residentBase, docId) === "notes/alias-cache.md");
		const basenameIdentityFamilies = getDocIdentityFamilyIds(residentBase, basenameDocId);
		const aliasIdentityFamilies = getDocIdentityFamilyIds(residentBase, aliasDocId);
		const basenameSourceMasks = getDocIdentitySourceMasks(residentBase, basenameDocId);
		const aliasSourceMasks = getDocIdentitySourceMasks(residentBase, aliasDocId);
		const basenameCacheIndex = basenameIdentityFamilies.findIndex(
			(familyId) => getFamilyText(residentBase, familyId) === "cache",
		);
		const aliasCacheIndex = aliasIdentityFamilies.findIndex(
			(familyId) => getFamilyText(residentBase, familyId) === "cache",
		);

		expect(basenameCacheIndex).toBeGreaterThanOrEqual(0);
		expect(aliasCacheIndex).toBeGreaterThanOrEqual(0);
		expect(basenameSourceMasks[basenameCacheIndex]).toBe(
			IDENTITY_METADATA_SOURCE_BASENAME,
		);
		expect(aliasSourceMasks[aliasCacheIndex]).toBe(IDENTITY_METADATA_SOURCE_ALIAS);
	});

	test("uses adaptive integer widths and exposes section encoding descriptors", () => {
		const residentBase = buildResidentBase([
			createDocument({
				path: "notes/one.md",
				basename: "one",
				folder: "notes",
				content: "alpha beta",
			}),
			createDocument({
				path: "notes/two.md",
				basename: "two",
				folder: "notes",
				content: "alpha gamma",
			}),
		]);
		const summary = describeResidentBase(residentBase);

		expect(residentBase.docTable.pathStringIds).toBeInstanceOf(Uint8Array);
		expect(residentBase.docTable.pathStringIdsByLiveDocSlot).toBeInstanceOf(Uint8Array);
		expect(residentBase.docTable.liveDocSlotByDocId).toBeInstanceOf(Uint8Array);
		expect(residentBase.docTable.docIdByLiveDocSlot).toBeInstanceOf(Uint8Array);
		expect(residentBase.bodyBlocks.docIdByBlockId).toBeInstanceOf(Uint8Array);
		expect(residentBase.exactTapes.familyIds).toBeInstanceOf(Uint8Array);
		expect(summary.sectionEncodings.length).toBeGreaterThan(0);
		expect(
			summary.sectionEncodings.some(
				(section) =>
					section.sectionKind === "familyPosting.smallValueStarts" &&
					section.encodingFlags > 0,
			),
		).toBe(true);
		expect(
			summary.sectionEncodings.some(
				(section) => section.sectionKind === "familyPosting.singletonTermIds",
			),
		).toBe(true);
		expect(
			summary.sectionEncodings.some(
				(section) => section.sectionKind === "hanRoute.hanBigramPosting.singletonTermIds",
			),
		).toBe(true);
		expect(
			summary.sectionEncodings.some(
				(section) => section.sectionKind === "hanRoute.hanBigramPosting.postingTape",
			),
		).toBe(true);
		expect(countAdaptiveTerms(residentBase.bodyFamilyPosting)).toBeGreaterThan(0);
		expect(residentBase.metrics.stringPayloadBytes).toBeGreaterThan(0);
		expect(residentBase.metrics.idPayloadBytes).toBeGreaterThan(0);
	});

	test("indexes eligible metadata families in fuzzy rescue sidecar and skips heading/body only families", () => {
		const artifacts = buildResidentBaseArtifacts([
			createDocument({
				path: "latin/obsidian.md",
				basename: "obsidian",
				folder: "latin",
				content: "plain note",
			}),
			createDocument({
				path: "latin/runtime.md",
				basename: "notes",
				folder: "latin",
				aliases: "runtime",
				content: "plain note",
			}),
			createDocument({
				path: "latin/short.md",
				basename: "cache",
				folder: "latin",
				content: "cache",
			}),
			createDocument({
				path: "zh/han.md",
				basename: "缓存恢复",
				folder: "zh",
				content: "缓存恢复",
			}),
			createDocument({
				path: "latin/heading-only.md",
				basename: "notes",
				folder: "latin",
				headings: "incident",
				content: "plain note",
			}),
			createDocument({
				path: "latin/body-only.md",
				basename: "notes",
				folder: "latin",
				content: "runbooks",
			}),
		]);
		const residentBase = artifacts.base;
		const fuzzyRescueSidecar = artifacts.fuzzyRescueSidecar;

		const obsidanPosting =
			fuzzyRescueSidecar.candidateMetadataFamilyIdsByFuzzyLookupKey.get(
				"obsidan",
			);
		const incdentPosting =
			fuzzyRescueSidecar.candidateMetadataFamilyIdsByFuzzyLookupKey.get(
				"incdent",
			);
		const runboksPosting =
			fuzzyRescueSidecar.candidateMetadataFamilyIdsByFuzzyLookupKey.get(
				"runboks",
			);
		const postedFamilyTexts = Array.from(obsidanPosting ?? []).map((familyId) =>
			getFamilyText(residentBase, familyId),
		);

		expect(fuzzyRescueSidecar.indexedMetadataFamilyCount).toBe(2);
		expect(postedFamilyTexts).toContain("obsidian");
		expect(postedFamilyTexts).not.toContain("cache");
		expect(incdentPosting).toBeUndefined();
		expect(runboksPosting).toBeUndefined();
		expect(residentBase.fuzzyRescue.fuzzyLookupKeyCount).toBe(0);
		expect(residentBase.metrics.auxiliaryBytes).toBe(0);
	});
});
