import type {
	CoverageLexicalV2HanSymbolId,
	CoverageLexicalV2HanSymbolPoolState,
} from "./coverage-lexical-v2-index-store-types";

export const COVERAGE_LEXICAL_V2_HAN_SEGMENT_SEPARATOR_ID = 0;

export type CoverageLexicalV2HanSymbolPool = {
	codePointsBySymbolId: number[];
	symbolIdByCodePoint: Map<number, CoverageLexicalV2HanSymbolId>;
};

export function createCoverageLexicalV2HanSymbolPool(): CoverageLexicalV2HanSymbolPool {
	return {
		codePointsBySymbolId: [],
		symbolIdByCodePoint: new Map(),
	};
}

export function clearCoverageLexicalV2HanSymbolPool(
	pool: CoverageLexicalV2HanSymbolPool,
): void {
	pool.codePointsBySymbolId.length = 0;
	pool.symbolIdByCodePoint.clear();
}

export function restoreCoverageLexicalV2HanSymbolPool(
	pool: CoverageLexicalV2HanSymbolPool,
	state: CoverageLexicalV2HanSymbolPoolState,
): void {
	clearCoverageLexicalV2HanSymbolPool(pool);
	pool.codePointsBySymbolId.push(...state.codePointsBySymbolId);
	for (let index = 0; index < pool.codePointsBySymbolId.length; index += 1) {
		pool.symbolIdByCodePoint.set(pool.codePointsBySymbolId[index], index + 1);
	}
}

export function serializeCoverageLexicalV2HanSymbolPool(
	pool: CoverageLexicalV2HanSymbolPool,
): CoverageLexicalV2HanSymbolPoolState {
	return {
		codePointsBySymbolId: [...pool.codePointsBySymbolId],
	};
}

export function findCoverageLexicalV2HanSymbolId(
	pool: CoverageLexicalV2HanSymbolPool,
	codePoint: number,
): CoverageLexicalV2HanSymbolId | undefined {
	return pool.symbolIdByCodePoint.get(codePoint);
}

export function getOrCreateCoverageLexicalV2HanSymbolId(
	pool: CoverageLexicalV2HanSymbolPool,
	codePoint: number,
): CoverageLexicalV2HanSymbolId {
	const existing = pool.symbolIdByCodePoint.get(codePoint);
	if (existing !== undefined) {
		return existing;
	}
	const symbolId = pool.codePointsBySymbolId.length + 1;
	pool.codePointsBySymbolId.push(codePoint);
	pool.symbolIdByCodePoint.set(codePoint, symbolId);
	return symbolId;
}

export function decodeCoverageLexicalV2HanSymbolCodePoint(
	pool: CoverageLexicalV2HanSymbolPool,
	symbolId: CoverageLexicalV2HanSymbolId,
): number {
	if (symbolId === COVERAGE_LEXICAL_V2_HAN_SEGMENT_SEPARATOR_ID) {
		return 0;
	}
	return pool.codePointsBySymbolId[symbolId - 1] ?? 0;
}

export function getCoverageLexicalV2HanSymbolCount(
	pool: CoverageLexicalV2HanSymbolPool,
): number {
	return pool.codePointsBySymbolId.length;
}
