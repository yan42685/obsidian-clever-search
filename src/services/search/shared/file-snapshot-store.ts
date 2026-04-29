import { TFile, Vault, htmlToMarkdown } from "obsidian";
import type {
	LexicalHanBodyEvidenceRow,
	LexicalHanDocEvidenceRow,
	DocRegistryRow,
	LexicalBodyEvidenceRow,
	LexicalFuzzyRescueRow,
	LexicalIndexedMetadataRow,
} from "src/services/database/database";
import {
	buildHybridGenerationKey,
	type HybridIndexedFileRef,
} from "src/services/search/hybrid/hybrid-store";
import type {
	ResidentFuzzyRescueIndex,
} from "src/services/search/coverage-lexical-v3/layout/types";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import type { Database } from "src/services/database/database";

const textEncoder = new TextEncoder();

type PersistedFileSnapshotRow = {
	id: string;
	docRef: number;
	plainText: string;
	generation: number;
};

function estimateUtf8Bytes(text: string): number {
	return textEncoder.encode(text).byteLength;
}

function toReadonlyNumbers(values?: ArrayLike<number>): readonly number[] | undefined {
	if (values == null) {
		return undefined;
	}
	return Array.from(values);
}

function hasEntries(values?: ArrayLike<unknown>): boolean {
	return values != null && values.length > 0;
}

type PackedUnsignedLane = Uint8Array | Uint16Array | Uint32Array;

export type LexicalBodyEvidencePublishRow = Omit<
	LexicalBodyEvidenceRow,
	"bodyEvidencePayload"
> & {
	exactShardLocalFamilySlots: ArrayLike<number>;
	exactTokenPositions: ArrayLike<number>;
	supportShardLocalFamilySlots: ArrayLike<number>;
	familySupportMaskByEntry: ArrayLike<number>;
};

type DecodedBodyEvidencePayload = Readonly<{
	exactShardLocalFamilySlots: readonly number[];
	exactTokenPositions: readonly number[];
	supportShardLocalFamilySlots: readonly number[];
	familySupportMaskByEntry: readonly number[];
}>;

const BODY_EVIDENCE_PAYLOAD_VERSION = 1;
const PACKED_LANE_ABSENT = 0;
const PACKED_LANE_U8 = 1;
const PACKED_LANE_U16 = 2;
const PACKED_LANE_U32 = 3;

function encodeBodyEvidencePayload(row: LexicalBodyEvidencePublishRow): Uint8Array {
	const exactShardLocalFamilySlots = packRequiredUnsignedLane(
		row.exactShardLocalFamilySlots,
	);
	const exactTokenPositions = packRequiredUnsignedLane(row.exactTokenPositions);
	const supportShardLocalFamilySlots = packRequiredUnsignedLane(
		row.supportShardLocalFamilySlots,
	);
	const familySupportMaskByEntry = new Uint8Array(row.familySupportMaskByEntry);
	const lanes = [
		exactShardLocalFamilySlots,
		exactTokenPositions,
		supportShardLocalFamilySlots,
		familySupportMaskByEntry,
	];
	const headerBytes = 2 + lanes.length * 5;
	const payloadBytes = lanes.reduce((sum, lane) => sum + lane.byteLength, 0);
	const payload = new Uint8Array(headerBytes + payloadBytes);
	payload[0] = BODY_EVIDENCE_PAYLOAD_VERSION;
	payload[1] = lanes.length;
	const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
	let headerOffset = 2;
	let laneOffset = headerBytes;
	for (const lane of lanes) {
		payload[headerOffset] = encodePackedLaneKind(lane);
		view.setUint32(headerOffset + 1, lane.length, true);
		payload.set(new Uint8Array(lane.buffer, lane.byteOffset, lane.byteLength), laneOffset);
		headerOffset += 5;
		laneOffset += lane.byteLength;
	}
	return payload;
}

function decodeBodyEvidencePayload(payload: Uint8Array): DecodedBodyEvidencePayload {
	if (payload[0] !== BODY_EVIDENCE_PAYLOAD_VERSION) {
		return {
			exactShardLocalFamilySlots: [],
			exactTokenPositions: [],
			supportShardLocalFamilySlots: [],
			familySupportMaskByEntry: [],
		};
	}
	const laneCount = payload[1] ?? 0;
	const headerBytes = 2 + laneCount * 5;
	const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
	const lanes: readonly number[][] = Array.from({ length: laneCount }, (_, index) => {
		const headerOffset = 2 + index * 5;
		const kind = payload[headerOffset] ?? PACKED_LANE_ABSENT;
		const length = view.getUint32(headerOffset + 1, true);
		let byteOffset = headerBytes;
		for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
			const previousKind = payload[2 + previousIndex * 5] ?? PACKED_LANE_ABSENT;
			const previousLength = view.getUint32(2 + previousIndex * 5 + 1, true);
			byteOffset += previousLength * packedLaneBytesPerElement(previousKind);
		}
		return unpackUnsignedLane(payload, byteOffset, kind, length);
	});
	return {
		exactShardLocalFamilySlots: lanes[0] ?? [],
		exactTokenPositions: lanes[1] ?? [],
		supportShardLocalFamilySlots: lanes[2] ?? [],
		familySupportMaskByEntry: lanes[3] ?? [],
	};
}

function packRequiredUnsignedLane(values: ArrayLike<number>): PackedUnsignedLane {
	let maxValue = 0;
	for (let index = 0; index < values.length; index += 1) {
		maxValue = Math.max(maxValue, values[index] ?? 0);
	}
	if (maxValue <= 0xff) {
		return new Uint8Array(Array.from(values));
	}
	if (maxValue <= 0xffff) {
		return new Uint16Array(Array.from(values));
	}
	return new Uint32Array(Array.from(values));
}

function encodePackedLaneKind(lane: PackedUnsignedLane): number {
	if (lane.length === 0) {
		return PACKED_LANE_ABSENT;
	}
	if (lane instanceof Uint8Array) {
		return PACKED_LANE_U8;
	}
	if (lane instanceof Uint16Array) {
		return PACKED_LANE_U16;
	}
	return PACKED_LANE_U32;
}

function packedLaneBytesPerElement(kind: number): 0 | 1 | 2 | 4 {
	switch (kind) {
		case PACKED_LANE_U8:
			return 1;
		case PACKED_LANE_U16:
			return 2;
		case PACKED_LANE_U32:
			return 4;
		default:
			return 0;
	}
}

function unpackUnsignedLane(
	payload: Uint8Array,
	byteOffset: number,
	kind: number,
	length: number,
): number[] {
	const view = new DataView(
		payload.buffer,
		payload.byteOffset,
		payload.byteLength,
	);
	switch (kind) {
		case PACKED_LANE_U8:
			return Array.from(payload.slice(byteOffset, byteOffset + length));
		case PACKED_LANE_U16:
			return Array.from({ length }, (_, index) =>
				view.getUint16(byteOffset + index * 2, true),
			);
		case PACKED_LANE_U32:
			return Array.from({ length }, (_, index) =>
				view.getUint32(byteOffset + index * 4, true),
			);
		default:
			return [];
	}
}

type PersistedFileShadowRow = {
	id: string;
	docRef: number;
	plainText: string;
	generation: number;
};

export type IndexedSnapshotRequest = {
	path: string;
	generation?: number;
};

type IndexedTextRequest = IndexedSnapshotRequest;

export type IndexedTextSnapshotSource = "live" | "indexed" | "shadow";

export type IndexedTextSnapshot = Readonly<{
	path: string;
	text: string;
	generation?: number;
	source: IndexedTextSnapshotSource;
}>;

