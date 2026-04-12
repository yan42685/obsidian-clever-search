import type {
	CoverageLexicalV2CanonicalTermId,
	CoverageLexicalV2CanonicalTermPoolState,
} from "./coverage-lexical-v2-index-store-types";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const PACKED_OFFSET_MIN_CAPACITY = 16;
const HASH_DIRECTORY_MIN_BUCKET_COUNT = 32;
const HASH_DIRECTORY_MAX_LOAD_FACTOR = 0.75;

type CoverageLexicalV2PackedOffsets = {
	values: Uint16Array | Uint32Array;
	count: number;
	widthBytes: 2 | 4;
};

type CoverageLexicalV2PackedHashDirectory = {
	bucketMask: number;
	bucketHeads: Int32Array;
	nextTermIds: Int32Array;
};

export type CoverageLexicalV2CanonicalTermPool = {
	termOffsets: CoverageLexicalV2PackedOffsets;
	termHashDirectory: CoverageLexicalV2PackedHashDirectory;
	arenaBytes: Uint8Array;
	arenaLength: number;
};

export function createCoverageLexicalV2CanonicalTermPool(): CoverageLexicalV2CanonicalTermPool {
	return {
		termOffsets: createCoverageLexicalV2PackedOffsets(),
		termHashDirectory: createCoverageLexicalV2PackedHashDirectory(),
		arenaBytes: new Uint8Array(0),
		arenaLength: 0,
	};
}

export function clearCoverageLexicalV2CanonicalTermPool(
	pool: CoverageLexicalV2CanonicalTermPool,
): void {
	pool.termOffsets = createCoverageLexicalV2PackedOffsets();
	pool.termHashDirectory = createCoverageLexicalV2PackedHashDirectory();
	pool.arenaBytes = new Uint8Array(0);
	pool.arenaLength = 0;
}

export function restoreCoverageLexicalV2CanonicalTermPool(
	pool: CoverageLexicalV2CanonicalTermPool,
	state: CoverageLexicalV2CanonicalTermPoolState,
): void {
	clearCoverageLexicalV2CanonicalTermPool(pool);
	pool.termOffsets = buildCoverageLexicalV2PackedOffsets(state.termOffsets);
	pool.arenaBytes = Uint8Array.from(state.arenaBytes);
	pool.arenaLength = pool.arenaBytes.length;
	pool.termHashDirectory = buildCoverageLexicalV2PackedHashDirectory(
		pool.termOffsets.count,
	);
	for (let termId = 0; termId < pool.termOffsets.count; termId += 1) {
		const hash = hashCoverageLexicalV2Bytes(
			pool.arenaBytes,
			getCoverageLexicalV2PackedOffset(pool.termOffsets, termId),
			getCoverageLexicalV2CanonicalTermEndOffset(pool, termId),
		);
		insertCoverageLexicalV2PackedHashTerm(pool.termHashDirectory, hash, termId);
	}
}

export function serializeCoverageLexicalV2CanonicalTermPool(
	pool: CoverageLexicalV2CanonicalTermPool,
): CoverageLexicalV2CanonicalTermPoolState {
	return {
		arenaBytes: Array.from(pool.arenaBytes.subarray(0, pool.arenaLength)),
		termOffsets: serializeCoverageLexicalV2PackedOffsets(pool.termOffsets),
	};
}

export function getCoverageLexicalV2CanonicalTermCount(
	pool: CoverageLexicalV2CanonicalTermPool,
): number {
	return pool.termOffsets.count;
}

export function findCoverageLexicalV2CanonicalTermId(
	pool: CoverageLexicalV2CanonicalTermPool,
	term: string,
): CoverageLexicalV2CanonicalTermId | undefined {
	const bytes = textEncoder.encode(term);
	return findCoverageLexicalV2CanonicalTermIdByBytes(pool, bytes);
}

