import type { IndexedDocument } from "src/globals/search-types";
import type {
	LexicalHanBodyEvidenceRow,
	LexicalHanDocEvidenceRow,
} from "src/services/database/database";
import { buildBodyBlockArena } from "../layout/body-blocks";
import { buildBodyFamilyPostingField } from "../layout/body-family-posting";
import { buildDocTable } from "../layout/doc-table";
import { createEmptyResidentExactTapeArena } from "../layout/exact-tapes";
import {
	buildFamilyLexicon,
	FAMILY_SOURCE_MASK_BODY,
	FAMILY_SOURCE_MASK_HEADING,
	FAMILY_SOURCE_MASK_IDENTITY,
	FAMILY_SOURCE_MASK_ROUTE,
} from "../layout/family-lexicon";
import {
	buildResidentFuzzyRescueIndex,
	EMPTY_RESIDENT_FUZZY_RESCUE_INDEX,
} from "../layout/fuzzy-rescue";
import { buildHanRouteArena } from "../layout/han-route";
import { buildIntegerArray } from "../layout/integer-arrays";
import { buildMetadataContainerArena } from "../layout/metadata-containers";
import type {
	ResidentBase,
	ResidentIndexView,
	ResidentFuzzyRescueIndex,
} from "../layout/types";
import {
	IDENTITY_METADATA_SOURCE_ALIAS,
	IDENTITY_METADATA_SOURCE_BASENAME,
	ROUTE_METADATA_SOURCE_FOLDER,
	ROUTE_METADATA_SOURCE_TAG,
} from "../metadata-source";
import { buildResidentBaseMetrics } from "../metrics";
import {
	encodeHanBigramId,
	encodeHanCharId,
	createV3BodyBlockChunkRanges,
	extractDocumentFamilySequence,
	extractDocumentFamilySupportOccurrences,
	extractDocumentFamilyTextSetOnly,
	extractDocumentFamilyTexts,
	extractHanBigrams,
	extractHanChars,
	extractHanSegments,
	normalizeText,
	splitBodyBlocks,
	splitBodyBlocksWithDocumentTokenizer,
	splitBodyBlockFamilyTextSetsWithDocumentTokenizer,
	splitTagValues,
	V3_BODY_BLOCK_MAX_TOKENS,
	V3_BODY_BLOCK_TARGET_TOKENS,
	type V3FamilyOccurrence,
	type V3DocumentTokenizer,
} from "../query";
import {
	buildLexicalBlockEvidenceRowId,
	buildLexicalDocEvidenceRowId,
	type LexicalBodyEvidencePublishRow,
} from "../../shared/file-snapshot-store";

const textEncoder = new TextEncoder();

function toUint32Array(values: readonly number[]): Uint32Array {
	return new Uint32Array(values);
}

function toInt32Array(values: readonly number[]): Int32Array {
	return new Int32Array(values);
}

function toUint8Array(values: readonly number[]): Uint8Array {
	return new Uint8Array(values);
}

function mapToUint32Array(
	values: readonly number[],
	mapper: (value: number) => number,
): Uint32Array {
	const mapped = new Uint32Array(values.length);
	for (let index = 0; index < values.length; index += 1) {
		mapped[index] = mapper(values[index]);
	}
	return mapped;
}

const STRING_SOURCE_PATH = 1 << 0;
const STRING_SOURCE_FAMILY = 1 << 1;
const STRING_SOURCE_IDENTITY_WITNESS = 1 << 2;
const STRING_SOURCE_ROUTE_WITNESS = 1 << 3;
const STRING_SOURCE_HEADING_WITNESS = 1 << 4;
const STRING_SOURCE_BODY_WITNESS = 1 << 5;
const HAN_SEQUENCE_REGEX = /\p{Script=Han}+/gu;

export const DEFAULT_RESIDENT_SHARD_ID = "base-0";
export const DEFAULT_RESIDENT_SHARD_GENERATION = 1;

type PreparedDocument = Readonly<{
	docRef: number;
	path: string;
	generation: number;
	basename: string;
	folder: string;
	basenameFamilyTexts: readonly string[];
	aliasFamilyTexts: readonly string[];
	identityFamilyTexts: readonly string[];
	identitySourceMasks: readonly number[];
	folderFamilyTexts: readonly string[];
	tagFamilyTexts: readonly string[];
	routeFamilyTexts: readonly string[];
	routeSourceMasks: readonly number[];
	headingFamilyTexts: readonly string[];
	identityHanWitnessTexts: readonly string[];
	identityHanWitnessSourceMasks: readonly number[];
	routeHanWitnessTexts: readonly string[];
	routeHanWitnessSourceMasks: readonly number[];
	headingHanWitnessTexts: readonly string[];
	identityHanBigramIds: readonly number[];
	routeHanBigramIds: readonly number[];
	headingHanBigramIds: readonly number[];
	identityHanCharIds: readonly number[];
	routeHanCharIds: readonly number[];
	bodyBlocks: readonly PreparedBodyBlock[];
}>;

type PreparedBodyBlock = Readonly<{
	docId: number;
	ordinal: number;
	summaryFamilyTexts: readonly string[];
	exactFamilyTexts: readonly string[];
	exactFamilyStartOffsets: readonly number[];
	exactFamilySupportMasks: readonly number[];
	hanWitnessTexts: readonly string[];
	hanWitnessStartOffsets: readonly number[];
	hanBigramIds: readonly number[];
	hanCharIds: readonly number[];
}>;

export type ResidentHotBaseArtifacts = Readonly<{
	base: ResidentBase;
	fuzzyRescueIndex: ResidentFuzzyRescueIndex;
	bodyEvidenceRows: readonly LexicalBodyEvidencePublishRow[];
	hanDocEvidenceRows: readonly LexicalHanDocEvidenceRow[];
	hanBodyEvidenceRows: readonly LexicalHanBodyEvidenceRow[];
}>;

export type ResidentHotBaseStreamingArtifacts = Readonly<{
	base: ResidentBase;
	fuzzyRescueIndex: ResidentFuzzyRescueIndex;
	coldEvidenceFlushCount: number;
	maxColdEvidenceChunkSize: number;
	batchMaxRawTextBytes: number;
	pass1Ms: number;
	pass2Ms: number;
	mergeMs: number;
}>;

export type ResidentColdEvidenceSink = Readonly<{
	publishBodyEvidence: (rows: readonly LexicalBodyEvidencePublishRow[]) => Promise<void>;
	publishHanDocEvidence: (rows: readonly LexicalHanDocEvidenceRow[]) => Promise<void>;
	publishHanBodyEvidence: (rows: readonly LexicalHanBodyEvidenceRow[]) => Promise<void>;
}>;

export type CoverageLexicalV3RebuildProgress = Readonly<{
	phase: "pass1" | "pass2" | "merge";
	processedBytes?: number;
	totalBytes?: number;
}>;

export const DEFAULT_COLD_EVIDENCE_CHUNK_SIZE = 128;
export const DEFAULT_RESIDENT_REBUILD_BATCH_RAW_TEXT_BYTE_CAP = 32 * 1024 * 1024;
export const LOW_MEMORY_RESIDENT_REBUILD_BATCH_RAW_TEXT_BYTE_CAP = 16 * 1024 * 1024;

type CoverageV3BuildMemo = Readonly<{
	encodeHanBigramId: (bigram: string) => number;
	encodeHanCharId: (char: string) => number;
	buildStableWitnessMatchKey: (text: string) => number;
	extractFamilyOccurrences: (text: string) => readonly V3FamilyOccurrence[];
	extractFamilyTexts: (text: string) => readonly string[];
	tokenizeDocumentText: V3DocumentTokenizer | undefined;
}>;

function createCoverageV3BuildMemo(
	tokenizeDocumentText?: V3DocumentTokenizer,
): CoverageV3BuildMemo {
	const hanBigramIds = new BoundedBuildCache<string, number>(65_536);
	const hanCharIds = new BoundedBuildCache<string, number>(8_192);
	const witnessMatchKeys = new BoundedBuildCache<string, number>(32_768);
	const tokenizerOutputs = new BoundedBuildCache<string, readonly string[]>(4_096);
	const familyOccurrences = new BoundedBuildCache<string, readonly V3FamilyOccurrence[]>(4_096);
	const familyTextSets = new BoundedBuildCache<string, readonly string[]>(4_096);
	const memoizedTokenizer: V3DocumentTokenizer | undefined =
		tokenizeDocumentText == null
			? undefined
			: (surfaceText: string): string[] => {
					if (surfaceText.length > 256) {
						return [...tokenizeDocumentText(surfaceText)];
					}
					return [
						...tokenizerOutputs.getOrCreate(surfaceText, () => [
							...tokenizeDocumentText(surfaceText),
						]),
					];
				};
	return {
		encodeHanBigramId: (bigram) =>
			hanBigramIds.getOrCreate(bigram, () => encodeHanBigramId(bigram)),
		encodeHanCharId: (char) =>
			hanCharIds.getOrCreate(char, () => encodeHanCharId(char)),
		buildStableWitnessMatchKey: (text) =>
			witnessMatchKeys.getOrCreate(text, () => buildStableWitnessMatchKey(text)),
		extractFamilyOccurrences: (text) => {
			if (text.length > 256) {
				return extractDocumentFamilySupportOccurrences(text, memoizedTokenizer);
			}
			return familyOccurrences.getOrCreate(text, () => [
				...extractDocumentFamilySupportOccurrences(text, memoizedTokenizer),
			]);
		},
		extractFamilyTexts: (text) =>
			text.length > 256
				? extractDocumentFamilyTextSetOnly(text, memoizedTokenizer)
				: [
						...familyTextSets.getOrCreate(text, () => [
							...extractDocumentFamilyTextSetOnly(text, memoizedTokenizer),
						]),
					],
		tokenizeDocumentText: memoizedTokenizer,
	};
}