type IndexedTextPublishRequest = {
	path: string;
	generation?: number;
	text?: string;
};

type IndexedMetadataRequest = IndexedSnapshotRequest;

type IndexedMetadataPublishRequest = {
	path: string;
	generation?: number;
	aliasesText?: string;
	tagsText?: string;
	headingsText?: string;
};

type EnsureDocRegistryEntryRequest = {
	docRef?: number;
	path: string;
	generation?: number;
	deleted?: boolean;
	contentFingerprint?: string;
};

type CurrentFileEntry = {
	path: string;
	cacheSlot: number;
	text: string;
	generation?: number;
};

export type IndexedMetadataSnapshot = Readonly<{
	aliasesText?: string;
	tagsText?: string;
	headingsText?: string;
}>;

export function buildIndexedSnapshotRequestKey(request: IndexedSnapshotRequest): string {
	return `${request.path}\0${request.generation ?? ""}`;
}

export type LexicalBodyEvidenceSnapshot = Readonly<{
	exactShardLocalFamilySlots: readonly number[];
	exactTokenPositions: readonly number[];
	supportEntriesByShardLocalFamilySlot: ReadonlyArray<
		Readonly<{
			shardLocalFamilySlot: number;
			supportMask: number;
		}>
	>;
}>;

export type LexicalHanDocEvidenceSnapshot = Readonly<{
	identityWitnessMatchKeys: readonly number[];
	identityWitnessTexts: readonly string[];
	identityWitnessSourceMasks: readonly number[];
	routeWitnessMatchKeys: readonly number[];
	routeWitnessTexts: readonly string[];
	routeWitnessSourceMasks: readonly number[];
	headingWitnessMatchKeys: readonly number[];
	headingWitnessTexts: readonly string[];
}>;

export type LexicalHanBodyEvidenceSnapshot = Readonly<{
	bodyWitnessMatchKeys: readonly number[];
	bodyWitnessTexts: readonly string[];
	bodyWitnessStartOffsets: readonly number[];
}>;

// Canonical cold-evidence locator for a shard-owned doc evidence slice.
export type LexicalDocEvidenceLocator = Readonly<{
	shardId: string;
	shardGeneration: number;
	docRef: number;
	generation: number;
}>;

// Canonical cold-evidence locator for a shard-owned block evidence slice.
export type LexicalBlockEvidenceLocator = LexicalDocEvidenceLocator &
	Readonly<{
		blockOrdinal: number;
	}>;

// Row ids are the storage-layer implementation keys for shard-owned slice locators.
export function buildLexicalDocEvidenceRowId(
	locator: LexicalDocEvidenceLocator,
): string {
	return `${locator.shardId}:${locator.shardGeneration}:${locator.docRef}:${locator.generation}`;
}

export function buildLexicalBlockEvidenceRowId(
	locator: LexicalBlockEvidenceLocator,
): string {
	return `${locator.shardId}:${locator.shardGeneration}:${locator.docRef}:${locator.generation}:${locator.blockOrdinal}`;
}

const ACTIVE_LEXICAL_FUZZY_RESCUE_ID = "active";

export type FileSnapshotRuntimeMemoryEstimate = {
	capacityBytes: number;
	pathBytes: number;
	currentTextBytes: number;
	generationBytes: number;
	fileCount: number;
	cacheSlotCount: number;
	freeCacheSlotCount: number;
	totalBytes: number;
	largestEntries: Array<{
		path: string;
		totalBytes: number;
		pathBytes: number;
		textBytes: number;
		generationBytes: number;
	}>;
};

export type FileSnapshotAvailabilityDebugInfo = Readonly<{
	path: string;
	expectedGeneration?: number;
	fileExists: boolean;
	fileMtime?: number;
	currentGeneration?: number;
	persistedGeneration?: number;
	shadowGeneration?: number;
	currentGenerationMatch: boolean;
	persistedGenerationMatch: boolean;
	shadowGenerationMatch: boolean;
}>;

@singleton()
export class FileSnapshotStore {
	private static readonly INDEXED_SNAPSHOT_SCAN_BATCH_SIZE = 256;
	private static readonly RUNTIME_REPORT_TOP_ENTRY_LIMIT = 5;
	private static readonly CURRENT_TEXT_CACHE_CAPACITY_BYTES = 32 * 1024 * 1024;
	private static readonly STRING_CODE_UNIT_BYTES = 2;
	private static readonly GENERATION_BYTES = 8;
	private readonly vault = getInstance(Vault);
	private readonly currentFilePathToCacheSlot = new Map<string, number>();
	private readonly currentFileLru = new Map<string, true>();
	private readonly currentCacheSlotTexts: Array<string | undefined> = [];
	private readonly currentCacheSlotGenerations: Array<number | undefined> = [];
	private readonly currentCacheSlotBytes: Array<number | undefined> = [];
	private readonly freeCurrentCacheSlots: number[] = [];
	private currentRuntimeBytes = 0;

	async readCurrentTexts(
		fileOrPaths: ReadonlyArray<TFile | string>,
	): Promise<Map<string, string>> {
		const texts = new Map<string, string>();
		for (const fileOrPath of fileOrPaths) {
			const file = this.resolveFile(fileOrPath);
			if (!(file instanceof TFile)) {
				continue;
			}
			texts.set(file.path, await this.readSearchableFileText(file));
		}
		return texts;
	}

	async readIndexedTexts(
		requests: ReadonlyArray<IndexedTextRequest>,
	): Promise<Map<string, string>> {
		const snapshots = await this.readIndexedTextSnapshots(requests);
		const texts = new Map<string, string>();
		for (const request of requests) {
			const snapshot = snapshots.get(buildIndexedSnapshotRequestKey(request));
			if (snapshot != null) {
				texts.set(request.path, snapshot.text);
			}
		}
		return texts;
	}

	async readIndexedTextSnapshots(
		requests: ReadonlyArray<IndexedTextRequest>,
	): Promise<Map<string, IndexedTextSnapshot>> {
		return await this.readGenerationAlignedTextSnapshots(requests);
	}

	async readIndexedMetadata(
		requests: ReadonlyArray<IndexedMetadataRequest>,
	): Promise<Map<string, IndexedMetadataSnapshot>> {
		const uniquePaths = Array.from(new Set(requests.map((request) => request.path)));
		if (uniquePaths.length === 0) {
			return new Map<string, IndexedMetadataSnapshot>();
		}
		const rows = await this.database.db.lexicalIndexedMetadata.bulkGet(uniquePaths);
		const metadataByPath = new Map<string, IndexedMetadataSnapshot>();
		const rowByPath = new Map<string, LexicalIndexedMetadataRow>();
		for (let index = 0; index < uniquePaths.length; index += 1) {
			const row = rows[index];
			if (!row) {
				continue;
			}
			const path = uniquePaths[index];
			rowByPath.set(path, row);
		}
		for (const request of requests) {
			const row = rowByPath.get(request.path);
			if (!row || !this.isGenerationMatch(row.generation, request.generation)) {
				continue;
			}
			metadataByPath.set(buildIndexedSnapshotRequestKey(request), {
				aliasesText: row.aliasesText,
				tagsText: row.tagsText,
				headingsText: row.headingsText,
			});
		}
		return metadataByPath;
	}