export function internCoverageLexicalV2CanonicalTerm(
	pool: CoverageLexicalV2CanonicalTermPool,
	term: string,
): CoverageLexicalV2CanonicalTermId {
	const bytes = textEncoder.encode(term);
	const existing = findCoverageLexicalV2CanonicalTermIdByBytes(pool, bytes);
	if (existing !== undefined) {
		return existing;
	}
	const termId = pool.termOffsets.count;
	const offset = appendCoverageLexicalV2CanonicalBytes(pool, bytes);
	pushCoverageLexicalV2PackedOffset(pool.termOffsets, offset);
	const hash = hashCoverageLexicalV2Bytes(bytes, 0, bytes.length);
	ensureCoverageLexicalV2PackedHashDirectoryCapacity(
		pool,
		pool.termOffsets.count,
	);
	insertCoverageLexicalV2PackedHashTerm(pool.termHashDirectory, hash, termId);
	return termId;
}

export function decodeCoverageLexicalV2CanonicalTerm(
	pool: CoverageLexicalV2CanonicalTermPool,
	termId: CoverageLexicalV2CanonicalTermId,
): string {
	const offset = getCoverageLexicalV2PackedOffset(pool.termOffsets, termId);
	const byteLength = getCoverageLexicalV2CanonicalTermByteLength(pool, termId);
	if (offset < 0 || byteLength <= 0) {
		return "";
	}
	return textDecoder.decode(pool.arenaBytes.subarray(offset, offset + byteLength));
}

export function getCoverageLexicalV2CanonicalTermByteLength(
	pool: CoverageLexicalV2CanonicalTermPool,
	termId: CoverageLexicalV2CanonicalTermId,
): number {
	const offset = getCoverageLexicalV2PackedOffset(pool.termOffsets, termId);
	if (offset < 0 || offset >= pool.arenaLength) {
		return 0;
	}
	const nextOffset = getCoverageLexicalV2CanonicalTermEndOffset(pool, termId);
	return Math.max(0, nextOffset - offset);
}

export function estimateCoverageLexicalV2CanonicalTermPoolBytes(
	pool: CoverageLexicalV2CanonicalTermPool,
): number {
	return pool.arenaLength + pool.termOffsets.count * pool.termOffsets.widthBytes;
}

function findCoverageLexicalV2CanonicalTermIdByBytes(
	pool: CoverageLexicalV2CanonicalTermPool,
	bytes: Uint8Array,
): CoverageLexicalV2CanonicalTermId | undefined {
	const hash = hashCoverageLexicalV2Bytes(bytes, 0, bytes.length);
	for (
		let candidateId = getCoverageLexicalV2PackedHashBucketHead(
			pool.termHashDirectory,
			hash,
		);
		candidateId >= 0;
		candidateId = pool.termHashDirectory.nextTermIds[candidateId] ?? -1
	) {
		const offset = getCoverageLexicalV2PackedOffset(pool.termOffsets, candidateId);
		const byteLength = getCoverageLexicalV2CanonicalTermByteLength(
			pool,
			candidateId,
		);
		if (
			byteLength === bytes.length &&
			equalsCoverageLexicalV2CanonicalBytes(
				pool.arenaBytes,
				offset,
				bytes,
			)
		) {
			return candidateId;
		}
	}
	return undefined;
}

function getCoverageLexicalV2CanonicalTermEndOffset(
	pool: CoverageLexicalV2CanonicalTermPool,
	termId: CoverageLexicalV2CanonicalTermId,
): number {
	const nextOffset = getCoverageLexicalV2PackedOffset(pool.termOffsets, termId + 1);
	return nextOffset >= 0 ? nextOffset : pool.arenaLength;
}

function appendCoverageLexicalV2CanonicalBytes(
	pool: CoverageLexicalV2CanonicalTermPool,
	bytes: Uint8Array,
): number {
	const nextOffset = pool.arenaLength;
	ensureCoverageLexicalV2CanonicalTermCapacity(pool, bytes.length);
	pool.arenaBytes.set(bytes, nextOffset);
	pool.arenaLength += bytes.length;
	return nextOffset;
}