class BoundedBuildCache<K, V> {
	private readonly values = new Map<K, V>();

	constructor(private readonly maxEntries: number) {}

	getOrCreate(key: K, createValue: () => V): V {
		const existing = this.values.get(key);
		if (existing !== undefined) {
			return existing;
		}
		const value = createValue();
		if (this.values.size >= this.maxEntries) {
			const oldestKey = this.values.keys().next().value as K | undefined;
			if (oldestKey !== undefined) {
				this.values.delete(oldestKey);
			}
		}
		this.values.set(key, value);
		return value;
	}
}

function nowMs(): number {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function buildResidentBase(
	documents: readonly IndexedDocument[],
	tokenizeDocumentText?: V3DocumentTokenizer,
): ResidentBase {
	const artifacts = buildResidentHotBaseArtifacts(documents, tokenizeDocumentText);
	return {
		...artifacts.base,
		fuzzyRescue: artifacts.fuzzyRescueIndex,
	};
}

export function buildResidentIndexView(
	documents: readonly IndexedDocument[],
	tokenizeDocumentText?: V3DocumentTokenizer,
): ResidentIndexView {
	const base = buildResidentBase(documents, tokenizeDocumentText);
	return residentIndexViewFromBase(base);
}

export function residentIndexViewFromBase(base: ResidentBase): ResidentIndexView {
	return {
		version: 1,
		shards: [
			{
				shardId: DEFAULT_RESIDENT_SHARD_ID,
				generation: DEFAULT_RESIDENT_SHARD_GENERATION,
				base,
			},
		],
	};
}

export function buildResidentHotBaseArtifacts(
	documents: readonly IndexedDocument[],
	tokenizeDocumentText?: V3DocumentTokenizer,
): ResidentHotBaseArtifacts {
	const stringArenaBuilder = new StringArenaBuilder();
	const preparedDocuments = [...documents]
		.sort((left, right) => left.path.localeCompare(right.path))
		.map((document, docId) =>
			prepareDocument(document, docId, tokenizeDocumentText),
		);
	const familySourceMaskByText = collectFamilySourceMasks(preparedDocuments);
	const familyTexts = [...familySourceMaskByText.keys()].sort((left, right) =>
		left.localeCompare(right),
	);
	const familyIdByText = new Map<string, number>();
	const familyLexicon = buildFamilyLexicon(
		familyTexts.map((text, familyId) => {
			familyIdByText.set(text, familyId);
			return {
				text,
				stringId: stringArenaBuilder.intern(text, STRING_SOURCE_FAMILY),
				sourceMask: familySourceMaskByText.get(text) ?? 0,
			};
		}),
	);
	const fuzzyRescue = buildResidentFuzzyRescueIndex({
		familyTexts,
		familyFlagsByFamilyId: familyLexicon.familyFlagsByFamilyId,
		shardLocalFamilySlotByFamilyId:
			familyLexicon.shardLocalFamilySlotByFamilyId,
	});
	const identityFamilyIdsByDoc = preparedDocuments.map((document) =>
		mapFamilyTextsToIds(document.identityFamilyTexts, familyIdByText),
	);
	const identitySourceMasksByDoc = preparedDocuments.map(
		(document) => document.identitySourceMasks,
	);
	const routeFamilyIdsByDoc = preparedDocuments.map((document) =>
		mapFamilyTextsToIds(document.routeFamilyTexts, familyIdByText),
	);
	const routeSourceMasksByDoc = preparedDocuments.map(
		(document) => document.routeSourceMasks,
	);
	const headingFamilyIdsByDoc = preparedDocuments.map((document) =>
		mapFamilyTextsToIds(document.headingFamilyTexts, familyIdByText),
	);
	const metadataContainers = buildMetadataContainerArena({
		familyCount: familyLexicon.familyCount,
		identityFamilyIdsByDoc,
		identitySourceMasksByDoc,
		routeFamilyIdsByDoc,
		routeSourceMasksByDoc,
		headingFamilyIdsByDoc,
	});
	const blockInputs: Array<{
		docId: number;
		ordinal: number;
		summaryFamilyIds: readonly number[];
	}> = [];
	const bodyEvidenceRows: LexicalBodyEvidencePublishRow[] = [];
	const hanBodyEvidenceRows: LexicalHanBodyEvidenceRow[] = [];
	const bodyBlockStartByDocId: number[] = [];
	const bodyBlockCountByDocId: number[] = [];
	for (const document of preparedDocuments) {
		bodyBlockStartByDocId.push(blockInputs.length);
		for (const block of document.bodyBlocks) {
			const summaryFamilyIds = mapFamilyTextsToIds(
				block.summaryFamilyTexts,
				familyIdByText,
			);
			blockInputs.push({
				docId: block.docId,
				ordinal: block.ordinal,
				summaryFamilyIds,
			});
			if (document.docRef > 0) {
				const exactFamilyIds = mapFamilyTextsToIds(
					block.exactFamilyTexts,
					familyIdByText,
				);
				const supportDraft = buildBlockFamilySupportDraft(
					block.exactFamilyTexts,
					block.exactFamilySupportMasks,
					familyIdByText,
				);
				bodyEvidenceRows.push({
					id: buildLexicalBlockEvidenceRowId({
						shardId: DEFAULT_RESIDENT_SHARD_ID,
						shardGeneration: DEFAULT_RESIDENT_SHARD_GENERATION,
						docRef: document.docRef,
						generation: document.generation,
						blockOrdinal: block.ordinal,
					}),
					shardId: DEFAULT_RESIDENT_SHARD_ID,
					shardGeneration: DEFAULT_RESIDENT_SHARD_GENERATION,
					docRef: document.docRef,
					generation: document.generation,
					blockOrdinal: block.ordinal,
					exactShardLocalFamilySlots: mapToUint32Array(
						exactFamilyIds,
						(familyId) =>
							familyLexicon.shardLocalFamilySlotByFamilyId[familyId] ?? familyId,
					),
					exactTokenPositions: toUint32Array(block.exactFamilyStartOffsets),
					supportShardLocalFamilySlots: mapToUint32Array(
						supportDraft.familyIds,
						(familyId) =>
							familyLexicon.shardLocalFamilySlotByFamilyId[familyId] ?? familyId,
					),
					familySupportMaskByEntry: toUint8Array(supportDraft.supportMasks),
				});
				hanBodyEvidenceRows.push({
					id: buildLexicalBlockEvidenceRowId({
						shardId: DEFAULT_RESIDENT_SHARD_ID,
						shardGeneration: DEFAULT_RESIDENT_SHARD_GENERATION,
						docRef: document.docRef,
						generation: document.generation,
						blockOrdinal: block.ordinal,
					}),
					shardId: DEFAULT_RESIDENT_SHARD_ID,
					shardGeneration: DEFAULT_RESIDENT_SHARD_GENERATION,
					docRef: document.docRef,
					generation: document.generation,
					blockOrdinal: block.ordinal,
					bodyWitnessMatchKeys: toInt32Array(
						block.hanWitnessTexts.map(buildStableWitnessMatchKey),
					),
					bodyWitnessTexts: [...block.hanWitnessTexts],
					bodyWitnessStartOffsets: toUint32Array(block.hanWitnessStartOffsets),
				});
			}
		}
		bodyBlockCountByDocId.push(blockInputs.length - bodyBlockStartByDocId.at(-1)!);
	}
	const bodyFamilyPosting = buildBodyFamilyPostingField({
		shardLocalFamilySlotsByBlock: blockInputs.map((block) => block.summaryFamilyIds),
	});
	const bodyBlocks = buildBodyBlockArena(
		blockInputs.map((block) => ({
			docId: block.docId,
			liveDocSlot: block.docId,
			ordinal: block.ordinal,
			exactTapeStart: 0,
			exactTapeCount: 0,
			familySupportShardLocalFamilySlots: [],
			familySupportMasks: [],
		})),
	);
	const docTable = buildDocTable(
		preparedDocuments.map((document, docId) => ({
			docRef: document.docRef,
			pathStringId: stringArenaBuilder.intern(document.path, STRING_SOURCE_PATH),
			generation: document.generation,
			identityStart: metadataContainers.identityStartByDocId[docId] ?? 0,
			identityCount: metadataContainers.identityCountByDocId[docId] ?? 0,
			routeStart: metadataContainers.routeStartByDocId[docId] ?? 0,
			routeCount: metadataContainers.routeCountByDocId[docId] ?? 0,
			headingStart: metadataContainers.headingStartByDocId[docId] ?? 0,
			headingCount: metadataContainers.headingCountByDocId[docId] ?? 0,
			bodyBlockStart: bodyBlockStartByDocId[docId] ?? 0,
			bodyBlockCount: bodyBlockCountByDocId[docId] ?? 0,
		})),
	);
	const hanRoute = buildHanRouteArena({
		bigramIds: dedupeSortedNumbers([
			...preparedDocuments.flatMap((document) => document.identityHanBigramIds),
			...preparedDocuments.flatMap((document) => document.routeHanBigramIds),
		]),
		metadataDocIdsByBigram: buildMetadataPostingsByBigram(preparedDocuments),
		bodyPostingsByBigramId: buildBodyPostingsByBigram(preparedDocuments),
		metadataCharIds: dedupeSortedNumbers([
			...preparedDocuments.flatMap((document) => document.identityHanCharIds),
			...preparedDocuments.flatMap((document) => document.routeHanCharIds),
		]),
		metadataDocIdsByChar: buildMetadataPostingsByChar(preparedDocuments),
		bodyPostingsByCharId: buildBodyPostingsByChar(preparedDocuments),
		identityWitnessTextIdsByDoc: preparedDocuments.map(() => []),
		identityWitnessSourceMasksByDoc: preparedDocuments.map(() => []),
		routeWitnessTextIdsByDoc: preparedDocuments.map(() => []),
		routeWitnessSourceMasksByDoc: preparedDocuments.map(() => []),
		headingWitnessTextIdsByDoc: preparedDocuments.map(() => []),
		bodyWitnessOccurrenceTextIdsByBlock: blockInputs.map(() => []),
		bodyWitnessOccurrenceStartOffsetsByBlock: blockInputs.map(() => []),
	});
	const hanDocEvidenceRows = preparedDocuments
		.filter((document) => document.docRef > 0)
		.map<LexicalHanDocEvidenceRow>((document) => ({
			id: buildLexicalDocEvidenceRowId({
				shardId: DEFAULT_RESIDENT_SHARD_ID,
				shardGeneration: DEFAULT_RESIDENT_SHARD_GENERATION,
				docRef: document.docRef,
				generation: document.generation,
			}),
			shardId: DEFAULT_RESIDENT_SHARD_ID,
			shardGeneration: DEFAULT_RESIDENT_SHARD_GENERATION,
			docRef: document.docRef,
			generation: document.generation,
			identityWitnessMatchKeys: toInt32Array(
				document.identityHanWitnessTexts.map(buildStableWitnessMatchKey),
			),
			identityWitnessTexts: [...document.identityHanWitnessTexts],
			identityWitnessSourceMaskByDocEntry: toUint8Array(
				document.identityHanWitnessSourceMasks,
			),
			routeWitnessMatchKeys: toInt32Array(
				document.routeHanWitnessTexts.map(buildStableWitnessMatchKey),
			),
			routeWitnessTexts: [...document.routeHanWitnessTexts],
			routeWitnessSourceMaskByDocEntry: toUint8Array(document.routeHanWitnessSourceMasks),
			headingWitnessMatchKeys: toInt32Array(
				document.headingHanWitnessTexts.map(buildStableWitnessMatchKey),
			),
			headingWitnessTexts: [...document.headingHanWitnessTexts],
		}));
	const stringArenaSourceBreakdown = stringArenaBuilder.describeSourceUtf8Bytes();
	const stringArena = stringArenaBuilder.build();
	const emptyExactTapes = createEmptyResidentExactTapeArena();
	const metrics = buildResidentBaseMetrics({
		stringArena,
		stringArenaSourceBreakdown,
		docTable,
		familyLexicon,
		metadataContainers: metadataContainers.arena,
		bodyFamilyPosting,
		bodyBlocks,
		exactTapes: emptyExactTapes,
		hanRoute,
		auxiliaryBytes: EMPTY_RESIDENT_FUZZY_RESCUE_INDEX.bytes,
		indexedSurfaceUtf8Bytes: computeIndexedSurfaceUtf8Bytes(documents),
		rawMarkdownUtf8Bytes: computeRawMarkdownUtf8Bytes(documents),
	});
	return {
		base: {
			version: 1,
			stringArena,
			docTable,
			familyLexicon,
			metadataContainers: metadataContainers.arena,
			bodyFamilyPosting,
			bodyBlocks,
			exactTapes: emptyExactTapes,
			hanRoute,
			fuzzyRescue: EMPTY_RESIDENT_FUZZY_RESCUE_INDEX,
			metrics,
		},
		fuzzyRescueIndex: fuzzyRescue,
		bodyEvidenceRows,
		hanDocEvidenceRows,
		hanBodyEvidenceRows,
	};
}

export async function buildResidentHotBaseArtifactsStreaming(
	documents: readonly IndexedDocument[],
	tokenizeDocumentText: V3DocumentTokenizer | undefined,
	coldEvidenceSink: ResidentColdEvidenceSink,
	options: Readonly<{
		coldEvidenceChunkSize?: number;
		batchRawTextByteCap?: number;
		onProgress?: (progress: CoverageLexicalV3RebuildProgress) => void;
	}> = {},
): Promise<ResidentHotBaseStreamingArtifacts> {
	const chunkSize = Math.max(
		1,
		Math.floor(options.coldEvidenceChunkSize ?? DEFAULT_COLD_EVIDENCE_CHUNK_SIZE),
	);
	const batchRawTextByteCap = Math.max(
		1,
		Math.floor(
			options.batchRawTextByteCap ?? DEFAULT_RESIDENT_REBUILD_BATCH_RAW_TEXT_BYTE_CAP,
		),
	);
	const buildMemo = createCoverageV3BuildMemo(tokenizeDocumentText);
	const stringArenaBuilder = new StringArenaBuilder();
	const sortedDocuments = [...documents].sort((left, right) =>
		left.path.localeCompare(right.path),
	);
	const totalRawTextBytes = sortedDocuments.reduce(
		(sum, document) => sum + estimateIndexedDocumentRawTextBytes(document),
		0,
	);
	options.onProgress?.({ phase: "pass1" });
	const pass1StartMs = nowMs();
	const familySourceMaskByText = new Map<string, number>();
	for (let docId = 0; docId < sortedDocuments.length; docId += 1) {
		const document = sortedDocuments[docId];
		if (!document) {
			continue;
		}
		collectFamilySourceMasksFromIndexedDocument(
			familySourceMaskByText,
			document,
			buildMemo,
		);
	}
	const pass1Ms = nowMs() - pass1StartMs;
	const mergeStartMs = nowMs();
	const familyTexts = [...familySourceMaskByText.keys()].sort((left, right) =>
		left.localeCompare(right),
	);
	const familyIdByText = new Map<string, number>();
	const familyLexicon = buildFamilyLexicon(
		familyTexts.map((text, familyId) => {
			familyIdByText.set(text, familyId);
			return {
				text,
				stringId: stringArenaBuilder.intern(text, STRING_SOURCE_FAMILY),
				sourceMask: familySourceMaskByText.get(text) ?? 0,
			};
		}),
	);
	const mergeFamilyMs = nowMs() - mergeStartMs;
	const fuzzyRescue = buildResidentFuzzyRescueIndex({
		familyTexts,
		familyFlagsByFamilyId: familyLexicon.familyFlagsByFamilyId,
		shardLocalFamilySlotByFamilyId:
			familyLexicon.shardLocalFamilySlotByFamilyId,
	});
	options.onProgress?.({
		phase: "pass2",
		processedBytes: 0,
		totalBytes: totalRawTextBytes,
	});
	const pass2StartMs = nowMs();
	const identityFamilyIdsByDoc: number[][] = [];
	const identitySourceMasksByDoc: Array<readonly number[]> = [];
	const routeFamilyIdsByDoc: number[][] = [];
	const routeSourceMasksByDoc: Array<readonly number[]> = [];
	const headingFamilyIdsByDoc: number[][] = [];
	const docRefsByDocId: number[] = [];
	const generationsByDocId: number[] = [];
	const pathStringIdsByDocId: number[] = [];
	const blockInputs: Array<{
		docId: number;
		ordinal: number;
		summaryFamilyIds: readonly number[];
	}> = [];
	const bodyBlockStartByDocId: number[] = [];
	const bodyBlockCountByDocId: number[] = [];
	const metadataDocIdsByBigramId = new Map<number, number[]>();
	const metadataDocIdsByCharId = new Map<number, number[]>();
	const bodyPostingsByBigramId = new Map<number, number[]>();
	const bodyPostingsByCharId = new Map<number, number[]>();
	let coldEvidenceFlushCount = 0;
	let maxColdEvidenceChunkSize = 0;
	let batchRawTextBytes = 0;
	let pass2ProcessedRawTextBytes = 0;
	let batchMaxRawTextBytes = 0;
	let bodyEvidenceChunk: LexicalBodyEvidencePublishRow[] = [];
	let hanBodyEvidenceChunk: LexicalHanBodyEvidenceRow[] = [];
	let hanDocEvidenceChunk: LexicalHanDocEvidenceRow[] = [];
	const flushBodyEvidence = async (): Promise<void> => {
		if (bodyEvidenceChunk.length === 0) {
			return;
		}
		maxColdEvidenceChunkSize = Math.max(maxColdEvidenceChunkSize, bodyEvidenceChunk.length);
		const rows = bodyEvidenceChunk;
		bodyEvidenceChunk = [];
		coldEvidenceFlushCount += 1;
		await coldEvidenceSink.publishBodyEvidence(rows);
	};
	const flushHanBodyEvidence = async (): Promise<void> => {
		if (hanBodyEvidenceChunk.length === 0) {
			return;
		}
		maxColdEvidenceChunkSize = Math.max(maxColdEvidenceChunkSize, hanBodyEvidenceChunk.length);
		const rows = hanBodyEvidenceChunk;
		hanBodyEvidenceChunk = [];
		coldEvidenceFlushCount += 1;
		await coldEvidenceSink.publishHanBodyEvidence(rows);
	};
	const flushHanDocEvidence = async (): Promise<void> => {
		if (hanDocEvidenceChunk.length === 0) {
			return;
		}
		maxColdEvidenceChunkSize = Math.max(maxColdEvidenceChunkSize, hanDocEvidenceChunk.length);
		const rows = hanDocEvidenceChunk;
		hanDocEvidenceChunk = [];
		coldEvidenceFlushCount += 1;
		await coldEvidenceSink.publishHanDocEvidence(rows);
	};
	const flushBatch = async (): Promise<void> => {
		const flushedRawTextBytes = batchRawTextBytes;
		await flushBodyEvidence();
		await flushHanBodyEvidence();
		await flushHanDocEvidence();
		batchMaxRawTextBytes = Math.max(batchMaxRawTextBytes, batchRawTextBytes);
		pass2ProcessedRawTextBytes = Math.min(
			totalRawTextBytes,
			pass2ProcessedRawTextBytes + flushedRawTextBytes,
		);
		options.onProgress?.({
			phase: "pass2",
			processedBytes: pass2ProcessedRawTextBytes,
			totalBytes: totalRawTextBytes,
		});
		batchRawTextBytes = 0;
	};
	for (let docId = 0; docId < sortedDocuments.length; docId += 1) {
		const sourceDocument = sortedDocuments[docId];
		if (!sourceDocument) {
			continue;
		}
		const documentRawBytes = estimateIndexedDocumentRawTextBytes(sourceDocument);
		if (batchRawTextBytes > 0 && batchRawTextBytes + documentRawBytes > batchRawTextByteCap) {
			await flushBatch();
		}
		batchRawTextBytes += documentRawBytes;
		const document = prepareDocument(
			sourceDocument,
			docId,
			tokenizeDocumentText,
			buildMemo,
		);
		docRefsByDocId.push(document.docRef);
		generationsByDocId.push(document.generation);
		pathStringIdsByDocId.push(
			stringArenaBuilder.intern(document.path, STRING_SOURCE_PATH),
		);
		const identityFamilyIds = mapFamilyTextsToIds(
			document.identityFamilyTexts,
			familyIdByText,
		);
		const routeFamilyIds = mapFamilyTextsToIds(
			document.routeFamilyTexts,
			familyIdByText,
		);
		const headingFamilyIds = mapFamilyTextsToIds(
			document.headingFamilyTexts,
			familyIdByText,
		);
		identityFamilyIdsByDoc.push(identityFamilyIds);
		identitySourceMasksByDoc.push(document.identitySourceMasks);
		routeFamilyIdsByDoc.push(routeFamilyIds);
		routeSourceMasksByDoc.push(document.routeSourceMasks);
		headingFamilyIdsByDoc.push(headingFamilyIds);
		pushPostingMapValues(
			metadataDocIdsByBigramId,
			dedupeSortedNumbers([
				...document.identityHanBigramIds,
				...document.routeHanBigramIds,
			]),
			docId,
		);
		pushPostingMapValues(
			metadataDocIdsByCharId,
			dedupeSortedNumbers([
				...document.identityHanCharIds,
				...document.routeHanCharIds,
			]),
			docId,
		);
		bodyBlockStartByDocId.push(blockInputs.length);
		for (const block of document.bodyBlocks) {
			const summaryFamilyIds = mapFamilyTextsToIds(
				block.summaryFamilyTexts,
				familyIdByText,
			);
			blockInputs.push({
				docId: block.docId,
				ordinal: block.ordinal,
				summaryFamilyIds,
			});
			const blockId = blockInputs.length - 1;
			pushPostingMapValues(bodyPostingsByBigramId, block.hanBigramIds, blockId);
			pushPostingMapValues(bodyPostingsByCharId, block.hanCharIds, blockId);
			if (document.docRef > 0) {
				const exactFamilyIds = mapFamilyTextsToIds(
					block.exactFamilyTexts,
					familyIdByText,
				);
				const supportDraft = buildBlockFamilySupportDraft(
					block.exactFamilyTexts,
					block.exactFamilySupportMasks,
					familyIdByText,
				);
				bodyEvidenceChunk.push({
					id: buildLexicalBlockEvidenceRowId({
						shardId: DEFAULT_RESIDENT_SHARD_ID,
						shardGeneration: DEFAULT_RESIDENT_SHARD_GENERATION,
						docRef: document.docRef,
						generation: document.generation,
						blockOrdinal: block.ordinal,
					}),
					shardId: DEFAULT_RESIDENT_SHARD_ID,
					shardGeneration: DEFAULT_RESIDENT_SHARD_GENERATION,
					docRef: document.docRef,
					generation: document.generation,
					blockOrdinal: block.ordinal,
					exactShardLocalFamilySlots: mapToUint32Array(
						exactFamilyIds,
						(familyId) =>
							familyLexicon.shardLocalFamilySlotByFamilyId[familyId] ?? familyId,
					),
					exactTokenPositions: toUint32Array(block.exactFamilyStartOffsets),
					supportShardLocalFamilySlots: mapToUint32Array(
						supportDraft.familyIds,
						(familyId) =>
							familyLexicon.shardLocalFamilySlotByFamilyId[familyId] ?? familyId,
					),
					familySupportMaskByEntry: toUint8Array(supportDraft.supportMasks),
				});
				hanBodyEvidenceChunk.push({
					id: buildLexicalBlockEvidenceRowId({
						shardId: DEFAULT_RESIDENT_SHARD_ID,
						shardGeneration: DEFAULT_RESIDENT_SHARD_GENERATION,
						docRef: document.docRef,
						generation: document.generation,
						blockOrdinal: block.ordinal,
					}),
					shardId: DEFAULT_RESIDENT_SHARD_ID,
					shardGeneration: DEFAULT_RESIDENT_SHARD_GENERATION,
					docRef: document.docRef,
					generation: document.generation,
					blockOrdinal: block.ordinal,
					bodyWitnessMatchKeys: toInt32Array(
						block.hanWitnessTexts.map(buildMemo.buildStableWitnessMatchKey),
					),
					bodyWitnessTexts: [...block.hanWitnessTexts],
					bodyWitnessStartOffsets: toUint32Array(block.hanWitnessStartOffsets),
				});
				if (bodyEvidenceChunk.length >= chunkSize) {
					await flushBodyEvidence();
				}
				if (hanBodyEvidenceChunk.length >= chunkSize) {
					await flushHanBodyEvidence();
				}
			}
		}
		bodyBlockCountByDocId.push(blockInputs.length - bodyBlockStartByDocId.at(-1)!);
		if (document.docRef > 0) {
			hanDocEvidenceChunk.push({
				id: buildLexicalDocEvidenceRowId({
					shardId: DEFAULT_RESIDENT_SHARD_ID,
					shardGeneration: DEFAULT_RESIDENT_SHARD_GENERATION,
					docRef: document.docRef,
					generation: document.generation,
				}),
				shardId: DEFAULT_RESIDENT_SHARD_ID,
				shardGeneration: DEFAULT_RESIDENT_SHARD_GENERATION,
				docRef: document.docRef,
				generation: document.generation,
				identityWitnessMatchKeys: toInt32Array(
					document.identityHanWitnessTexts.map(buildMemo.buildStableWitnessMatchKey),
				),
				identityWitnessTexts: [...document.identityHanWitnessTexts],
				identityWitnessSourceMaskByDocEntry: toUint8Array(
					document.identityHanWitnessSourceMasks,
				),
				routeWitnessMatchKeys: toInt32Array(
					document.routeHanWitnessTexts.map(buildMemo.buildStableWitnessMatchKey),
				),
				routeWitnessTexts: [...document.routeHanWitnessTexts],
				routeWitnessSourceMaskByDocEntry: toUint8Array(
					document.routeHanWitnessSourceMasks,
				),
				headingWitnessMatchKeys: toInt32Array(
					document.headingHanWitnessTexts.map(buildMemo.buildStableWitnessMatchKey),
				),
				headingWitnessTexts: [...document.headingHanWitnessTexts],
			});
			if (hanDocEvidenceChunk.length >= chunkSize) {
				await flushHanDocEvidence();
			}
		}
	}
	await flushBatch();
	const pass2Ms = nowMs() - pass2StartMs;
	options.onProgress?.({ phase: "merge" });
	const finalMergeStartMs = nowMs();
	const metadataContainers = buildMetadataContainerArena({
		familyCount: familyLexicon.familyCount,
		identityFamilyIdsByDoc,
		identitySourceMasksByDoc,
		routeFamilyIdsByDoc,
		routeSourceMasksByDoc,
		headingFamilyIdsByDoc,
	});
	const bodyFamilyPosting = buildBodyFamilyPostingField({
		shardLocalFamilySlotsByBlock: blockInputs.map((block) => block.summaryFamilyIds),
	});
	const bodyBlocks = buildBodyBlockArena(
		blockInputs.map((block) => ({
			docId: block.docId,
			liveDocSlot: block.docId,
			ordinal: block.ordinal,
			exactTapeStart: 0,
			exactTapeCount: 0,
				familySupportShardLocalFamilySlots: [],
			familySupportMasks: [],
		})),
	);
	const docTable = buildDocTable(
		docRefsByDocId.map((docRef, docId) => ({
			docRef,
			pathStringId: pathStringIdsByDocId[docId] ?? 0,
			generation: generationsByDocId[docId] ?? 0,
			identityStart: metadataContainers.identityStartByDocId[docId] ?? 0,
			identityCount: metadataContainers.identityCountByDocId[docId] ?? 0,
			routeStart: metadataContainers.routeStartByDocId[docId] ?? 0,
			routeCount: metadataContainers.routeCountByDocId[docId] ?? 0,
			headingStart: metadataContainers.headingStartByDocId[docId] ?? 0,
			headingCount: metadataContainers.headingCountByDocId[docId] ?? 0,
			bodyBlockStart: bodyBlockStartByDocId[docId] ?? 0,
			bodyBlockCount: bodyBlockCountByDocId[docId] ?? 0,
		})),
	);
	const metadataBigramIds = [...metadataDocIdsByBigramId.keys()].sort((left, right) => left - right);
	const metadataCharIds = [...metadataDocIdsByCharId.keys()].sort((left, right) => left - right);
	const hanRoute = buildHanRouteArena({
		bigramIds: metadataBigramIds,
		metadataDocIdsByBigram: metadataBigramIds.map(
			(bigramId) => metadataDocIdsByBigramId.get(bigramId) ?? [],
		),
		bodyPostingsByBigramId,
		metadataCharIds,
		metadataDocIdsByChar: metadataCharIds.map(
			(charId) => metadataDocIdsByCharId.get(charId) ?? [],
		),
		bodyPostingsByCharId,
		identityWitnessTextIdsByDoc: docRefsByDocId.map(() => []),
		identityWitnessSourceMasksByDoc: docRefsByDocId.map(() => []),
		routeWitnessTextIdsByDoc: docRefsByDocId.map(() => []),
		routeWitnessSourceMasksByDoc: docRefsByDocId.map(() => []),
		headingWitnessTextIdsByDoc: docRefsByDocId.map(() => []),
		bodyWitnessOccurrenceTextIdsByBlock: blockInputs.map(() => []),
		bodyWitnessOccurrenceStartOffsetsByBlock: blockInputs.map(() => []),
	});
	const mergeMs = mergeFamilyMs + (nowMs() - finalMergeStartMs);
	const stringArenaSourceBreakdown = stringArenaBuilder.describeSourceUtf8Bytes();
	const stringArena = stringArenaBuilder.build();
	const emptyExactTapes = createEmptyResidentExactTapeArena();
	const metrics = buildResidentBaseMetrics({
		stringArena,
		stringArenaSourceBreakdown,
		docTable,
		familyLexicon,
		metadataContainers: metadataContainers.arena,
		bodyFamilyPosting,
		bodyBlocks,
		exactTapes: emptyExactTapes,
		hanRoute,
		auxiliaryBytes: EMPTY_RESIDENT_FUZZY_RESCUE_INDEX.bytes,
		indexedSurfaceUtf8Bytes: computeIndexedSurfaceUtf8Bytes(documents),
		rawMarkdownUtf8Bytes: computeRawMarkdownUtf8Bytes(documents),
	});
	return {
		base: {
			version: 1,
			stringArena,
			docTable,
			familyLexicon,
			metadataContainers: metadataContainers.arena,
			bodyFamilyPosting,
			bodyBlocks,
			exactTapes: emptyExactTapes,
			hanRoute,
			fuzzyRescue: EMPTY_RESIDENT_FUZZY_RESCUE_INDEX,
			metrics,
		},
		fuzzyRescueIndex: fuzzyRescue,
		coldEvidenceFlushCount,
		maxColdEvidenceChunkSize,
		batchMaxRawTextBytes,
		pass1Ms,
		pass2Ms,
		mergeMs,
	};
}


export function buildResidentBaseFromAutomationReadyDocuments(
	documents: readonly IndexedDocument[],
	tokenizeDocumentText?: V3DocumentTokenizer,
): ResidentBase {
	return buildResidentBase(documents, tokenizeDocumentText);
}

export function buildDocumentHanBigramInventory(
	document: IndexedDocument,
): Readonly<{
	identityHanBigrams: readonly string[];
	routeHanBigrams: readonly string[];
	headingHanBigrams: readonly string[];
	bodyHanBigrams: readonly string[];
}> {
	return {
		identityHanBigrams: dedupeSorted([
			...extractHanBigrams(document.basename ?? ""),
			...extractHanBigrams(document.aliases ?? ""),
		]),
		routeHanBigrams: dedupeSorted([
			...extractHanBigrams(document.folder ?? ""),
			...splitTagValues(document.tags ?? "").flatMap((tag) => extractHanBigrams(tag)),
		]),
		headingHanBigrams: dedupeSorted(extractHanBigrams(document.headings ?? "")),
		bodyHanBigrams: dedupeSorted(
			splitBodyBlocks(document.content ?? "").flatMap((block) => block.hanBigramTexts),
		),
	};
}

export function buildDocumentExactFamilySequence(
	document: IndexedDocument,
	tokenizeDocumentText?: V3DocumentTokenizer,
): readonly string[] {
	return extractDocumentFamilySequence(
		document.content ?? "",
		tokenizeDocumentText,
	);
}

function prepareDocument(
	document: IndexedDocument,
	docId: number,
	tokenizeDocumentText?: V3DocumentTokenizer,
	buildMemo: CoverageV3BuildMemo = createCoverageV3BuildMemo(tokenizeDocumentText),
): PreparedDocument {
	const generation = document.generation;
	if (generation == null) {
		throw new Error(
			`coverage-lexical-v3 requires IndexedDocument.generation for ${document.path}`,
		);
	}
	const aliasesText = document.aliases ?? "";
	const tagsText = document.tags ?? "";
	const headingsText = document.headings ?? "";
	const contentText = document.content ?? "";
	const basenameFamilyTexts = dedupeSorted(
		buildMemo.extractFamilyTexts(document.basename ?? ""),
	);
	const aliasFamilyTexts = dedupeSorted(
		buildMemo.extractFamilyTexts(aliasesText),
	);
	const folderFamilyTexts = dedupeSorted(
		buildMemo.extractFamilyTexts(document.folder ?? ""),
	);
	const tagFamilyTexts = dedupeSorted(
		splitTagValues(tagsText).flatMap((tag) =>
			buildMemo.extractFamilyTexts(tag),
		),
	);
	const bodyBlocks = splitPreparedBodyBlocksWithBuildMemo(
		contentText,
		docId,
		buildMemo,
	);
	const identityHanWitnessEntries = [
		...extractHanSegments(document.basename ?? "").map((text) => ({
			text,
			mask: IDENTITY_METADATA_SOURCE_BASENAME,
		})),
		...extractHanSegments(aliasesText).map((text) => ({
			text,
			mask: IDENTITY_METADATA_SOURCE_ALIAS,
		})),
	];
	const identityHanWitnessTexts = dedupeSorted(
		identityHanWitnessEntries.map((entry) => entry.text),
	);
	const identityHanWitnessSourceMasks = mapWitnessTextsToSourceMasks(
		identityHanWitnessTexts,
		identityHanWitnessEntries,
	);
	const routeHanWitnessEntries = [
		...extractHanSegments(document.folder ?? "").map((text) => ({
			text,
			mask: ROUTE_METADATA_SOURCE_FOLDER,
		})),
		...splitTagValues(tagsText).flatMap((tag) =>
			extractHanSegments(tag).map((text) => ({
				text,
				mask: ROUTE_METADATA_SOURCE_TAG,
			})),
		),
	];
	const routeHanWitnessTexts = dedupeSorted(
		routeHanWitnessEntries.map((entry) => entry.text),
	);
	const routeHanWitnessSourceMasks = mapWitnessTextsToSourceMasks(
		routeHanWitnessTexts,
		routeHanWitnessEntries,
	);
	const headingHanWitnessTexts = dedupeSorted(extractHanSegments(headingsText));
	return {
		docRef: document.docRef ?? 0,
		path: document.path,
		generation,
		basename: document.basename ?? "",
		folder: document.folder ?? "",
		basenameFamilyTexts,
		aliasFamilyTexts,
		identityFamilyTexts: dedupeSorted([...basenameFamilyTexts, ...aliasFamilyTexts]),
		identitySourceMasks: buildDocMetadataSourceMasks(
			dedupeSorted([...basenameFamilyTexts, ...aliasFamilyTexts]),
			[
				{
					familyTexts: basenameFamilyTexts,
					mask: IDENTITY_METADATA_SOURCE_BASENAME,
				},
				{
					familyTexts: aliasFamilyTexts,
					mask: IDENTITY_METADATA_SOURCE_ALIAS,
				},
			],
		),
		folderFamilyTexts,
		tagFamilyTexts,
		routeFamilyTexts: dedupeSorted([...folderFamilyTexts, ...tagFamilyTexts]),
		routeSourceMasks: buildDocMetadataSourceMasks(
			dedupeSorted([...folderFamilyTexts, ...tagFamilyTexts]),
			[
				{
					familyTexts: tagFamilyTexts,
					mask: ROUTE_METADATA_SOURCE_TAG,
				},
				{
					familyTexts: folderFamilyTexts,
					mask: ROUTE_METADATA_SOURCE_FOLDER,
				},
			],
		),
		headingFamilyTexts: dedupeSorted(
			buildMemo.extractFamilyTexts(headingsText),
		),
		identityHanWitnessTexts,
		identityHanWitnessSourceMasks,
		routeHanWitnessTexts,
		routeHanWitnessSourceMasks,
		headingHanWitnessTexts,
		identityHanBigramIds: dedupeSorted([
			...extractHanBigrams(document.basename ?? ""),
			...extractHanBigrams(aliasesText),
		]).map(buildMemo.encodeHanBigramId),
		routeHanBigramIds: dedupeSorted([
			...extractHanBigrams(document.folder ?? ""),
			...splitTagValues(tagsText).flatMap((tag) => extractHanBigrams(tag)),
		]).map(buildMemo.encodeHanBigramId),
		headingHanBigramIds: dedupeSorted(
			extractHanBigrams(headingsText),
		).map(buildMemo.encodeHanBigramId),
		identityHanCharIds: dedupeSorted([
			...extractHanChars(document.basename ?? ""),
			...extractHanChars(aliasesText),
		]).map(buildMemo.encodeHanCharId),
		routeHanCharIds: dedupeSorted([
			...extractHanChars(document.folder ?? ""),
			...splitTagValues(tagsText).flatMap((tag) => extractHanChars(tag)),
		]).map(buildMemo.encodeHanCharId),
		bodyBlocks,
	};
}

function collectFamilySourceMasks(
	documents: readonly PreparedDocument[],
): Map<string, number> {
	const familySourceMaskByText = new Map<string, number>();
	for (const document of documents) {
		collectFamilySourceMasksFromDocument(familySourceMaskByText, document);
	}
	return familySourceMaskByText;
}

function collectFamilySourceMasksFromDocument(
	familySourceMaskByText: Map<string, number>,
	document: PreparedDocument,
): void {
		mergeSourceMask(
			familySourceMaskByText,
			document.identityFamilyTexts,
			FAMILY_SOURCE_MASK_IDENTITY,
		);
		mergeSourceMask(
			familySourceMaskByText,
			document.routeFamilyTexts,
			FAMILY_SOURCE_MASK_ROUTE,
		);
		mergeSourceMask(
			familySourceMaskByText,
			document.headingFamilyTexts,
			FAMILY_SOURCE_MASK_HEADING,
		);
		for (const block of document.bodyBlocks) {
			mergeSourceMask(
				familySourceMaskByText,
				block.summaryFamilyTexts,
				FAMILY_SOURCE_MASK_BODY,
			);
		}
}

function collectFamilySourceMasksFromIndexedDocument(
	familySourceMaskByText: Map<string, number>,
	document: IndexedDocument,
	buildMemo: CoverageV3BuildMemo,
): void {
	const aliasesText = document.aliases ?? "";
	const tagsText = document.tags ?? "";
	const basenameFamilyTexts = dedupeSorted(
		buildMemo.extractFamilyTexts(document.basename ?? ""),
	);
	const aliasFamilyTexts = dedupeSorted(
		buildMemo.extractFamilyTexts(aliasesText),
	);
	const folderFamilyTexts = dedupeSorted(
		buildMemo.extractFamilyTexts(document.folder ?? ""),
	);
	const tagFamilyTexts = dedupeSorted(
		splitTagValues(tagsText).flatMap((tag) =>
			buildMemo.extractFamilyTexts(tag),
		),
	);
	mergeSourceMask(
		familySourceMaskByText,
		dedupeSorted([...basenameFamilyTexts, ...aliasFamilyTexts]),
		FAMILY_SOURCE_MASK_IDENTITY,
	);
	mergeSourceMask(
		familySourceMaskByText,
		dedupeSorted([...folderFamilyTexts, ...tagFamilyTexts]),
		FAMILY_SOURCE_MASK_ROUTE,
	);
	mergeSourceMask(
		familySourceMaskByText,
		dedupeSorted(
			buildMemo.extractFamilyTexts(document.headings ?? ""),
		),
		FAMILY_SOURCE_MASK_HEADING,
	);
	for (const familyTexts of splitBodyBlockFamilyTextsWithBuildMemo(
		document.content ?? "",
		buildMemo,
	)) {
		mergeSourceMask(
			familySourceMaskByText,
			dedupeSorted(familyTexts),
			FAMILY_SOURCE_MASK_BODY,
		);
	}
}

function splitBodyBlockFamilyTextsWithBuildMemo(
	text: string,
	buildMemo: CoverageV3BuildMemo,
): readonly (readonly string[])[] {
	return splitBodyBlockFamilyTextSetsWithDocumentTokenizer(
		text,
		buildMemo.tokenizeDocumentText,
	);
}

function splitPreparedBodyBlocksWithBuildMemo(
	text: string,
	docId: number,
	buildMemo: CoverageV3BuildMemo,
): readonly PreparedBodyBlock[] {
	return splitNormalizedBodyBlockTextsForBuild(text)
		.map<PreparedBodyBlock>((block, index) => {
			const exactFamilyOccurrences = buildMemo.extractFamilyOccurrences(block);
			const hanAnalysis = analyzeNormalizedBlockHanSurface(block);
			return {
				docId,
				ordinal: index,
				summaryFamilyTexts: dedupeSorted(
					dedupePreservingOrderStrings(
						exactFamilyOccurrences.map((occurrence) => occurrence.text),
					),
				),
				exactFamilyTexts: exactFamilyOccurrences.map(
					(occurrence) => occurrence.text,
				),
				exactFamilyStartOffsets: exactFamilyOccurrences.map(
					(occurrence) => occurrence.startOffset,
				),
				exactFamilySupportMasks: exactFamilyOccurrences.map(
					(occurrence) => occurrence.bodySupportMask,
				),
				hanWitnessTexts: hanAnalysis.witnessTexts,
				hanWitnessStartOffsets: hanAnalysis.witnessStartOffsets,
				hanBigramIds: hanAnalysis.bigramTexts.map(buildMemo.encodeHanBigramId),
				hanCharIds: hanAnalysis.charTexts.map(buildMemo.encodeHanCharId),
			};
		})
		.filter(
			(block) =>
				block.summaryFamilyTexts.length > 0 ||
				block.hanWitnessTexts.length > 0 ||
				block.hanBigramIds.length > 0,
		);
}

function splitNormalizedBodyBlockTextsForBuild(text: string): string[] {
	const normalized = normalizeText(text).replace(/\r\n?/gu, "\n");
	if (normalized.trim().length === 0) {
		return [];
	}
	return createV3BodyBlockChunkRanges(
		normalized,
		V3_BODY_BLOCK_TARGET_TOKENS,
		V3_BODY_BLOCK_MAX_TOKENS,
	)
		.map((range) => normalized.slice(range.startOffset, range.endOffset).trim())
		.filter((block) => block.length > 0);
}

function analyzeNormalizedBlockHanSurface(block: string): Readonly<{
	witnessTexts: readonly string[];
	witnessStartOffsets: readonly number[];
	bigramTexts: readonly string[];
	charTexts: readonly string[];
}> {
	const witnessTexts: string[] = [];
	const witnessStartOffsets: number[] = [];
	const bigramTexts: string[] = [];
	const charTexts: string[] = [];
	const seenBigrams = new Set<string>();
	const seenChars = new Set<string>();
	for (const match of block.matchAll(HAN_SEQUENCE_REGEX)) {
		const segment = match[0]?.trim() ?? "";
		if (segment.length === 0) {
			continue;
		}
		witnessTexts.push(segment);
		witnessStartOffsets.push(match.index ?? 0);
		const chars = Array.from(segment);
		for (const char of chars) {
			if (!seenChars.has(char)) {
				seenChars.add(char);
				charTexts.push(char);
			}
		}
		for (let index = 0; index < chars.length - 1; index += 1) {
			const bigram = `${chars[index] ?? ""}${chars[index + 1] ?? ""}`;
			if (bigram.length === 0 || seenBigrams.has(bigram)) {
				continue;
			}
			seenBigrams.add(bigram);
			bigramTexts.push(bigram);
		}
	}
	return {
		witnessTexts,
		witnessStartOffsets,
		bigramTexts,
		charTexts,
	};
}

function buildResidentHanRoute(
	documents: readonly PreparedDocument[],
	stringArenaBuilder: StringArenaBuilder,
) {
	const identityWitnessTextIdsByDoc = documents.map((document) =>
		mapStringsToStringIds(
			document.identityHanWitnessTexts,
			stringArenaBuilder,
			STRING_SOURCE_IDENTITY_WITNESS,
		),
	);
	const identityWitnessSourceMasksByDoc = documents.map(
		(document) => document.identityHanWitnessSourceMasks,
	);
	const routeWitnessTextIdsByDoc = documents.map((document) =>
		mapStringsToStringIds(
			document.routeHanWitnessTexts,
			stringArenaBuilder,
			STRING_SOURCE_ROUTE_WITNESS,
		),
	);
	const routeWitnessSourceMasksByDoc = documents.map(
		(document) => document.routeHanWitnessSourceMasks,
	);
	const headingWitnessTextIdsByDoc = documents.map((document) =>
		mapStringsToStringIds(
			document.headingHanWitnessTexts,
			stringArenaBuilder,
			STRING_SOURCE_HEADING_WITNESS,
		),
	);
	const bodyWitnessStringIdsByBlock = documents.flatMap((document) =>
		document.bodyBlocks.map((block) =>
			mapStringsToStringIds(
				block.hanWitnessTexts,
				stringArenaBuilder,
				STRING_SOURCE_BODY_WITNESS,
			),
		),
	);
	const bodyWitnessStartOffsetsByBlock = documents.flatMap((document) =>
		document.bodyBlocks.map((block) => [...block.hanWitnessStartOffsets]),
	);
	const allBodyBlocks = documents.flatMap((document) => document.bodyBlocks);
	const metadataBigramIds = dedupeSortedNumbers([
		...documents.flatMap((document) => document.identityHanBigramIds),
		...documents.flatMap((document) => document.routeHanBigramIds),
	]);
	const metadataCharIds = dedupeSortedNumbers([
		...documents.flatMap((document) => document.identityHanCharIds),
		...documents.flatMap((document) => document.routeHanCharIds),
	]);
	const bodyPostingsByBigramId = new Map<number, number[]>();
	const bodyPostingsByCharId = new Map<number, number[]>();
	for (let blockId = 0; blockId < allBodyBlocks.length; blockId += 1) {
		for (const bigramId of allBodyBlocks[blockId]?.hanBigramIds ?? []) {
			let blockIds = bodyPostingsByBigramId.get(bigramId);
			if (!blockIds) {
				blockIds = [];
				bodyPostingsByBigramId.set(bigramId, blockIds);
			}
			blockIds.push(blockId);
		}
		for (const charId of allBodyBlocks[blockId]?.hanCharIds ?? []) {
			let blockIds = bodyPostingsByCharId.get(charId);
			if (!blockIds) {
				blockIds = [];
				bodyPostingsByCharId.set(charId, blockIds);
			}
			blockIds.push(blockId);
		}
	}
	if (
		metadataBigramIds.length === 0 &&
		bodyPostingsByBigramId.size === 0 &&
		metadataCharIds.length === 0 &&
		bodyPostingsByCharId.size === 0
	) {
		return buildHanRouteArena({
			bigramIds: [],
			metadataDocIdsByBigram: [],
			bodyPostingsByBigramId: new Map(),
			metadataCharIds: [],
			metadataDocIdsByChar: [],
			bodyPostingsByCharId: new Map(),
			identityWitnessTextIdsByDoc,
			identityWitnessSourceMasksByDoc,
			routeWitnessTextIdsByDoc,
			routeWitnessSourceMasksByDoc,
			headingWitnessTextIdsByDoc,
			bodyWitnessOccurrenceTextIdsByBlock: bodyWitnessStringIdsByBlock,
			bodyWitnessOccurrenceStartOffsetsByBlock: bodyWitnessStartOffsetsByBlock,
		});
	}
	const metadataBigramIndexById = new Map(
		metadataBigramIds.map((bigramId, index) => [bigramId, index]),
	);
	const metadataDocIdsByBigram = Array.from(
		{ length: metadataBigramIds.length },
		() => [] as number[],
	);
	const metadataCharIndexById = new Map(
		metadataCharIds.map((charId, index) => [charId, index]),
	);
	const metadataDocIdsByChar = Array.from(
		{ length: metadataCharIds.length },
		() => [] as number[],
	);
	for (let docId = 0; docId < documents.length; docId += 1) {
		const document = documents[docId];
		pushBigramPostings(
			metadataDocIdsByBigram,
			dedupeSortedNumbers([
				...document.identityHanBigramIds,
				...document.routeHanBigramIds,
			]),
			docId,
			metadataBigramIndexById,
		);
		pushBigramPostings(
			metadataDocIdsByChar,
			dedupeSortedNumbers([
				...document.identityHanCharIds,
				...document.routeHanCharIds,
			]),
			docId,
			metadataCharIndexById,
		);
	}
	return buildHanRouteArena({
		bigramIds: metadataBigramIds,
			metadataDocIdsByBigram,
			bodyPostingsByBigramId,
			metadataCharIds,
			metadataDocIdsByChar,
			bodyPostingsByCharId,
		identityWitnessTextIdsByDoc,
			identityWitnessSourceMasksByDoc,
		routeWitnessTextIdsByDoc,
			routeWitnessSourceMasksByDoc,
		headingWitnessTextIdsByDoc,
		bodyWitnessOccurrenceTextIdsByBlock: bodyWitnessStringIdsByBlock,
			bodyWitnessOccurrenceStartOffsetsByBlock: bodyWitnessStartOffsetsByBlock,
		});
}

function buildMetadataPostingsByBigram(
	documents: readonly PreparedDocument[],
): number[][] {
	const metadataBigramIds = dedupeSortedNumbers([
		...documents.flatMap((document) => document.identityHanBigramIds),
		...documents.flatMap((document) => document.routeHanBigramIds),
	]);
	const metadataBigramIndexById = new Map(
		metadataBigramIds.map((bigramId, index) => [bigramId, index]),
	);
	const metadataDocIdsByBigram = Array.from(
		{ length: metadataBigramIds.length },
		() => [] as number[],
	);
	for (let docId = 0; docId < documents.length; docId += 1) {
		const document = documents[docId];
		pushBigramPostings(
			metadataDocIdsByBigram,
			dedupeSortedNumbers([
				...document.identityHanBigramIds,
				...document.routeHanBigramIds,
			]),
			docId,
			metadataBigramIndexById,
		);
	}
	return metadataDocIdsByBigram;
}

function buildMetadataPostingsByChar(
	documents: readonly PreparedDocument[],
): number[][] {
	const metadataCharIds = dedupeSortedNumbers([
		...documents.flatMap((document) => document.identityHanCharIds),
		...documents.flatMap((document) => document.routeHanCharIds),
	]);
	const metadataCharIndexById = new Map(
		metadataCharIds.map((charId, index) => [charId, index]),
	);
	const metadataDocIdsByChar = Array.from(
		{ length: metadataCharIds.length },
		() => [] as number[],
	);
	for (let docId = 0; docId < documents.length; docId += 1) {
		const document = documents[docId];
		pushBigramPostings(
			metadataDocIdsByChar,
			dedupeSortedNumbers([
				...document.identityHanCharIds,
				...document.routeHanCharIds,
			]),
			docId,
			metadataCharIndexById,
		);
	}
	return metadataDocIdsByChar;
}

function buildBodyPostingsByBigram(
	documents: readonly PreparedDocument[],
): Map<number, number[]> {
	const bodyPostingsByBigramId = new Map<number, number[]>();
	const allBodyBlocks = documents.flatMap((document) => document.bodyBlocks);
	for (let blockId = 0; blockId < allBodyBlocks.length; blockId += 1) {
		for (const bigramId of allBodyBlocks[blockId]?.hanBigramIds ?? []) {
			let blockIds = bodyPostingsByBigramId.get(bigramId);
			if (!blockIds) {
				blockIds = [];
				bodyPostingsByBigramId.set(bigramId, blockIds);
			}
			blockIds.push(blockId);
		}
	}
	return bodyPostingsByBigramId;
}

function buildBodyPostingsByChar(
	documents: readonly PreparedDocument[],
): Map<number, number[]> {
	const bodyPostingsByCharId = new Map<number, number[]>();
	const allBodyBlocks = documents.flatMap((document) => document.bodyBlocks);
	for (let blockId = 0; blockId < allBodyBlocks.length; blockId += 1) {
		for (const charId of allBodyBlocks[blockId]?.hanCharIds ?? []) {
			let blockIds = bodyPostingsByCharId.get(charId);
			if (!blockIds) {
				blockIds = [];
				bodyPostingsByCharId.set(charId, blockIds);
			}
			blockIds.push(blockId);
		}
	}
	return bodyPostingsByCharId;
}

export function buildStableWitnessMatchKey(text: string): number {
	let hash = 2166136261 >>> 0;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return -(1_500_000_000 + (hash % 500_000_000));
}

function mergeSourceMask(
	target: Map<string, number>,
	familyTexts: readonly string[],
	mask: number,
): void {
	for (const familyText of familyTexts) {
		target.set(familyText, (target.get(familyText) ?? 0) | mask);
	}
}

function mapFamilyTextsToIds(
	familyTexts: readonly string[],
	familyIdByText: ReadonlyMap<string, number>,
): number[] {
	return familyTexts
		.map((familyText) => familyIdByText.get(familyText))
		.filter((familyId): familyId is number => familyId !== undefined);
}


function buildBlockFamilySupportDraft(
	familyTexts: readonly string[],
	supportMasks: readonly number[],
	familyIdByText: ReadonlyMap<string, number>,
): Readonly<{
	familyIds: readonly number[];
	supportMasks: readonly number[];
}> {
	const supportMaskByFamilyId = new Map<number, number>();
	for (let index = 0; index < familyTexts.length; index += 1) {
		const familyId = familyIdByText.get(familyTexts[index] ?? "");
		if (familyId === undefined) {
			continue;
		}
		supportMaskByFamilyId.set(
			familyId,
			(supportMaskByFamilyId.get(familyId) ?? 0) | (supportMasks[index] ?? 0),
		);
	}
	const familyIds = [...supportMaskByFamilyId.keys()].sort((left, right) => left - right);
	return {
		familyIds,
		supportMasks: familyIds.map((familyId) => supportMaskByFamilyId.get(familyId) ?? 0),
	};
}

function buildDocMetadataSourceMasks(
	familyTexts: readonly string[],
	sourceEntries: readonly Readonly<{
		familyTexts: readonly string[];
		mask: number;
	}>[],
): number[] {
	const sourceMaskByFamilyText = new Map<string, number>();
	for (const entry of sourceEntries) {
		mergeSourceMask(sourceMaskByFamilyText, entry.familyTexts, entry.mask);
	}
	return familyTexts.map((familyText) => sourceMaskByFamilyText.get(familyText) ?? 0);
}

function mapStringsToStringIds(
	values: readonly string[],
	stringArenaBuilder: StringArenaBuilder,
	sourceMask: number,
): number[] {
	return values.map((value) => stringArenaBuilder.intern(value, sourceMask));
}

function computeIndexedSurfaceUtf8Bytes(
	documents: readonly IndexedDocument[],
): number {
	return documents.reduce(
		(total, document) =>
			total +
			estimateUtf8Bytes(document.basename ?? "") +
			estimateUtf8Bytes(document.folder ?? "") +
			estimateUtf8Bytes(document.aliases ?? "") +
			estimateUtf8Bytes(document.tags ?? "") +
			estimateUtf8Bytes(document.headings ?? "") +
			estimateUtf8Bytes(document.content ?? ""),
		0,
	);
}

function computeRawMarkdownUtf8Bytes(
	documents: readonly IndexedDocument[],
): number {
	return documents.reduce((total, document) => {
		if (typeof document.size === "number" && document.size > 0) {
			return total + document.size;
		}
		const rawProjection = [
			document.aliases ?? "",
			document.tags ?? "",
			document.headings ?? "",
			document.content ?? "",
		]
			.filter((value) => value.length > 0)
			.join("\n");
		return total + estimateUtf8Bytes(rawProjection);
	}, 0);
}

function dedupeSorted(values: readonly string[]): string[] {
	return [...new Set(values.filter((value) => value.length > 0))].sort((left, right) =>
		left.localeCompare(right),
	);
}

function dedupePreservingOrderStrings(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		if (value.length === 0 || seen.has(value)) {
			continue;
		}
		seen.add(value);
		out.push(value);
	}
	return out;
}