	async inspectIndexedTextAvailability(
		path: string,
		expectedGeneration?: number,
	): Promise<FileSnapshotAvailabilityDebugInfo> {
		const file = this.resolveFile(path);
		const current = this.getCurrentFile(path, false);
		const docRegistryEntry = await this.database.getDocRegistryEntry(path);
		const expectedKey =
			docRegistryEntry == null || expectedGeneration == null
				? undefined
				: buildHybridGenerationKey(docRegistryEntry.docRef, expectedGeneration);
		const [persistedRow, shadowRow] = await Promise.all([
			expectedKey == null
				? Promise.resolve(undefined)
				: this.database.db.fileSnapshots.get(expectedKey),
			expectedKey == null
				? Promise.resolve(undefined)
				: this.database.db.hybridDirtyShadows.get(expectedKey),
		]);
		return {
			path,
			expectedGeneration,
			fileExists: file instanceof TFile,
			fileMtime: file instanceof TFile ? file.stat.mtime : undefined,
			currentGeneration: current?.generation,
			persistedGeneration: persistedRow?.generation,
			shadowGeneration: shadowRow?.generation,
			currentGenerationMatch: this.isGenerationMatch(
				current?.generation,
				expectedGeneration,
			),
			persistedGenerationMatch: this.isGenerationMatch(
				persistedRow?.generation,
				expectedGeneration,
			),
			shadowGenerationMatch: this.isGenerationMatch(
				shadowRow?.generation,
				expectedGeneration,
			),
		};
	}

	async publishIndexedTexts(
		files: ReadonlyArray<IndexedTextPublishRequest>,
	): Promise<void> {
		await this.commitCurrentFilesAsIndexed(files);
	}

	async publishIndexedMetadata(
		files: ReadonlyArray<IndexedMetadataPublishRequest>,
	): Promise<void> {
		if (files.length === 0) {
			return;
		}
		const dedupedFiles = new Map<string, IndexedMetadataPublishRequest>();
		for (const file of files) {
			dedupedFiles.set(file.path, file);
		}
		const normalizedFiles = [...dedupedFiles.values()];
		const docRegistryEntries = await this.database.ensureDocRegistryEntries(
			normalizedFiles.map((file) => ({
				path: file.path,
				generation: file.generation,
				deleted: false,
			})),
		);
		const rows: LexicalIndexedMetadataRow[] = normalizedFiles.map((file) => ({
			docRef: docRegistryEntries.get(file.path)?.docRef,
			filePath: file.path,
			generation: file.generation,
			aliasesText: file.aliasesText ?? "",
			tagsText: file.tagsText ?? "",
			headingsText: file.headingsText ?? "",
		}));
		await this.database.db.lexicalIndexedMetadata.bulkPut(rows);
	}

	async readLexicalFuzzyRescueForLookupKeys(
		fuzzyLookupKeys: ReadonlyArray<string>,
	): Promise<ResidentFuzzyRescueIndex> {
		const fuzzyLookupKeySet = new Set(fuzzyLookupKeys);
		const row = await this.database.db.lexicalFuzzyRescue.get(
			ACTIVE_LEXICAL_FUZZY_RESCUE_ID,
		);
		if (row == null) {
			return {
				candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey: new Map(),
				indexedMetadataFamilyCount: 0,
				fuzzyLookupKeyCount: 0,
				bytes: 0,
			};
		}
		const filteredEntries =
			fuzzyLookupKeys.length === 0
				? row.entries
				: row.entries.filter((entry) =>
						fuzzyLookupKeySet.has(entry.fuzzyLookupKey),
					);
		let filteredBytes = 0;
		for (const entry of filteredEntries) {
			filteredBytes += estimateUtf8Bytes(entry.fuzzyLookupKey) + entry.shardLocalFamilySlots.byteLength;
		}
		return {
			candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey: new Map(
				filteredEntries.map((entry) => [
					entry.fuzzyLookupKey,
					entry.shardLocalFamilySlots,
				]),
			),
			indexedMetadataFamilyCount: row.indexedMetadataFamilyCount,
			fuzzyLookupKeyCount: filteredEntries.length,
			bytes: filteredBytes,
		};
	}

	async readLexicalFuzzyRescue(): Promise<ResidentFuzzyRescueIndex> {
		return this.readLexicalFuzzyRescueForLookupKeys([]);
	}

	async publishLexicalFuzzyRescue(
		fuzzyRescueIndex: ResidentFuzzyRescueIndex,
	): Promise<void> {
		const row: LexicalFuzzyRescueRow = {
			id: ACTIVE_LEXICAL_FUZZY_RESCUE_ID,
			indexedMetadataFamilyCount: fuzzyRescueIndex.indexedMetadataFamilyCount,
			fuzzyLookupKeyCount: fuzzyRescueIndex.fuzzyLookupKeyCount,
			bytes: fuzzyRescueIndex.bytes,
			entries: [
				...fuzzyRescueIndex.candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey.entries(),
			].map(([fuzzyLookupKey, shardLocalFamilySlots]) => ({
					fuzzyLookupKey,
					shardLocalFamilySlots,
				}),
			),
		};
		await this.database.db.lexicalFuzzyRescue.put(row);
	}

	async readLexicalBodyEvidenceForBlocks(
		locators: ReadonlyArray<LexicalBlockEvidenceLocator>,
	): Promise<ReadonlyMap<string, LexicalBodyEvidenceSnapshot>> {
		const uniqueIds = Array.from(
			new Set(locators.map((locator) => buildLexicalBlockEvidenceRowId(locator))),
		);
		if (uniqueIds.length === 0) {
			return new Map<string, LexicalBodyEvidenceSnapshot>();
		}
		const rows = await this.database.db.lexicalBodyEvidence.bulkGet(uniqueIds);
		const evidenceById = new Map<string, LexicalBodyEvidenceSnapshot>();
		for (let index = 0; index < uniqueIds.length; index += 1) {
			const row = rows[index];
			if (row == null) {
				continue;
			}
			const decoded = decodeBodyEvidencePayload(row.bodyEvidencePayload);
			const familySupportMasks = decoded.familySupportMaskByEntry;
			evidenceById.set(uniqueIds[index], {
				exactShardLocalFamilySlots: decoded.exactShardLocalFamilySlots,
				exactTokenPositions: decoded.exactTokenPositions,
				supportEntriesByShardLocalFamilySlot:
					decoded.supportShardLocalFamilySlots.map(
						(shardLocalFamilySlot, supportIndex) => ({
							shardLocalFamilySlot,
							supportMask: familySupportMasks[supportIndex] ?? 0,
						}),
					),
			});
		}
		return evidenceById;
	}

	async publishLexicalBodyEvidence(
		rows: ReadonlyArray<LexicalBodyEvidencePublishRow>,
	): Promise<void> {
		if (rows.length === 0) {
			return;
		}
		const persistedRows = rows
			.filter(
				(row) =>
					hasEntries(row.exactShardLocalFamilySlots) ||
					hasEntries(row.supportShardLocalFamilySlots),
			)
			.map((row) => ({
				id: row.id,
				shardId: row.shardId,
				shardGeneration: row.shardGeneration,
				docRef: row.docRef,
				generation: row.generation,
				blockOrdinal: row.blockOrdinal,
				bodyEvidencePayload: encodeBodyEvidencePayload(row),
			}));
		if (persistedRows.length === 0) {
			return;
		}
		await this.database.db.lexicalBodyEvidence.bulkPut(persistedRows);
	}

