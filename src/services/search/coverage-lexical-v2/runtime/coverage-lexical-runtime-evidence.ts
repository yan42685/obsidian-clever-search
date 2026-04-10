import type {
	CoverageLexicalV2BestWindowEvidence,
	CoverageLexicalV2MatchField,
	CoverageLexicalV2MatchQualityKind,
	CoverageLexicalV2MatchedPrimaryUnitEvidence,
} from "../ranking";
import {
	compareCoverageLexicalV2MatchQuality,
	getCoverageLexicalV2RuntimeMatchQuality,
	type CoverageLexicalV2RuntimeMatchOptions,
} from "./coverage-lexical-runtime-match";

export type CoverageLexicalV2RuntimeFieldTerms = {
	basenameTerms?: readonly string[];
	aliasTerms?: readonly string[];
	headingsTerms?: readonly string[];
	folderTerms?: readonly string[];
	tagTerms?: readonly string[];
	bodyTerms?: readonly string[];
};

export type CoverageLexicalV2RuntimeDocumentLexicalState = {
	docId: string | number;
	path: string;
	stableDeterministicKey?: string;
	fieldTerms: CoverageLexicalV2RuntimeFieldTerms;
	basenameTokenSequence?: readonly string[];
	aliasTokenSequence?: readonly string[];
	headingsTokenSequence?: readonly string[];
	bodyTokenSequence?: readonly string[];
};

export type CoverageLexicalV2RuntimePrimaryUnitDefinition = {
	normalizedText: string;
	surfaceGroupIndex: number;
	surfaceKind: "latin" | "han" | "mixed";
};

type CoverageLexicalV2RuntimeLocalWindowField = Extract<
	CoverageLexicalV2MatchField,
	"basename" | "aliases" | "headings" | "body"
>;

type CoverageLexicalV2RuntimeResolvedBestWindow = {
	field: CoverageLexicalV2RuntimeLocalWindowField;
	matchedUnitKeys: string[];
	windowWidth: number;
	averageDistance: number;
	preservesSurfaceOrder: boolean;
};

type CoverageLexicalV2RuntimeFieldMatch = {
	field: CoverageLexicalV2MatchField;
	quality: CoverageLexicalV2MatchQualityKind;
};

const COVERAGE_LEXICAL_V2_RUNTIME_LOCAL_WINDOW_FIELDS: readonly CoverageLexicalV2RuntimeLocalWindowField[] = [
	"basename",
	"aliases",
	"headings",
	"body",
];

const COVERAGE_LEXICAL_V2_RUNTIME_LOCAL_WINDOW_FIELD_PRIORITY: Record<
	CoverageLexicalV2RuntimeLocalWindowField,
	number
> = {
	basename: 0,
	aliases: 1,
	headings: 2,
	body: 3,
};

export function buildCoverageLexicalV2RuntimeMatchedPrimaryUnits(
	primaryUnits: readonly CoverageLexicalV2RuntimePrimaryUnitDefinition[],
	fieldTerms: CoverageLexicalV2RuntimeFieldTerms,
	options: CoverageLexicalV2RuntimeMatchOptions,
): CoverageLexicalV2MatchedPrimaryUnitEvidence[] {
	const normalizedFieldTerms = {
		basenameTerms: normalizeTerms(fieldTerms.basenameTerms),
		aliasTerms: normalizeTerms(fieldTerms.aliasTerms),
		headingsTerms: normalizeTerms(fieldTerms.headingsTerms),
		folderTerms: normalizeTerms(fieldTerms.folderTerms),
		tagTerms: normalizeTerms(fieldTerms.tagTerms),
		bodyTerms: normalizeTerms(fieldTerms.bodyTerms),
	};
	const units: CoverageLexicalV2MatchedPrimaryUnitEvidence[] = [];
	for (const unit of primaryUnits) {
		const fieldMatches = collectMatchedFields(unit.normalizedText, normalizedFieldTerms, options);
		if (fieldMatches.length === 0) {
			continue;
		}
		units.push({
			normalizedText: unit.normalizedText,
			surfaceGroupIndex: unit.surfaceGroupIndex,
			surfaceKind: unit.surfaceKind,
			strongestField: fieldMatches[0].field,
			corroboratedFields: fieldMatches.slice(1).map((fieldMatch) => fieldMatch.field),
			matchQuality: selectBestMatchQuality(fieldMatches),
		});
	}
	return units;
}