function ensureCoverageLexicalV2CanonicalTermCapacity(
	pool: CoverageLexicalV2CanonicalTermPool,
	additionalBytes: number,
): void {
	const required = pool.arenaLength + additionalBytes;
	if (required <= pool.arenaBytes.length) {
		return;
	}
	let nextCapacity = Math.max(64, pool.arenaBytes.length || 0);
	while (nextCapacity < required) {
		nextCapacity *= 2;
	}
	const nextArena = new Uint8Array(nextCapacity);
	nextArena.set(pool.arenaBytes.subarray(0, pool.arenaLength), 0);
	pool.arenaBytes = nextArena;
}

function createCoverageLexicalV2PackedOffsets(): CoverageLexicalV2PackedOffsets {
	return {
		values: new Uint16Array(PACKED_OFFSET_MIN_CAPACITY),
		count: 0,
		widthBytes: 2,
	};
}

function createCoverageLexicalV2PackedHashDirectory(): CoverageLexicalV2PackedHashDirectory {
	const bucketHeads = new Int32Array(HASH_DIRECTORY_MIN_BUCKET_COUNT);
	bucketHeads.fill(-1);
	const nextTermIds = new Int32Array(PACKED_OFFSET_MIN_CAPACITY);
	nextTermIds.fill(-1);
	return {
		bucketMask: HASH_DIRECTORY_MIN_BUCKET_COUNT - 1,
		bucketHeads,
		nextTermIds,
	};
}

function buildCoverageLexicalV2PackedHashDirectory(
	termCount: number,
): CoverageLexicalV2PackedHashDirectory {
	const bucketCount = getCoverageLexicalV2PackedHashBucketCount(termCount);
	const bucketHeads = new Int32Array(bucketCount);
	bucketHeads.fill(-1);
	const nextTermIds = new Int32Array(Math.max(PACKED_OFFSET_MIN_CAPACITY, termCount));
	nextTermIds.fill(-1);
	return {
		bucketMask: bucketCount - 1,
		bucketHeads,
		nextTermIds,
	};
}

function buildCoverageLexicalV2PackedOffsets(
	offsets: readonly number[],
): CoverageLexicalV2PackedOffsets {
	const maxOffset = offsets.reduce((largest, offset) => Math.max(largest, offset), 0);
	const widthBytes = maxOffset <= 0xffff ? 2 : 4;
	const values =
		widthBytes === 2
			? new Uint16Array(Math.max(PACKED_OFFSET_MIN_CAPACITY, offsets.length))
			: new Uint32Array(Math.max(PACKED_OFFSET_MIN_CAPACITY, offsets.length));
	for (let index = 0; index < offsets.length; index += 1) {
		values[index] = offsets[index] ?? 0;
	}
	return {
		values,
		count: offsets.length,
		widthBytes,
	};
}

function serializeCoverageLexicalV2PackedOffsets(
	offsets: CoverageLexicalV2PackedOffsets,
): number[] {
	return Array.from(offsets.values.subarray(0, offsets.count));
}

function getCoverageLexicalV2PackedOffset(
	offsets: CoverageLexicalV2PackedOffsets,
	index: number,
): number {
	if (index < 0 || index >= offsets.count) {
		return -1;
	}
	return offsets.values[index] ?? -1;
}

function pushCoverageLexicalV2PackedOffset(
	offsets: CoverageLexicalV2PackedOffsets,
	value: number,
): void {
	ensureCoverageLexicalV2PackedOffsetCapacity(offsets, value);
	offsets.values[offsets.count] = value;
	offsets.count += 1;
}