	async readLexicalHanDocEvidenceForDocs(
		locators: ReadonlyArray<LexicalDocEvidenceLocator>,
	): Promise<ReadonlyMap<string, LexicalHanDocEvidenceSnapshot>> {
		const uniqueIds = Array.from(
			new Set(locators.map((locator) => buildLexicalDocEvidenceRowId(locator))),
		);
		if (uniqueIds.length === 0) {
			return new Map<string, LexicalHanDocEvidenceSnapshot>();
		}
		const rows = await this.database.db.lexicalHanDocEvidence.bulkGet(uniqueIds);
		const evidenceById = new Map<string, LexicalHanDocEvidenceSnapshot>();
		for (let index = 0; index < uniqueIds.length; index += 1) {
			const row = rows[index];
			if (row == null) {
				continue;
			}
			evidenceById.set(uniqueIds[index], {
				identityWitnessMatchKeys:
					toReadonlyNumbers(row.identityWitnessMatchKeys) ?? [],
				identityWitnessTexts: row.identityWitnessTexts ?? [],
				identityWitnessSourceMasks: Array.from(
					row.identityWitnessSourceMaskByDocEntry,
				),
				routeWitnessMatchKeys:
					toReadonlyNumbers(row.routeWitnessMatchKeys) ?? [],
				routeWitnessTexts: row.routeWitnessTexts ?? [],
				routeWitnessSourceMasks: Array.from(
					row.routeWitnessSourceMaskByDocEntry,
				),
				headingWitnessMatchKeys:
					toReadonlyNumbers(row.headingWitnessMatchKeys) ?? [],
				headingWitnessTexts: row.headingWitnessTexts ?? [],
			});
		}
		return evidenceById;
	}

	async publishLexicalHanDocEvidence(
		rows: ReadonlyArray<LexicalHanDocEvidenceRow>,
	): Promise<void> {
		if (rows.length === 0) {
			return;
		}
		const persistedRows = rows
			.filter(
				(row) =>
					hasEntries(row.identityWitnessMatchKeys) ||
					hasEntries(row.routeWitnessMatchKeys) ||
					hasEntries(row.headingWitnessMatchKeys),
			)
			.map((row) => ({
				id: row.id,
				shardId: row.shardId,
				shardGeneration: row.shardGeneration,
				docRef: row.docRef,
				generation: row.generation,
				identityWitnessMatchKeys:
					row.identityWitnessMatchKeys == null
						? undefined
						: new Int32Array(row.identityWitnessMatchKeys),
				identityWitnessTexts:
					row.identityWitnessTexts == null
						? undefined
						: [...row.identityWitnessTexts],
				identityWitnessSourceMaskByDocEntry: new Uint8Array(
					row.identityWitnessSourceMaskByDocEntry,
				),
				routeWitnessMatchKeys:
					row.routeWitnessMatchKeys == null
						? undefined
						: new Int32Array(row.routeWitnessMatchKeys),
				routeWitnessTexts:
					row.routeWitnessTexts == null ? undefined : [...row.routeWitnessTexts],
				routeWitnessSourceMaskByDocEntry: new Uint8Array(
					row.routeWitnessSourceMaskByDocEntry,
				),
				headingWitnessMatchKeys:
					row.headingWitnessMatchKeys == null
						? undefined
						: new Int32Array(row.headingWitnessMatchKeys),
				headingWitnessTexts:
					row.headingWitnessTexts == null
						? undefined
						: [...row.headingWitnessTexts],
			}));
		if (persistedRows.length === 0) {
			return;
		}
		await this.database.db.lexicalHanDocEvidence.bulkPut(persistedRows);
	}

	async readLexicalHanBodyEvidenceForBlocks(
		locators: ReadonlyArray<LexicalBlockEvidenceLocator>,
	): Promise<ReadonlyMap<string, LexicalHanBodyEvidenceSnapshot>> {
		const uniqueIds = Array.from(
			new Set(locators.map((locator) => buildLexicalBlockEvidenceRowId(locator))),
		);
		if (uniqueIds.length === 0) {
			return new Map<string, LexicalHanBodyEvidenceSnapshot>();
		}
		const rows = await this.database.db.lexicalHanBodyEvidence.bulkGet(uniqueIds);
		const evidenceById = new Map<string, LexicalHanBodyEvidenceSnapshot>();
		for (let index = 0; index < uniqueIds.length; index += 1) {
			const row = rows[index];
			if (row == null) {
				continue;
			}
			evidenceById.set(uniqueIds[index], {
				bodyWitnessMatchKeys:
					toReadonlyNumbers(row.bodyWitnessMatchKeys) ?? [],
				bodyWitnessTexts: row.bodyWitnessTexts ?? [],
				bodyWitnessStartOffsets: Array.from(row.bodyWitnessStartOffsets),
			});
		}
		return evidenceById;
	}

	async publishLexicalHanBodyEvidence(
		rows: ReadonlyArray<LexicalHanBodyEvidenceRow>,
	): Promise<void> {
		if (rows.length === 0) {
			return;
		}
		const persistedRows = rows
			.filter((row) => hasEntries(row.bodyWitnessMatchKeys))
			.map((row) => ({
				id: row.id,
				shardId: row.shardId,
				shardGeneration: row.shardGeneration,
				docRef: row.docRef,
				generation: row.generation,
				blockOrdinal: row.blockOrdinal,
				bodyWitnessMatchKeys:
					row.bodyWitnessMatchKeys == null
						? undefined
						: new Int32Array(row.bodyWitnessMatchKeys),
				bodyWitnessTexts:
					row.bodyWitnessTexts == null ? undefined : [...row.bodyWitnessTexts],
				bodyWitnessStartOffsets: new Uint32Array(row.bodyWitnessStartOffsets),
			}));
		if (persistedRows.length === 0) {
			return;
		}
		await this.database.db.lexicalHanBodyEvidence.bulkPut(persistedRows);
	}

	async notifyHybridIndexedRefsChanged(
		filePaths?: readonly string[],
	): Promise<void> {
		const shadowRowsForAll =
			filePaths === undefined
				? await this.database.db.hybridDirtyShadows.orderBy(":id").toArray()
				: [];
		const paths =
			filePaths !== undefined
				? Array.from(new Set(filePaths))
				: this.pathsForDocRefs(
						await this.database.listDocRegistryEntries(),
						shadowRowsForAll.map((row) => row.docRef),
					);
		if (paths.length === 0) {
			return;
		}

		const registryRowsByPath = await this.database.getDocRegistryEntries(paths);
		const docRefs = paths.map((path) => registryRowsByPath.get(path)?.docRef ?? -1);
		const indexedRefs = await this.database.db.hybridIndexedFileRefs.bulkGet(docRefs);
		const shadowKeys = paths.map((path, index) => {
			const docRef = docRefs[index];
			const generation = indexedRefs[index]?.generation;
			return docRef == null || generation == null
				? undefined
				: buildHybridGenerationKey(docRef, generation);
		});
		const safeShadowKeys = shadowKeys.map((key) => key ?? "__missing__");
		const snapshotKeys = safeShadowKeys;
		const [shadowRows, snapshotRows] = await Promise.all([
			this.database.db.hybridDirtyShadows.bulkGet(safeShadowKeys),
			this.database.db.fileSnapshots.bulkGet(snapshotKeys),
		]);

		const staleKeys: string[] = [];
		for (let index = 0; index < paths.length; index++) {
			const shadowRow = shadowRows[index];
			if (!shadowRow) {
				continue;
			}

			const indexedGeneration = indexedRefs[index]?.generation;
			const shadowGeneration = shadowRow.generation;
			const snapshotGeneration = snapshotRows[index]?.generation;
			const shouldKeep =
				indexedGeneration !== undefined &&
				shadowGeneration !== undefined &&
				shadowGeneration === indexedGeneration &&
				snapshotGeneration !== indexedGeneration;
			if (!shouldKeep) {
				staleKeys.push(shadowRow.id);
			}
		}

		if (staleKeys.length === 0) {
			return;
		}
		await this.database.db.hybridDirtyShadows.bulkDelete(staleKeys);
	}