export function buildCoverageLexicalV2RuntimeBestWindowForDocument(
	matchedPrimaryUnits: readonly CoverageLexicalV2MatchedPrimaryUnitEvidence[],
	document: CoverageLexicalV2RuntimeDocumentLexicalState,
): CoverageLexicalV2BestWindowEvidence | null {
	let bestWindow: CoverageLexicalV2RuntimeResolvedBestWindow | null = null;
	for (const field of COVERAGE_LEXICAL_V2_RUNTIME_LOCAL_WINDOW_FIELDS) {
		const candidateWindow = buildCoverageLexicalV2RuntimeFieldBestWindow(
			matchedPrimaryUnits,
			field,
			getCoverageLexicalV2RuntimeFieldTokenSequence(document, field),
		);
		if (
			candidateWindow != null &&
			(bestWindow == null || isBetterCoverageLexicalV2RuntimeBestWindow(candidateWindow, bestWindow))
		) {
			bestWindow = candidateWindow;
		}
	}
	return bestWindow;
}

function buildCoverageLexicalV2RuntimeFieldBestWindow(
	matchedPrimaryUnits: readonly CoverageLexicalV2MatchedPrimaryUnitEvidence[],
	field: CoverageLexicalV2RuntimeLocalWindowField,
	tokenSequence: readonly string[] | undefined,
): CoverageLexicalV2RuntimeResolvedBestWindow | null {
	if (!tokenSequence || tokenSequence.length === 0) {
		return null;
	}
	const relevantUnits = matchedPrimaryUnits.filter(
		(unit) =>
			unit.matchQuality === "exact" &&
			(unit.strongestField === field || (unit.corroboratedFields ?? []).includes(field)),
	);
	if (relevantUnits.length === 0) {
		return null;
	}
	const normalizedTokens = normalizeTerms(tokenSequence);
	const occurrences: Array<{
		unitKey: string;
		groupIndex: number;
		position: number;
	}> = [];
	for (let position = 0; position < normalizedTokens.length; position += 1) {
		const token = normalizedTokens[position];
		for (const relevantUnit of relevantUnits) {
			if (token !== relevantUnit.normalizedText) {
				continue;
			}
			occurrences.push({
				unitKey: createCoverageLexicalV2RuntimeUnitKey(
					relevantUnit.surfaceGroupIndex,
					relevantUnit.normalizedText,
				),
				groupIndex: relevantUnit.surfaceGroupIndex,
				position,
			});
		}
	}
	if (occurrences.length === 0) {
		return null;
	}
	const requiredUnitKeys = new Set(
		relevantUnits.map((unit) =>
			createCoverageLexicalV2RuntimeUnitKey(unit.surfaceGroupIndex, unit.normalizedText),
		),
	);
	let bestWindow:
		| {
				start: number;
				end: number;
				matchedUnitKeys: string[];
				groupIndices: number[];
		  }
		| null = null;
	const windowCounts = new Map<string, number>();
	let distinctUnitCount = 0;
	let start = 0;
	for (let end = 0; end < occurrences.length; end += 1) {
		const endOccurrence = occurrences[end];
		const previousCount = windowCounts.get(endOccurrence.unitKey) ?? 0;
		windowCounts.set(endOccurrence.unitKey, previousCount + 1);
		if (previousCount === 0) {
			distinctUnitCount += 1;
		}
		while (distinctUnitCount >= requiredUnitKeys.size && start <= end) {
			const startOccurrence = occurrences[start];
			const candidateWindow = {
				start: startOccurrence.position,
				end: endOccurrence.position,
				matchedUnitKeys: dedupeCoverageLexicalV2RuntimeWindowUnitKeys(occurrences, start, end),
				groupIndices: occurrences.slice(start, end + 1).map((occurrence) => occurrence.groupIndex),
			};
			if (
				bestWindow == null ||
				isBetterCoverageLexicalV2RuntimeWindowShape(candidateWindow, bestWindow)
			) {
				bestWindow = candidateWindow;
			}
			const nextCount = (windowCounts.get(startOccurrence.unitKey) ?? 1) - 1;
			if (nextCount <= 0) {
				windowCounts.delete(startOccurrence.unitKey);
				distinctUnitCount -= 1;
			} else {
				windowCounts.set(startOccurrence.unitKey, nextCount);
			}
			start += 1;
		}
	}
	if (bestWindow == null) {
		const single = occurrences[0];
		return {
			field,
			matchedUnitKeys: [single.unitKey],
			windowWidth: 1,
			averageDistance: 0,
			preservesSurfaceOrder: true,
		};
	}
	return {
		field,
		matchedUnitKeys: bestWindow.matchedUnitKeys,
		windowWidth: bestWindow.end - bestWindow.start + 1,
		averageDistance: computeCoverageLexicalV2RuntimeAverageDistance(
			bestWindow.groupIndices.length,
			bestWindow.end - bestWindow.start,
		),
		preservesSurfaceOrder: preservesCoverageLexicalV2RuntimeSurfaceOrder(bestWindow.groupIndices),
	};
}