function ensureCoverageLexicalV2PackedOffsetCapacity(
	offsets: CoverageLexicalV2PackedOffsets,
	value: number,
): void {
	const requiredCount = offsets.count + 1;
	let nextWidthBytes = offsets.widthBytes;
	if (value > 0xffff) {
		nextWidthBytes = 4;
	}
	if (
		nextWidthBytes === offsets.widthBytes &&
		requiredCount <= offsets.values.length
	) {
		return;
	}
	let nextCapacity = Math.max(
		PACKED_OFFSET_MIN_CAPACITY,
		offsets.values.length || PACKED_OFFSET_MIN_CAPACITY,
	);
	while (nextCapacity < requiredCount) {
		nextCapacity *= 2;
	}
	const nextValues =
		nextWidthBytes === 2
			? new Uint16Array(nextCapacity)
			: new Uint32Array(nextCapacity);
	nextValues.set(offsets.values.subarray(0, offsets.count), 0);
	offsets.values = nextValues;
	offsets.widthBytes = nextWidthBytes;
}

function ensureCoverageLexicalV2PackedHashDirectoryCapacity(
	pool: CoverageLexicalV2CanonicalTermPool,
	termCount: number,
): void {
	const current = pool.termHashDirectory;
	const needsMoreTerms = termCount > current.nextTermIds.length;
	const maxTermsBeforeResize = Math.floor(
		current.bucketHeads.length * HASH_DIRECTORY_MAX_LOAD_FACTOR,
	);
	const needsMoreBuckets = termCount > maxTermsBeforeResize;
	if (!needsMoreTerms && !needsMoreBuckets) {
		return;
	}
	const nextDirectory = buildCoverageLexicalV2PackedHashDirectory(termCount);
	for (let termId = 0; termId < termCount - 1; termId += 1) {
		insertCoverageLexicalV2PackedHashTerm(
			nextDirectory,
			hashCoverageLexicalV2Bytes(
				pool.arenaBytes,
				getCoverageLexicalV2PackedOffset(pool.termOffsets, termId),
				getCoverageLexicalV2CanonicalTermEndOffset(pool, termId),
			),
			termId,
		);
	}
	pool.termHashDirectory = nextDirectory;
}

function insertCoverageLexicalV2PackedHashTerm(
	directory: CoverageLexicalV2PackedHashDirectory,
	hash: number,
	termId: number,
): void {
	const bucketIndex = hash & directory.bucketMask;
	directory.nextTermIds[termId] = directory.bucketHeads[bucketIndex] ?? -1;
	directory.bucketHeads[bucketIndex] = termId;
}

function getCoverageLexicalV2PackedHashBucketHead(
	directory: CoverageLexicalV2PackedHashDirectory,
	hash: number,
): number {
	return directory.bucketHeads[hash & directory.bucketMask] ?? -1;
}

function getCoverageLexicalV2PackedHashBucketCount(termCount: number): number {
	let bucketCount = HASH_DIRECTORY_MIN_BUCKET_COUNT;
	const minimumRequired = Math.max(
		HASH_DIRECTORY_MIN_BUCKET_COUNT,
		Math.ceil(termCount / HASH_DIRECTORY_MAX_LOAD_FACTOR),
	);
	while (bucketCount < minimumRequired) {
		bucketCount *= 2;
	}
	return bucketCount;
}

function equalsCoverageLexicalV2CanonicalBytes(
	arena: Uint8Array,
	offset: number,
	bytes: Uint8Array,
): boolean {
	if (offset < 0) {
		return false;
	}
	for (let index = 0; index < bytes.length; index += 1) {
		if (arena[offset + index] !== bytes[index]) {
			return false;
		}
	}
	return true;
}

function hashCoverageLexicalV2Bytes(
	bytes: Uint8Array,
	start: number,
	end: number,
): number {
	let hash = 0x811c9dc5;
	for (let index = start; index < end; index += 1) {
		hash ^= bytes[index] ?? 0;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash >>> 0;
}