	async ensureDocRegistryEntry(
		request: EnsureDocRegistryEntryRequest,
	): Promise<DocRegistryRow> {
		return await this.database.ensureDocRegistryEntry(request);
	}

	async getDocRegistryEntry(
		path: string,
	): Promise<DocRegistryRow | undefined> {
		return await this.database.getDocRegistryEntry(path);
	}

	async moveDocRegistryPath(
		oldPath: string,
		newPath: string,
		options?: {
			generation?: number;
			contentFingerprint?: string;
		},
	): Promise<DocRegistryRow | undefined> {
		return await this.database.moveDocRegistryPath(oldPath, newPath, options);
	}

	async markDocRegistryDeleted(
		path: string,
		generation?: number,
	): Promise<void> {
		await this.database.markDocRegistryDeleted(path, generation);
	}

	async putHybridIndexedFileRef(ref: HybridIndexedFileRef): Promise<void> {
		const docRegistryEntry = await this.database.db.docRegistry.get(ref.docRef);
		const now = Date.now();
		if (ref.state === "pending" || ref.state === "failed") {
			if (docRegistryEntry != null) {
				await this.database.db.docRegistry.put({
					...docRegistryEntry,
					denseTargetGeneration: ref.generation,
					denseState: ref.state,
					lastDenseAttemptAt:
						ref.state === "pending"
							? ref.indexedAt ?? now
							: docRegistryEntry.lastDenseAttemptAt,
					nextDenseAttemptAt:
						ref.state === "failed" ? ref.indexedAt ?? now : docRegistryEntry.nextDenseAttemptAt,
					denseAttemptCount:
						ref.state === "pending"
							? (docRegistryEntry.denseAttemptCount ?? 0) + 1
							: docRegistryEntry.denseAttemptCount,
					denseFailureKind:
						ref.state === "failed" ? "embedding_failed" : undefined,
					updatedAt: now,
				});
			}
			return;
		}
		await this.database.db.hybridIndexedFileRefs.put(ref);
		if (docRegistryEntry != null) {
			await this.database.db.docRegistry.put({
				...docRegistryEntry,
				denseReadyGeneration:
					ref.state === "ready" ? ref.generation : docRegistryEntry.denseReadyGeneration,
				denseTargetGeneration: ref.generation,
				denseState: ref.state,
				lastDenseSuccessAt:
					ref.state === "ready" ? ref.indexedAt ?? now : docRegistryEntry.lastDenseSuccessAt,
				lastDenseAttemptAt: ref.indexedAt ?? docRegistryEntry.lastDenseAttemptAt,
				denseFailureKind: undefined,
				updatedAt: now,
			});
		}
		await this.notifyHybridIndexedRefsChanged(
			docRegistryEntry == null ? undefined : [docRegistryEntry.path],
		);
	}

	async getHybridIndexedFileRef(
		filePath: string,
	): Promise<HybridIndexedFileRef | undefined> {
		const docRegistryEntry = await this.database.getDocRegistryEntry(filePath);
		return docRegistryEntry == null
			? undefined
			: await this.database.db.hybridIndexedFileRefs.get(docRegistryEntry.docRef);
	}

	async getHybridIndexedFileRefs(
		filePaths: readonly string[],
	): Promise<Map<string, HybridIndexedFileRef>> {
		const uniquePaths = Array.from(new Set(filePaths));
		if (uniquePaths.length === 0) {
			return new Map<string, HybridIndexedFileRef>();
		}
		const registryRowsByPath = await this.database.getDocRegistryEntries(uniquePaths);
		const rows = await this.database.db.hybridIndexedFileRefs.bulkGet(
			uniquePaths.map((path) => registryRowsByPath.get(path)?.docRef ?? -1),
		);
		const refs = new Map<string, HybridIndexedFileRef>();
		for (let index = 0; index < uniquePaths.length; index++) {
			const row = rows[index];
			if (row) {
				refs.set(uniquePaths[index], row);
			}
		}
		return refs;
	}

	async listHybridIndexedFileRefs(): Promise<HybridIndexedFileRef[]> {
		return await this.database.db.hybridIndexedFileRefs.toArray();
	}

	async deleteHybridIndexedFileRef(filePath: string): Promise<void> {
		const docRegistryEntry = await this.database.getDocRegistryEntry(filePath);
		if (docRegistryEntry != null) {
			await this.database.db.hybridIndexedFileRefs.delete(docRegistryEntry.docRef);
		}
		await this.notifyHybridIndexedRefsChanged([filePath]);
	}

	async clearHybridIndexedFileRefs(): Promise<void> {
		await this.database.db.hybridIndexedFileRefs.clear();
		await this.notifyHybridIndexedRefsChanged();
	}

	private pathsForDocRefs(
		registryRows: readonly DocRegistryRow[],
		docRefs: readonly number[],
	): string[] {
		const pathByDocRef = new Map(
			registryRows
				.filter((row) => !row.deleted)
				.map((row) => [row.docRef, row.path] as const),
		);
		return Array.from(
			new Set(
				docRefs
					.map((docRef) => pathByDocRef.get(docRef))
					.filter((path): path is string => typeof path === "string"),
			),
		);
	}

	async removeFiles(filePaths: readonly string[]): Promise<void> {
		for (const filePath of filePaths) {
			this.deleteCurrentFile(filePath);
		}
		await this.deletePersistedFiles(filePaths);
		await Promise.all(
			filePaths.map(async (filePath) => {
				await this.database.markDocRegistryDeleted(filePath);
			}),
		);
	}

	async retainOnlyFiles(validPaths: ReadonlySet<string>): Promise<void> {
		for (const path of Array.from(this.currentFilePathToCacheSlot.keys())) {
			if (!validPaths.has(path)) {
				this.deleteCurrentFile(path);
			}
		}
		const docRegistryEntries = await this.database.listDocRegistryEntries();
		const validDocRefs = new Set(
			docRegistryEntries
				.filter((row) => validPaths.has(row.path) && !row.deleted)
				.map((row) => row.docRef),
		);
		await this.deleteDocRefRowsNotIn(
			() => this.database.db.fileSnapshots,
			(keys) => this.database.db.fileSnapshots.bulkDelete(keys),
			validDocRefs,
			(row: PersistedFileSnapshotRow) => row.id,
		);
		await this.deleteRowsNotIn(
			() => this.database.db.lexicalIndexedMetadata,
			(paths) => this.database.db.lexicalIndexedMetadata.bulkDelete(paths),
			validPaths,
			(row: { filePath: string }) => row.filePath,
		);
		await this.deleteDocRefRowsNotIn(
			() => this.database.db.hybridIndexedFileRefs,
			(keys) => this.database.db.hybridIndexedFileRefs.bulkDelete(keys),
			validDocRefs,
			(row: HybridIndexedFileRef) => row.docRef,
		);
		await this.deleteDocRefRowsNotIn(
			() => this.database.db.hybridDirtyShadows,
			(keys) => this.database.db.hybridDirtyShadows.bulkDelete(keys),
			validDocRefs,
			(row: PersistedFileShadowRow) => row.id,
		);
		await Promise.all(
			docRegistryEntries
				.filter((row) => !validPaths.has(row.path))
				.map(async (row) => {
					await this.database.markDocRegistryDeleted(row.path);
				}),
		);
	}