function getCoverageLexicalV2RuntimeFieldTokenSequence(
	document: CoverageLexicalV2RuntimeDocumentLexicalState,
	field: CoverageLexicalV2RuntimeLocalWindowField,
): readonly string[] | undefined {
	switch (field) {
		case "basename":
			return document.basenameTokenSequence;
		case "aliases":
			return document.aliasTokenSequence;
		case "headings":
			return document.headingsTokenSequence;
		case "body":
			return document.bodyTokenSequence;
	}
}

function collectMatchedFields(
	term: string,
	terms: {
		basenameTerms: readonly string[];
		aliasTerms: readonly string[];
		headingsTerms: readonly string[];
		folderTerms: readonly string[];
		tagTerms: readonly string[];
		bodyTerms: readonly string[];
	},
	options: CoverageLexicalV2RuntimeMatchOptions,
): CoverageLexicalV2RuntimeFieldMatch[] {
	const fieldMatches: CoverageLexicalV2RuntimeFieldMatch[] = [];
	pushCoverageLexicalV2RuntimeFieldMatch(fieldMatches, "basename", term, terms.basenameTerms, options);
	pushCoverageLexicalV2RuntimeFieldMatch(fieldMatches, "aliases", term, terms.aliasTerms, options);
	pushCoverageLexicalV2RuntimeFieldMatch(fieldMatches, "headings", term, terms.headingsTerms, options);
	pushCoverageLexicalV2RuntimeFieldMatch(fieldMatches, "folder", term, terms.folderTerms, options);
	pushCoverageLexicalV2RuntimeFieldMatch(fieldMatches, "tag", term, terms.tagTerms, options);
	pushCoverageLexicalV2RuntimeFieldMatch(fieldMatches, "body", term, terms.bodyTerms, options);
	return fieldMatches;
}

function pushCoverageLexicalV2RuntimeFieldMatch(
	fieldMatches: CoverageLexicalV2RuntimeFieldMatch[],
	field: CoverageLexicalV2MatchField,
	queryTerm: string,
	fieldTerms: readonly string[],
	options: CoverageLexicalV2RuntimeMatchOptions,
): void {
	const bestMatchQuality = findBestFieldMatchQuality(queryTerm, fieldTerms, options);
	if (bestMatchQuality == null) {
		return;
	}
	fieldMatches.push({
		field,
		quality: bestMatchQuality,
	});
}

function findBestFieldMatchQuality(
	queryTerm: string,
	fieldTerms: readonly string[],
	options: CoverageLexicalV2RuntimeMatchOptions,
): CoverageLexicalV2MatchQualityKind | null {
	let bestMatchQuality: CoverageLexicalV2MatchQualityKind | null = null;
	for (const fieldTerm of fieldTerms) {
		const matchQuality = getCoverageLexicalV2RuntimeMatchQuality(queryTerm, fieldTerm, options);
		if (matchQuality == null) {
			continue;
		}
		if (bestMatchQuality == null || compareCoverageLexicalV2MatchQuality(matchQuality, bestMatchQuality) < 0) {
			bestMatchQuality = matchQuality;
		}
		if (bestMatchQuality === "exact") {
			return bestMatchQuality;
		}
	}
	return bestMatchQuality;
}

