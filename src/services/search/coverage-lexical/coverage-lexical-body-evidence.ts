import type {
	CoverageFamilyMatchKind,
	CoverageLexicalFamily,
} from "./coverage-lexical-types";

const DEFAULT_WINDOW_FUZZY_PROPORTION = 0.2;

export type CoverageLexicalFamilyTokenMatch = {
	familyIndex: number;
	kind: Exclude<CoverageFamilyMatchKind, null>;
};

export type CoverageLexicalBodyEvidenceTrace = {
	tokenCount: number;
	activeFamilies: readonly CoverageLexicalFamily[];
	admissionMatchesByPosition: CoverageLexicalFamilyTokenMatch[][];
	admissionHitPositions: number[];
	windowMatchesByPosition: CoverageLexicalFamilyTokenMatch[][];
	windowHitPositions: number[];
};

export function buildCoverageLexicalBodyEvidenceTrace(
	tokens: readonly string[],
	families: readonly CoverageLexicalFamily[],
	windowFuzzyProportion: number = DEFAULT_WINDOW_FUZZY_PROPORTION,
): CoverageLexicalBodyEvidenceTrace {
	const activeFamilies = families.filter((family) => family.role !== "noise");
	const admissionMatchesByPosition: CoverageLexicalFamilyTokenMatch[][] = Array.from(
		{ length: tokens.length },
		() => [],
	);
	const windowMatchesByPosition: CoverageLexicalFamilyTokenMatch[][] = Array.from(
		{ length: tokens.length },
		() => [],
	);
	const admissionHitPositions: number[] = [];
	const windowHitPositions: number[] = [];

	for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
		const token = tokens[tokenIndex];
		for (const family of activeFamilies) {
			const kinds = classifyTokenMatchKinds(
				token,
				family,
				windowFuzzyProportion,
			);
			if (kinds.admissionKind) {
				admissionMatchesByPosition[tokenIndex].push({
					familyIndex: family.index,
					kind: kinds.admissionKind,
				});
			}
			if (kinds.windowKind) {
				windowMatchesByPosition[tokenIndex].push({
					familyIndex: family.index,
					kind: kinds.windowKind,
				});
			}
		}
		if (admissionMatchesByPosition[tokenIndex].length > 0) {
			admissionHitPositions.push(tokenIndex);
		}
		if (windowMatchesByPosition[tokenIndex].length > 0) {
			windowHitPositions.push(tokenIndex);
		}
	}

	return {
		tokenCount: tokens.length,
		activeFamilies,
		admissionMatchesByPosition,
		admissionHitPositions,
		windowMatchesByPosition,
		windowHitPositions,
	};
}

function classifyTokenMatchKinds(
	token: string,
	family: CoverageLexicalFamily,
	windowFuzzyProportion: number,
): {
	admissionKind: Exclude<CoverageFamilyMatchKind, null> | null;
	windowKind: Exclude<CoverageFamilyMatchKind, null> | null;
} {
	if (token === family.normalizedTerm) {
		return { admissionKind: "exact", windowKind: "exact" };
	}
	if (family.allowPrefix && token.startsWith(family.normalizedTerm)) {
		return { admissionKind: "prefix", windowKind: "prefix" };
	}
	if (!family.allowFuzzy || token[0] !== family.normalizedTerm[0]) {
		return { admissionKind: null, windowKind: null };
	}

	const admissionMaxDistance = computeAdmissionMaxFuzzyDistance(
		family.normalizedTerm,
	);
	const windowMaxDistance = computeWindowMaxFuzzyDistance(
		family.normalizedTerm,
		windowFuzzyProportion,
	);
	const maxDistance = Math.max(admissionMaxDistance, windowMaxDistance);
	if (maxDistance <= 0) {
		return { admissionKind: null, windowKind: null };
	}

	const distance = boundedLevenshtein(token, family.normalizedTerm, maxDistance);
	return {
		admissionKind:
			admissionMaxDistance > 0 && distance <= admissionMaxDistance ? "fuzzy" : null,
		windowKind:
			windowMaxDistance > 0 && distance <= windowMaxDistance ? "fuzzy" : null,
	};
}

function computeAdmissionMaxFuzzyDistance(term: string): number {
	if (term.length >= 9) {
		return 2;
	}
	if (term.length >= 5) {
		return 1;
	}
	return 0;
}

function computeWindowMaxFuzzyDistance(
	queryTerm: string,
	windowFuzzyProportion: number,
): number {
	if (queryTerm.length <= 4) {
		return 0;
	}
	return Math.min(
		2,
		Math.max(1, Math.round(queryTerm.length * windowFuzzyProportion)),
	);
}

function boundedLevenshtein(a: string, b: string, maxDistance: number): number {
	if (a === b) {
		return 0;
	}
	if (Math.abs(a.length - b.length) > maxDistance) {
		return maxDistance + 1;
	}

	const prev = new Array<number>(b.length + 1);
	const curr = new Array<number>(b.length + 1);
	for (let index = 0; index <= b.length; index++) {
		prev[index] = index;
	}

	for (let row = 1; row <= a.length; row++) {
		curr[0] = row;
		let rowMin = curr[0];
		for (let column = 1; column <= b.length; column++) {
			const cost = a[row - 1] === b[column - 1] ? 0 : 1;
			curr[column] = Math.min(
				prev[column] + 1,
				curr[column - 1] + 1,
				prev[column - 1] + cost,
			);
			rowMin = Math.min(rowMin, curr[column]);
		}
		if (rowMin > maxDistance) {
			return maxDistance + 1;
		}
		for (let index = 0; index <= b.length; index++) {
			prev[index] = curr[index];
		}
	}

	return prev[b.length];
}