	private async readSearchableFileText(fileOrPath: TFile | string): Promise<string> {
		const file = this.resolveFile(fileOrPath);
		if (!(file instanceof TFile)) {
			return "";
		}
		const current = this.getCurrentFile(file.path);
		const cachedText = current?.text;
		const cachedGeneration = current?.generation;
		if (
			cachedText !== undefined &&
			(cachedGeneration === undefined ||
				file.stat.mtime === undefined ||
				cachedGeneration >= file.stat.mtime)
		) {
			return cachedText;
		}
		const docRegistryEntry = await this.database.getDocRegistryEntry(file.path);
		const indexedSnapshot =
			docRegistryEntry == null
				? undefined
				: await this.database.db.fileSnapshots.get(
						buildHybridGenerationKey(docRegistryEntry.docRef, docRegistryEntry.liveGeneration),
					);
		if (
			indexedSnapshot &&
			this.isIndexedSnapshotAligned(
				indexedSnapshot.generation,
				file.stat.mtime,
			)
		) {
			return this.writeCurrentFileText(
				file.path,
				indexedSnapshot.plainText,
				indexedSnapshot.generation ?? file.stat.mtime,
			);
		}
		return await this.readCurrentFileText(file);
	}

	private async readCurrentFileText(fileOrPath: TFile | string): Promise<string> {
		const file = this.resolveFile(fileOrPath);
		if (!(file instanceof TFile)) {
			return "";
		}
		const current = this.getCurrentFile(file.path);
		const cachedText = current?.text;
		const cachedGeneration = current?.generation;
		if (
			cachedText !== undefined &&
			(cachedGeneration === undefined ||
				file.stat.mtime === undefined ||
				cachedGeneration >= file.stat.mtime)
		) {
			return cachedText;
		}
		const plainText = await this.vault.cachedRead(file);
		const normalized =
			file.extension === "html" ? this.normalizeHtmlToText(plainText) : plainText;
		return this.writeCurrentFileText(file.path, normalized, file.stat.mtime);
	}

	resetRuntimeState(): void {
		this.currentFilePathToCacheSlot.clear();
		this.currentFileLru.clear();
		this.currentCacheSlotTexts.length = 0;
		this.currentCacheSlotGenerations.length = 0;
		this.currentCacheSlotBytes.length = 0;
		this.freeCurrentCacheSlots.length = 0;
		this.currentRuntimeBytes = 0;
	}

	private writeCurrentFileText(
		path: string,
		text: string,
		generation?: number,
	): string {
		const existing = this.getCurrentFile(path, false);
		const existingText = existing?.text;
		const existingGeneration = existing?.generation;
		if (
			existingText !== undefined &&
			!this.shouldReplaceCurrentEntry(existingGeneration, generation)
		) {
			this.touchCurrentFile(path);
			return existingText;
		}
		const entryBytes = this.estimateCurrentEntryBytes(path, text, generation);
		if (
			entryBytes >
			FileSnapshotStore.CURRENT_TEXT_CACHE_CAPACITY_BYTES
		) {
			this.deleteCurrentFile(path);
			return text;
		}
		const cacheSlot = this.ensureCurrentCacheSlot(path);
		const previousBytes = this.currentCacheSlotBytes[cacheSlot] ?? 0;
		this.currentCacheSlotTexts[cacheSlot] = text;
		this.currentCacheSlotGenerations[cacheSlot] = generation;
		this.currentCacheSlotBytes[cacheSlot] = entryBytes;
		this.currentRuntimeBytes += entryBytes - previousBytes;
		this.touchCurrentFile(path);
		this.enforceCurrentTextCacheBudget();
		return text;
	}

	private deleteCurrentFile(path: string): void {
		const cacheSlot = this.currentFilePathToCacheSlot.get(path);
		if (cacheSlot === undefined) {
			return;
		}
		this.currentFilePathToCacheSlot.delete(path);
		this.currentFileLru.delete(path);
		this.currentRuntimeBytes = Math.max(
			0,
			this.currentRuntimeBytes - (this.currentCacheSlotBytes[cacheSlot] ?? 0),
		);
		this.currentCacheSlotTexts[cacheSlot] = undefined;
		this.currentCacheSlotGenerations[cacheSlot] = undefined;
		this.currentCacheSlotBytes[cacheSlot] = undefined;
		if (cacheSlot === this.currentCacheSlotTexts.length - 1) {
			this.trimTrailingCurrentCacheSlots();
			return;
		}
		this.freeCurrentCacheSlots.push(cacheSlot);
	}

	getRuntimeMemoryEstimate(): FileSnapshotRuntimeMemoryEstimate {
		let pathBytes = 0;
		let currentTextBytes = 0;
		let generationBytes = 0;
		const largestEntries: FileSnapshotRuntimeMemoryEstimate["largestEntries"] = [];

		for (const [path, cacheSlot] of this.currentFilePathToCacheSlot) {
			const text = this.currentCacheSlotTexts[cacheSlot];
			if (text === undefined) {
				continue;
			}
			const entryPathBytes = this.estimateStringBytes(path);
			const entryTextBytes = this.estimateStringBytes(text);
			const entryGenerationBytes =
				this.currentCacheSlotGenerations[cacheSlot] !== undefined
					? FileSnapshotStore.GENERATION_BYTES
					: 0;
			pathBytes += entryPathBytes;
			currentTextBytes += entryTextBytes;
			generationBytes += entryGenerationBytes;
			largestEntries.push({
				path,
				totalBytes: entryPathBytes + entryTextBytes + entryGenerationBytes,
				pathBytes: entryPathBytes,
				textBytes: entryTextBytes,
				generationBytes: entryGenerationBytes,
			});
		}

		largestEntries.sort((left, right) => right.totalBytes - left.totalBytes);

		return {
			capacityBytes: FileSnapshotStore.CURRENT_TEXT_CACHE_CAPACITY_BYTES,
			pathBytes,
			currentTextBytes,
			generationBytes,
			fileCount: this.currentFilePathToCacheSlot.size,
			cacheSlotCount: this.currentCacheSlotTexts.length,
			freeCacheSlotCount: this.freeCurrentCacheSlots.length,
			totalBytes: this.currentRuntimeBytes,
			largestEntries: largestEntries.slice(
				0,
				FileSnapshotStore.RUNTIME_REPORT_TOP_ENTRY_LIMIT,
			),
		};
	}

	private async commitCurrentFilesAsIndexed(
		files: ReadonlyArray<IndexedTextPublishRequest>,
	): Promise<void> {
		await this.ensureCurrentEntriesForPublish(files);
		const candidates: Array<{
			path: string;
			text: string;
			generation: number;
		}> = [];
		for (const file of files) {
			const candidate = this.resolveIndexedPublishCandidate(file);
			if (!candidate || candidate.generation === undefined) {
				continue;
			}
			candidates.push({
				path: file.path,
				text: candidate.text,
				generation: candidate.generation,
			});
		}
		if (candidates.length === 0) {
			return;
		}
		const docRegistryEntries = await this.database.ensureDocRegistryEntries(
			candidates.map((file) => ({
				path: file.path,
				generation: file.generation,
				deleted: false,
			})),
		);
		const rows: PersistedFileSnapshotRow[] = [];
		for (const candidate of candidates) {
			const docRegistryEntry = docRegistryEntries.get(candidate.path);
			if (docRegistryEntry == null) {
				continue;
			}
			rows.push({
				id: buildHybridGenerationKey(docRegistryEntry.docRef, candidate.generation),
				docRef: docRegistryEntry.docRef,
				plainText: candidate.text,
				generation: candidate.generation,
			});
		}
		await this.preserveIndexedGenerationShadows(candidates);
		await this.database.db.fileSnapshots.bulkPut(rows);
	}