function dedupeSortedNumbers(values: readonly number[]): number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}

function mapWitnessTextsToSourceMasks(
	witnessTexts: readonly string[],
	entries: readonly Readonly<{ text: string; mask: number }>[],
): number[] {
	const maskByText = new Map<string, number>();
	for (const entry of entries) {
		maskByText.set(entry.text, (maskByText.get(entry.text) ?? 0) | entry.mask);
	}
	return witnessTexts.map((text) => maskByText.get(text) ?? 0);
}

function pushBigramPostings(
	postingsByBigram: number[][],
	bigramIds: readonly number[],
	value: number,
	bigramIndexById: ReadonlyMap<number, number>,
): void {
	for (const bigramId of bigramIds) {
		const bigramIndex = bigramIndexById.get(bigramId);
		if (bigramIndex === undefined) {
			continue;
		}
		postingsByBigram[bigramIndex].push(value);
	}
}

function pushPostingMapValues(
	postingsByTermId: Map<number, number[]>,
	termIds: readonly number[],
	value: number,
): void {
	for (const termId of termIds) {
		let values = postingsByTermId.get(termId);
		if (!values) {
			values = [];
			postingsByTermId.set(termId, values);
		}
		values.push(value);
	}
}

function estimateIndexedDocumentRawTextBytes(document: IndexedDocument): number {
	if (typeof document.size === "number" && document.size > 0) {
		return document.size;
	}
	return (
		estimateUtf8Bytes(document.basename ?? "") +
		estimateUtf8Bytes(document.folder ?? "") +
		estimateUtf8Bytes(document.aliases ?? "") +
		estimateUtf8Bytes(document.tags ?? "") +
		estimateUtf8Bytes(document.headings ?? "") +
		estimateUtf8Bytes(document.content ?? "")
	);
}

