import type {
	CoverageFamilyMatchKind,
	CoverageLexicalCandidateState,
	CoverageLexicalFamily,
	CoverageLexicalPassageAdmissionSignal,
	CoverageLexicalPhraseSignature,
} from "./coverage-lexical-types";
import {
	buildCoverageLexicalBodyEvidenceTrace,
	type CoverageLexicalBodyEvidenceTrace,
	type CoverageLexicalFamilyTokenMatch,
} from "./coverage-lexical-body-evidence";

const MIN_ADMISSION_WINDOW = 6;
const MAX_ADMISSION_WINDOW = 18;

export function buildCoverageLexicalPassageAdmissionSignal(
	tokens: readonly string[],
	families: readonly CoverageLexicalFamily[],
	state: CoverageLexicalCandidateState,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
	bodyEvidenceTrace?: CoverageLexicalBodyEvidenceTrace,
): CoverageLexicalPassageAdmissionSignal {
	const phraseMatchCount = state.phraseMatches.length;
	const phraseMatchWeight = state.phraseMatches.reduce(
		(total, index) => total + (phraseSignatures[index]?.tailWeight ?? 0),
		0,
	);
	if (tokens.length === 0) {
		return createEmptyCoverageLexicalPassageAdmissionSignal(
			phraseMatchCount,
			phraseMatchWeight,
		);
	}

	const trace =
		bodyEvidenceTrace ?? buildCoverageLexicalBodyEvidenceTrace(tokens, families);
	if (
		trace.activeFamilies.length === 0 ||
		trace.admissionHitPositions.length === 0
	) {
		return createEmptyCoverageLexicalPassageAdmissionSignal(
			phraseMatchCount,
			phraseMatchWeight,
		);
	}

	const baseWindow = Math.min(
		MAX_ADMISSION_WINDOW,
		Math.max(MIN_ADMISSION_WINDOW, trace.activeFamilies.length * 3),
	);
	const tighterWindow = Math.max(
		MIN_ADMISSION_WINDOW,
		Math.floor(baseWindow * 0.65),
	);
	const candidateWindows =
		tighterWindow === baseWindow ? [baseWindow] : [baseWindow, tighterWindow];

	let best = createEmptyCoverageLexicalPassageAdmissionSignal(
		phraseMatchCount,
		phraseMatchWeight,
	);
	const seen = new Set<number>();
	for (const center of trace.admissionHitPositions) {
		for (const windowSize of candidateWindows) {
			const start = Math.max(
				0,
				Math.min(center - Math.floor(windowSize / 2), tokens.length - windowSize),
			);
			const end = Math.min(tokens.length - 1, start + windowSize - 1);
			const key = computeWindowKey(start, end, trace.tokenCount);
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			const candidate = scoreWindow(
				start,
				end,
				trace.admissionMatchesByPosition,
				families,
				phraseMatchCount,
				phraseMatchWeight,
			);
			if (compareCoverageLexicalPassageAdmissionSignals(candidate, best) < 0) {
				best = candidate;
			}
		}
	}

	return best;
}

export function compareCoverageLexicalPassageAdmissionSignals(
	left: CoverageLexicalPassageAdmissionSignal,
	right: CoverageLexicalPassageAdmissionSignal,
): number {
	return (
		compareDescendingMetric(left.coreCoverageCount, right.coreCoverageCount) ||
		compareDescendingMetric(left.exactWeight, right.exactWeight) ||
		compareDescendingMetric(left.prefixWeight, right.prefixWeight) ||
		compareDescendingMetric(left.fuzzyWeight, right.fuzzyWeight) ||
		compareDescendingMetric(left.phraseMatchCount, right.phraseMatchCount) ||
		compareDescendingMetric(left.phraseMatchWeight, right.phraseMatchWeight) ||
		compareDescendingMetric(left.anchorCoverageCount, right.anchorCoverageCount) ||
		compareDescendingMetric(left.softCoverageCount, right.softCoverageCount) ||
		compareDescendingMetric(left.compactnessScore, right.compactnessScore)
	);
}

function scoreWindow(
	start: number,
	end: number,
	matchesByPosition: ReadonlyArray<
		ReadonlyArray<CoverageLexicalFamilyTokenMatch>
	>,
	families: readonly CoverageLexicalFamily[],
	phraseMatchCount: number,
	phraseMatchWeight: number,
): CoverageLexicalPassageAdmissionSignal {
	const bestKindCodeByFamily: number[] = [];
	for (let tokenIndex = start; tokenIndex <= end; tokenIndex++) {
		for (const match of matchesByPosition[tokenIndex]) {
			const previousCode = bestKindCodeByFamily[match.familyIndex] ?? 0;
			const nextCode = encodeMatchKind(match.kind);
			if (previousCode >= nextCode) {
				continue;
			}
			bestKindCodeByFamily[match.familyIndex] = nextCode;
		}
	}

	let coreCoverageCount = 0;
	let exactWeight = 0;
	let prefixWeight = 0;
	let fuzzyWeight = 0;
	let anchorCoverageCount = 0;
	let softCoverageCount = 0;

	for (const family of families) {
		const kind = decodeMatchKind(bestKindCodeByFamily[family.index] ?? 0);
		if (!kind) {
			continue;
		}
		const weight = computeFamilyTailWeight(family.index);
		if (family.role === "body" && family.strength === "core") {
			coreCoverageCount += 1;
			if (kind === "exact") {
				exactWeight += weight;
			} else if (kind === "prefix") {
				prefixWeight += weight;
			} else {
				fuzzyWeight += weight;
			}
			continue;
		}
		if (family.role === "anchor") {
			anchorCoverageCount += 1;
			continue;
		}
		if (family.role === "body") {
			softCoverageCount += 1;
		}
	}

	const spanLength = Math.max(1, end - start + 1);
	return {
		coreCoverageCount,
		exactWeight,
		prefixWeight,
		fuzzyWeight,
		anchorCoverageCount,
		softCoverageCount,
		phraseMatchCount,
		phraseMatchWeight,
		compactnessScore:
			coreCoverageCount * 100 +
			exactWeight * 4 +
			prefixWeight * 2 +
			anchorCoverageCount * 12 +
			softCoverageCount * 4 +
			(coreCoverageCount + anchorCoverageCount + softCoverageCount * 0.6) /
				spanLength,
	};
}

function createEmptyCoverageLexicalPassageAdmissionSignal(
	phraseMatchCount = 0,
	phraseMatchWeight = 0,
): CoverageLexicalPassageAdmissionSignal {
	return {
		coreCoverageCount: 0,
		exactWeight: 0,
		prefixWeight: 0,
		fuzzyWeight: 0,
		anchorCoverageCount: 0,
		softCoverageCount: 0,
		phraseMatchCount,
		phraseMatchWeight,
		compactnessScore: 0,
	};
}

function encodeMatchKind(kind: Exclude<CoverageFamilyMatchKind, null>): number {
	if (kind === "exact") {
		return 3;
	}
	if (kind === "prefix") {
		return 2;
	}
	return 1;
}

function decodeMatchKind(
	code: number,
): Exclude<CoverageFamilyMatchKind, null> | null {
	if (code === 3) {
		return "exact";
	}
	if (code === 2) {
		return "prefix";
	}
	if (code === 1) {
		return "fuzzy";
	}
	return null;
}

function compareDescendingMetric(left: number, right: number): number {
	return right - left;
}

function computeFamilyTailWeight(index: number): number {
	const position = index + 1;
	return position * position;
}

function computeWindowKey(start: number, end: number, tokenCount: number): number {
	return start * tokenCount + end;
}