	private resolveIndexedPublishCandidate(
		file: IndexedTextPublishRequest,
	): { text: string; generation?: number } | undefined {
		if (file.text !== undefined) {
			return {
				text: file.text,
				generation: file.generation ?? this.getCurrentFileGeneration(file.path),
			};
		}

		const current = this.getCurrentFile(file.path);
		if (!current || !this.isGenerationMatch(current.generation, file.generation)) {
			return undefined;
		}

		return {
			text: current.text,
			generation: file.generation ?? current.generation,
		};
	}

	private async deletePersistedFiles(filePaths: readonly string[]): Promise<void> {
		if (filePaths.length === 0) {
			return;
		}
		const uniquePaths = Array.from(new Set(filePaths));
		const registryRowsByPath = await this.database.getDocRegistryEntries(uniquePaths);
		const generationKeys = uniquePaths
			.map((path) => {
				const row = registryRowsByPath.get(path);
				return row == null
					? undefined
					: buildHybridGenerationKey(row.docRef, row.liveGeneration);
			})
			.filter((key): key is string => key !== undefined);
		await Promise.all([
			this.database.db.fileSnapshots.bulkDelete(generationKeys),
			this.database.db.lexicalIndexedMetadata.bulkDelete(uniquePaths),
			this.database.db.hybridDirtyShadows.bulkDelete(generationKeys),
		]);
	}

	private async readGenerationAlignedTexts(
		requests: ReadonlyArray<IndexedSnapshotRequest>,
	): Promise<Map<string, string>> {
		const snapshots = await this.readGenerationAlignedTextSnapshots(requests);
		const texts = new Map<string, string>();
		for (const request of requests) {
			const snapshot = snapshots.get(buildIndexedSnapshotRequestKey(request));
			if (snapshot != null) {
				texts.set(request.path, snapshot.text);
			}
		}
		return texts;
	}

	private async readGenerationAlignedTextSnapshots(
		requests: ReadonlyArray<IndexedSnapshotRequest>,
	): Promise<Map<string, IndexedTextSnapshot>> {
		const snapshots = new Map<string, IndexedTextSnapshot>();
		const missingRequests: IndexedSnapshotRequest[] = [];

		for (const request of requests) {
			const current = this.getCurrentFile(request.path);
			if (current && this.isGenerationMatch(current.generation, request.generation)) {
				snapshots.set(buildIndexedSnapshotRequestKey(request), {
					path: request.path,
					text: current.text,
					generation: current.generation,
					source: "live",
				});
				continue;
			}
			missingRequests.push(request);
		}

		if (missingRequests.length === 0) {
			return snapshots;
		}

		const registryRowsByPath = await this.database.getDocRegistryEntries(
			missingRequests.map((request) => request.path),
		);
		const persistedKeys = missingRequests.map((request) => {
			const row = registryRowsByPath.get(request.path);
			const expectedGeneration = request.generation ?? row?.liveGeneration;
			return row == null || expectedGeneration == null
				? undefined
				: buildHybridGenerationKey(row.docRef, expectedGeneration);
		});
		const persistedRows = await this.database.db.fileSnapshots.bulkGet(
			persistedKeys.map((key) => key ?? "__missing__"),
		);
		const shadowMissingRequests: IndexedSnapshotRequest[] = [];
		for (let index = 0; index < missingRequests.length; index++) {
			const row = persistedRows[index];
			const request = missingRequests[index];
			const expectedGeneration = request.generation;
			if (row && this.isGenerationMatch(row.generation, expectedGeneration)) {
				snapshots.set(buildIndexedSnapshotRequestKey(request), {
					path: request.path,
					text: row.plainText,
					generation: row.generation,
					source: "indexed",
				});
				continue;
			}
			shadowMissingRequests.push(request);
		}

		if (shadowMissingRequests.length === 0) {
			return snapshots;
		}

		const shadowKeys = shadowMissingRequests.map((request) => {
			const registryRow = registryRowsByPath.get(request.path);
			const expectedGeneration = request.generation;
			return registryRow == null || expectedGeneration == null
				? undefined
				: buildHybridGenerationKey(registryRow.docRef, expectedGeneration);
		});
		const shadowRows = await this.database.db.hybridDirtyShadows.bulkGet(
			shadowKeys.map((key) => key ?? "__missing__"),
		);
		for (let index = 0; index < shadowMissingRequests.length; index++) {
			const row = shadowRows[index];
			if (!row) {
				continue;
			}
			const request = shadowMissingRequests[index];
			const expectedGeneration = request.generation;
			if (!this.isGenerationMatch(row.generation, expectedGeneration)) {
				continue;
			}
			snapshots.set(buildIndexedSnapshotRequestKey(request), {
				path: request.path,
				text: row.plainText,
				generation: row.generation,
				source: "shadow",
			});
		}

		return snapshots;
	}

	private normalizeHtmlToText(htmlText: string): string {
		return htmlToMarkdown(htmlText)
			.replace(/\[([^[\]]+)\]\([^()]*\)/g, "$1")
			.replace(/\*\*(.*?)\*\*/g, "$1")
			.replace(/`(.*?)`/g, "$1");
	}

	private shouldReplaceCurrentEntry(
		existingGeneration: number | undefined,
		nextGeneration: number | undefined,
	): boolean {
		if (existingGeneration === undefined) {
			return true;
		}
		if (nextGeneration === undefined) {
			return false;
		}
		return nextGeneration >= existingGeneration;
	}

	private isGenerationMatch(
		actualGeneration: number | undefined,
		expectedGeneration: number | undefined,
	): boolean {
		if (expectedGeneration === undefined) {
			return true;
		}
		return actualGeneration !== undefined && actualGeneration === expectedGeneration;
	}

	private isIndexedSnapshotAligned(
		snapshotGeneration: number | undefined,
		fileGeneration: number | undefined,
	): boolean {
		if (fileGeneration === undefined) {
			return true;
		}
		return (
			snapshotGeneration !== undefined && snapshotGeneration === fileGeneration
		);
	}

	private resolveFile(fileOrPath: TFile | string): TFile | null {
		const file =
			typeof fileOrPath === "string"
				? this.vault.getAbstractFileByPath(fileOrPath)
				: fileOrPath;
		return file instanceof TFile ? file : null;
	}

	private async ensureCurrentEntriesForPublish(
		files: ReadonlyArray<IndexedTextPublishRequest>,
	): Promise<void> {
		for (const file of files) {
			if (file.text !== undefined) {
				this.writeCurrentFileText(file.path, file.text, file.generation);
				continue;
			}
			const currentText = this.getCurrentFileText(file.path);
			const currentGeneration = this.getCurrentFileGeneration(file.path);
			if (
				currentText !== undefined &&
				this.isGenerationMatch(currentGeneration, file.generation)
			) {
				continue;
			}
			await this.hydrateCurrentEntryForPublish(file.path, file.generation);
		}
	}

	private async hydrateCurrentEntryForPublish(
		path: string,
		expectedGeneration?: number,
	): Promise<void> {
		const file = this.resolveFile(path);
		if (!(file instanceof TFile)) {
			return;
		}
		if (
			expectedGeneration !== undefined &&
			file.stat.mtime !== undefined &&
			file.stat.mtime !== expectedGeneration
		) {
			return;
		}
		await this.readCurrentFileText(file);
	}