function estimateUtf8Bytes(text: string): number {
	return textEncoder.encode(text).byteLength;
}

class StringArenaBuilder {
	private readonly stringIdByValue = new Map<string, number>();

	private readonly values: string[] = [];

	private readonly sourceMasksByStringId: number[] = [];

	intern(value: string, sourceMask = 0): number {
		const existingId = this.stringIdByValue.get(value);
		if (existingId !== undefined) {
			this.sourceMasksByStringId[existingId] =
				(this.sourceMasksByStringId[existingId] ?? 0) | sourceMask;
			return existingId;
		}
		const stringId = this.values.length;
		this.values.push(value);
		this.sourceMasksByStringId.push(sourceMask);
		this.stringIdByValue.set(value, stringId);
		return stringId;
	}

	describeSourceUtf8Bytes() {
		let pathBytes = 0;
		let familyBytes = 0;
		let identityWitnessBytes = 0;
		let routeWitnessBytes = 0;
		let headingWitnessBytes = 0;
		let bodyWitnessBytes = 0;
		let multiSourceBytes = 0;
		let unattributedBytes = 0;
		for (let stringId = 0; stringId < this.values.length; stringId += 1) {
			const value = this.values[stringId] ?? "";
			const mask = this.sourceMasksByStringId[stringId] ?? 0;
			const bytes = estimateUtf8Bytes(value);
			if (mask === 0) {
				unattributedBytes += bytes;
				continue;
			}
			if ((mask & (mask - 1)) !== 0) {
				multiSourceBytes += bytes;
				continue;
			}
			switch (mask) {
				case STRING_SOURCE_PATH:
					pathBytes += bytes;
					break;
				case STRING_SOURCE_FAMILY:
					familyBytes += bytes;
					break;
				case STRING_SOURCE_IDENTITY_WITNESS:
					identityWitnessBytes += bytes;
					break;
				case STRING_SOURCE_ROUTE_WITNESS:
					routeWitnessBytes += bytes;
					break;
				case STRING_SOURCE_HEADING_WITNESS:
					headingWitnessBytes += bytes;
					break;
				case STRING_SOURCE_BODY_WITNESS:
					bodyWitnessBytes += bytes;
					break;
				default:
					multiSourceBytes += bytes;
					break;
			}
		}
		return {
			pathBytes,
			familyBytes,
			identityWitnessBytes,
			routeWitnessBytes,
			headingWitnessBytes,
			bodyWitnessBytes,
			multiSourceBytes,
			unattributedBytes,
		} as const;
	}

	build() {
		const offsets: number[] = [];
		const lengths: number[] = [];
		let text = "";
		for (const value of this.values) {
			offsets.push(text.length);
			lengths.push(value.length);
			text += value;
		}
		return {
			text,
			offsets: buildIntegerArray(offsets),
			lengths: buildIntegerArray(lengths),
			count: this.values.length,
		} as const;
	}
}