function selectBestMatchQuality(
	fieldMatches: readonly CoverageLexicalV2RuntimeFieldMatch[],
): CoverageLexicalV2MatchQualityKind {
	let bestMatchQuality = fieldMatches[0].quality;
	for (let index = 1; index < fieldMatches.length; index += 1) {
		if (compareCoverageLexicalV2MatchQuality(fieldMatches[index].quality, bestMatchQuality) < 0) {
			bestMatchQuality = fieldMatches[index].quality;
		}
	}
	return bestMatchQuality;
}

function normalizeTerms(terms: readonly string[] | undefined): string[] {
	return (terms ?? []).map((term) => term.trim().toLowerCase()).filter((term) => term.length > 0);
}

function isBetterCoverageLexicalV2RuntimeBestWindow(
	left: CoverageLexicalV2RuntimeResolvedBestWindow,
	right: CoverageLexicalV2RuntimeResolvedBestWindow,
): boolean {
	if (left.matchedUnitKeys.length !== right.matchedUnitKeys.length) {
		return left.matchedUnitKeys.length > right.matchedUnitKeys.length;
	}
	if (left.preservesSurfaceOrder !== right.preservesSurfaceOrder) {
		return left.preservesSurfaceOrder;
	}
	if (left.windowWidth !== right.windowWidth) {
		return left.windowWidth < right.windowWidth;
	}
	if (left.averageDistance !== right.averageDistance) {
		return left.averageDistance < right.averageDistance;
	}
	const leftPriority = COVERAGE_LEXICAL_V2_RUNTIME_LOCAL_WINDOW_FIELD_PRIORITY[left.field];
	const rightPriority = COVERAGE_LEXICAL_V2_RUNTIME_LOCAL_WINDOW_FIELD_PRIORITY[right.field];
	if (leftPriority !== rightPriority) {
		return leftPriority < rightPriority;
	}
	return false;
}

function isBetterCoverageLexicalV2RuntimeWindowShape(
	left: {
		start: number;
		end: number;
		matchedUnitKeys: string[];
		groupIndices: number[];
	},
	right: {
		start: number;
		end: number;
		matchedUnitKeys: string[];
		groupIndices: number[];
	},
): boolean {
	if (left.matchedUnitKeys.length !== right.matchedUnitKeys.length) {
		return left.matchedUnitKeys.length > right.matchedUnitKeys.length;
	}
	const leftPreservesOrder = preservesCoverageLexicalV2RuntimeSurfaceOrder(left.groupIndices);
	const rightPreservesOrder = preservesCoverageLexicalV2RuntimeSurfaceOrder(right.groupIndices);
	if (leftPreservesOrder !== rightPreservesOrder) {
		return leftPreservesOrder;
	}
	const leftWindowWidth = left.end - left.start + 1;
	const rightWindowWidth = right.end - right.start + 1;
	if (leftWindowWidth !== rightWindowWidth) {
		return leftWindowWidth < rightWindowWidth;
	}
	const leftAverageDistance = computeCoverageLexicalV2RuntimeAverageDistance(
		left.groupIndices.length,
		left.end - left.start,
	);
	const rightAverageDistance = computeCoverageLexicalV2RuntimeAverageDistance(
		right.groupIndices.length,
		right.end - right.start,
	);
	if (leftAverageDistance !== rightAverageDistance) {
		return leftAverageDistance < rightAverageDistance;
	}
	return left.start < right.start;
}

function dedupeCoverageLexicalV2RuntimeWindowUnitKeys(
	occurrences: ReadonlyArray<{ unitKey: string }>,
	start: number,
	end: number,
): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (let index = start; index <= end; index += 1) {
		const unitKey = occurrences[index].unitKey;
		if (seen.has(unitKey)) {
			continue;
		}
		seen.add(unitKey);
		out.push(unitKey);
	}
	return out;
}

function preservesCoverageLexicalV2RuntimeSurfaceOrder(groupIndices: readonly number[]): boolean {
	for (let index = 1; index < groupIndices.length; index += 1) {
		if (groupIndices[index] < groupIndices[index - 1]) {
			return false;
		}
	}
	return true;
}

function computeCoverageLexicalV2RuntimeAverageDistance(
	groupCount: number,
	span: number,
): number {
	if (groupCount <= 1) {
		return 0;
	}
	return span / (groupCount - 1);
}

function createCoverageLexicalV2RuntimeUnitKey(
	surfaceGroupIndex: number,
	normalizedText: string,
): string {
	return String(surfaceGroupIndex) + ":" + normalizedText;
}