	private async preserveIndexedGenerationShadows(
		files: ReadonlyArray<{ path: string; generation?: number }>,
	): Promise<void> {
		const dedupedFiles: Array<{ path: string; generation?: number }> = [];
		const seenPaths = new Set<string>();
		for (const file of files) {
			if (seenPaths.has(file.path)) {
				continue;
			}
			seenPaths.add(file.path);
			dedupedFiles.push(file);
		}
		if (dedupedFiles.length === 0) {
			return;
		}
		const paths = dedupedFiles.map((file) => file.path);
		const registryRowsByPath = await this.database.getDocRegistryEntries(paths);
		const docRefs = paths.map((path) => registryRowsByPath.get(path)?.docRef ?? -1);
		const indexedRefs = await this.database.db.hybridIndexedFileRefs.bulkGet(docRefs);
		const currentKeys = dedupedFiles.map((file, index) => {
			const docRef = docRefs[index];
			const generation =
				indexedRefs[index]?.generation ?? registryRowsByPath.get(file.path)?.liveGeneration;
			return docRef == null || generation == null
				? undefined
				: buildHybridGenerationKey(docRef, generation);
		});
		const currentRows = await this.database.db.fileSnapshots.bulkGet(
			currentKeys.map((key) => key ?? "__missing__"),
		);
		const shadowRows: PersistedFileShadowRow[] = [];
		for (let index = 0; index < dedupedFiles.length; index++) {
			const indexedRef = indexedRefs[index];
			const currentRow = currentRows[index];
			const nextGeneration = dedupedFiles[index].generation;
			if (!indexedRef || !currentRow) {
				continue;
			}
			if (
				indexedRef.generation === undefined ||
				currentRow.generation === undefined ||
				indexedRef.generation !== currentRow.generation
			) {
				continue;
			}
			if (nextGeneration !== undefined && indexedRef.generation === nextGeneration) {
				continue;
			}
			shadowRows.push({
				id: buildHybridGenerationKey(currentRow.docRef, currentRow.generation),
				docRef: currentRow.docRef,
				plainText: currentRow.plainText,
				generation: currentRow.generation,
			});
		}
		if (shadowRows.length === 0) {
			return;
		}
		await this.database.db.hybridDirtyShadows.bulkPut(shadowRows);
	}

	private getCurrentFile(
		path: string,
		touch = true,
	): CurrentFileEntry | undefined {
		const cacheSlot = this.currentFilePathToCacheSlot.get(path);
		if (cacheSlot === undefined) {
			return undefined;
		}
		const text = this.currentCacheSlotTexts[cacheSlot];
		if (text === undefined) {
			return undefined;
		}
		if (touch) {
			this.touchCurrentFile(path);
		}
		return {
			path,
			cacheSlot,
			text,
			generation: this.currentCacheSlotGenerations[cacheSlot],
		};
	}

	private getCurrentFileText(path: string): string | undefined {
		return this.getCurrentFile(path)?.text;
	}

	private getCurrentFileGeneration(path: string): number | undefined {
		return this.getCurrentFile(path)?.generation;
	}

	private ensureCurrentCacheSlot(path: string): number {
		const existingCacheSlot = this.currentFilePathToCacheSlot.get(path);
		if (existingCacheSlot !== undefined) {
			return existingCacheSlot;
		}
		const recycledCacheSlot = this.freeCurrentCacheSlots.pop();
		if (recycledCacheSlot !== undefined) {
			this.currentFilePathToCacheSlot.set(path, recycledCacheSlot);
			return recycledCacheSlot;
		}
		const nextCacheSlot = this.currentCacheSlotTexts.length;
		this.currentFilePathToCacheSlot.set(path, nextCacheSlot);
		this.currentCacheSlotTexts.push(undefined);
		this.currentCacheSlotGenerations.push(undefined);
		this.currentCacheSlotBytes.push(undefined);
		return nextCacheSlot;
	}

	private trimTrailingCurrentCacheSlots(): void {
		while (this.currentCacheSlotTexts.length > 0) {
			const lastCacheSlot = this.currentCacheSlotTexts.length - 1;
			if (this.currentCacheSlotTexts[lastCacheSlot] !== undefined) {
				return;
			}
			this.currentCacheSlotTexts.pop();
			this.currentCacheSlotGenerations.pop();
			this.currentCacheSlotBytes.pop();
			const freeCacheSlotIndex =
				this.freeCurrentCacheSlots.lastIndexOf(lastCacheSlot);
			if (freeCacheSlotIndex >= 0) {
				this.freeCurrentCacheSlots.splice(freeCacheSlotIndex, 1);
			}
		}
	}

	private touchCurrentFile(path: string): void {
		if (!this.currentFilePathToCacheSlot.has(path)) {
			return;
		}
		this.currentFileLru.delete(path);
		this.currentFileLru.set(path, true);
	}

	private enforceCurrentTextCacheBudget(): void {
		while (
			this.currentRuntimeBytes >
			FileSnapshotStore.CURRENT_TEXT_CACHE_CAPACITY_BYTES
		) {
			const oldestPath = this.currentFileLru.keys().next().value;
			if (typeof oldestPath !== "string") {
				return;
			}
			this.deleteCurrentFile(oldestPath);
		}
	}

	private estimateCurrentEntryBytes(
		path: string,
		text: string,
		generation?: number,
	): number {
		return (
			this.estimateStringBytes(path) +
			this.estimateStringBytes(text) +
			(generation !== undefined ? FileSnapshotStore.GENERATION_BYTES : 0)
		);
	}

	private estimateStringBytes(value: string): number {
		return value.length * FileSnapshotStore.STRING_CODE_UNIT_BYTES;
	}

	private async deleteRowsNotIn(
		getTable: () => { orderBy: (index: string) => any; where: (index: string) => any },
		deleteRows: (paths: string[]) => Promise<void>,
		validPaths: ReadonlySet<string>,
		getPath: (row: any) => string,
	): Promise<void> {
		let lastPath: string | null = null;
		while (true) {
			const rows: any[] =
				lastPath === null
					? await getTable()
						.orderBy(":id")
						.limit(FileSnapshotStore.INDEXED_SNAPSHOT_SCAN_BATCH_SIZE)
						.toArray()
					: await getTable()
						.where(":id")
						.above(lastPath)
						.limit(FileSnapshotStore.INDEXED_SNAPSHOT_SCAN_BATCH_SIZE)
						.toArray();
			if (rows.length === 0) {
				return;
			}

			const stalePaths = rows
				.map((row) => getPath(row))
				.filter((path) => !validPaths.has(path));
			if (stalePaths.length > 0) {
				await deleteRows(stalePaths);
			}

			lastPath = getPath(rows[rows.length - 1]);
		}
	}

	private async deleteDocRefRowsNotIn<Row extends { docRef: number }, Key>(
		getTable: () => { orderBy: (index: string) => any; where: (index: string) => any },
		deleteRows: (keys: Key[]) => Promise<void>,
		validDocRefs: ReadonlySet<number>,
		getKey: (row: Row) => Key,
	): Promise<void> {
		let lastKey: Key | null = null;
		while (true) {
			const rows: Row[] =
				lastKey === null
					? await getTable()
						.orderBy(":id")
						.limit(FileSnapshotStore.INDEXED_SNAPSHOT_SCAN_BATCH_SIZE)
						.toArray()
					: await getTable()
						.where(":id")
						.above(lastKey)
						.limit(FileSnapshotStore.INDEXED_SNAPSHOT_SCAN_BATCH_SIZE)
						.toArray();
			if (rows.length === 0) {
				return;
			}

			const staleKeys = rows
				.filter((row) => !validDocRefs.has(row.docRef))
				.map((row) => getKey(row));
			if (staleKeys.length > 0) {
				await deleteRows(staleKeys);
			}

			lastKey = getKey(rows[rows.length - 1]);
		}
	}

	private get database(): Database {
		const { Database } =
			// Delay loading the Dexie-backed module so lexical-only tests do not have
			// to parse the decorated database class eagerly.
			require("src/services/database/database") as typeof import("src/services/database/database");
		return getInstance(Database);
	}
}
