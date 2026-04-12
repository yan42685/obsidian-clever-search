import type {
	CoverageLexicalV2CanonicalTermId,
	CoverageLexicalV2CanonicalTermPoolState,
} from "./coverage-lexical-v2-index-store-types";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type CoverageLexicalV2CanonicalTermPool = {
	termOffsets: number[];
	termByteLengths: number[];
	termHashToCandidateIds: Map<number, number[]>;
	arenaBytes: Uint8Array;
	arenaLength: number;
};

export function createCoverageLexicalV2CanonicalTermPool(): CoverageLexicalV2CanonicalTermPool {
	return {
		termOffsets: [],
		termByteLengths: [],
		termHashToCandidateIds: new Map(),
		arenaBytes: new Uint8Array(0),
		arenaLength: 0,
	};
}

export function clearCoverageLexicalV2CanonicalTermPool(
	pool: CoverageLexicalV2CanonicalTermPool,
): void {
	pool.termOffsets.length = 0;
	pool.termByteLengths.length = 0;
	pool.termHashToCandidateIds.clear();
	pool.arenaBytes = new Uint8Array(0);
	pool.arenaLength = 0;
}

export function restoreCoverageLexicalV2CanonicalTermPool(
	pool: CoverageLexicalV2CanonicalTermPool,
	state: CoverageLexicalV2CanonicalTermPoolState,
): void {
	clearCoverageLexicalV2CanonicalTermPool(pool);
	pool.termOffsets.push(...state.termOffsets);
	pool.termByteLengths.push(...state.termByteLengths);
	pool.arenaBytes = Uint8Array.from(state.arenaBytes);
	pool.arenaLength = pool.arenaBytes.length;
	for (
		let termId = 0;
		termId < pool.termOffsets.length;
		termId += 1
	) {
		const hash = hashCoverageLexicalV2Bytes(
			pool.arenaBytes,
			pool.termOffsets[termId] ?? 0,
			(pool.termOffsets[termId] ?? 0) + (pool.termByteLengths[termId] ?? 0),
		);
		const candidateIds = pool.termHashToCandidateIds.get(hash) ?? [];
		candidateIds.push(termId);
		pool.termHashToCandidateIds.set(hash, candidateIds);
	}
}

export function serializeCoverageLexicalV2CanonicalTermPool(
	pool: CoverageLexicalV2CanonicalTermPool,
): CoverageLexicalV2CanonicalTermPoolState {
	return {
		arenaBytes: Array.from(pool.arenaBytes.subarray(0, pool.arenaLength)),
		termOffsets: [...pool.termOffsets],
		termByteLengths: [...pool.termByteLengths],
	};
}

export function getCoverageLexicalV2CanonicalTermCount(
	pool: CoverageLexicalV2CanonicalTermPool,
): number {
	return pool.termOffsets.length;
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
	const termId = pool.termOffsets.length;
	const offset = appendCoverageLexicalV2CanonicalBytes(pool, bytes);
	pool.termOffsets.push(offset);
	pool.termByteLengths.push(bytes.length);
	const hash = hashCoverageLexicalV2Bytes(bytes, 0, bytes.length);
	const candidateIds = pool.termHashToCandidateIds.get(hash) ?? [];
	candidateIds.push(termId);
	pool.termHashToCandidateIds.set(hash, candidateIds);
	return termId;
}

export function decodeCoverageLexicalV2CanonicalTerm(
	pool: CoverageLexicalV2CanonicalTermPool,
	termId: CoverageLexicalV2CanonicalTermId,
): string {
	const offset = pool.termOffsets[termId];
	const byteLength = pool.termByteLengths[termId];
	if (
		offset === undefined ||
		byteLength === undefined ||
		byteLength <= 0
	) {
		return "";
	}
	return textDecoder.decode(pool.arenaBytes.subarray(offset, offset + byteLength));
}

export function getCoverageLexicalV2CanonicalTermByteLength(
	pool: CoverageLexicalV2CanonicalTermPool,
	termId: CoverageLexicalV2CanonicalTermId,
): number {
	return pool.termByteLengths[termId] ?? 0;
}

export function estimateCoverageLexicalV2CanonicalTermPoolBytes(
	pool: CoverageLexicalV2CanonicalTermPool,
): number {
	return (
		pool.arenaLength +
		pool.termOffsets.length * 8 +
		pool.termByteLengths.length * 8
	);
}

function findCoverageLexicalV2CanonicalTermIdByBytes(
	pool: CoverageLexicalV2CanonicalTermPool,
	bytes: Uint8Array,
): CoverageLexicalV2CanonicalTermId | undefined {
	const hash = hashCoverageLexicalV2Bytes(bytes, 0, bytes.length);
	for (const candidateId of pool.termHashToCandidateIds.get(hash) ?? []) {
		const offset = pool.termOffsets[candidateId] ?? -1;
		const byteLength = pool.termByteLengths[candidateId] ?? -1;
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
