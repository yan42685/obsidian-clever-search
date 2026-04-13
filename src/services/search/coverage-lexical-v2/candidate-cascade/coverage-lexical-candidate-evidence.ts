import type {
	CoverageLexicalV2BestWindowEvidence,
	CoverageLexicalV2MatchField,
	CoverageLexicalV2MatchQualityKind,
	CoverageLexicalV2MatchedPrimaryUnitEvidence,
	CoverageLexicalV2PrefixWitnessLite,
} from "../comparator";
import { normalizeCoverageLexicalV2Text } from "../query";
import { extractHanBigrams } from "../../coverage-lexical/coverage-lexical-cjk";
import type {
	CoverageLexicalV2CandidateCascadeDocumentRecord,
	CoverageLexicalV2CandidateCascadeHanExactWitness,
} from "./coverage-lexical-candidate-types";
import {
	compareCoverageLexicalV2MatchQuality,
	getCoverageLexicalV2CandidateCascadeMatchQuality,
	type CoverageLexicalV2CandidateCascadeMatchOptions,
} from "./coverage-lexical-candidate-match";

export type CoverageLexicalV2CandidateCascadeFieldTerms = {
	basenameTerms?: readonly string[];
	aliasTerms?: readonly string[];
	headingsTerms?: readonly string[];
	folderTerms?: readonly string[];
	tagTerms?: readonly string[];
	bodyTerms?: readonly string[];
};

export type CoverageLexicalV2CandidateCascadePrefixHint = {
	field: CoverageLexicalV2MatchField;
	matchedTerm: string;
	fieldDocCount: number;
};

export type CoverageLexicalV2CandidateCascadeDocumentLexicalState = {
	docId: string | number;
	path: string;
	stableDeterministicKey?: string;
	record: CoverageLexicalV2CandidateCascadeDocumentRecord;
	fieldTerms: CoverageLexicalV2CandidateCascadeFieldTerms;
	basenameTokenSequence?: readonly string[];
	aliasTokenSequence?: readonly string[];
	headingsTokenSequence?: readonly string[];
	bodyTokenSequence?: readonly string[];
	getBodyHanExactWitness?: (
		normalizedText: string,
		bigrams: readonly string[],
	) => CoverageLexicalV2CandidateCascadeHanExactWitness | null;
};

export type CoverageLexicalV2CandidateCascadePrimaryUnitDefinition = {
	normalizedText: string;
	surfaceGroupIndex: number;
	surfaceKind: "latin" | "han" | "mixed";
};

type CoverageLexicalV2CandidateCascadeLocalWindowField = Extract<
	CoverageLexicalV2MatchField,
	"basename" | "aliases" | "headings" | "body"
>;

type CoverageLexicalV2CandidateCascadeResolvedBestWindow = {
	field: CoverageLexicalV2CandidateCascadeLocalWindowField;
	matchedUnitKeys: string[];
	contiguousSurfaceGroupCount: number;
	windowWidth: number;
	averageDistance: number;
	preservesSurfaceOrder: boolean;
};

type CoverageLexicalV2CandidateCascadeFieldOccurrence = {
	unitKey: string;
	groupIndex: number;
	start: number;
	end: number;
};

type CoverageLexicalV2CandidateCascadeTokenIndex = {
	normalizedTokens: readonly string[];
	positionsByToken: ReadonlyMap<string, readonly number[]>;
};

type CoverageLexicalV2CandidateCascadeWindowSummary = {
	matchedUnitKeys: string[];
	groupIndices: number[];
	contiguousSurfaceGroupCount: number;
};

type CoverageLexicalV2CandidateCascadeFieldMatch = {
	field: CoverageLexicalV2MatchField;
	quality: CoverageLexicalV2MatchQualityKind;
};

type CoverageLexicalV2CandidateCascadeNormalizedFieldTerms = {
	basenameTerms: readonly string[];
	aliasTerms: readonly string[];
	headingsTerms: readonly string[];
	folderTerms: readonly string[];
	tagTerms: readonly string[];
	bodyTerms: readonly string[];
};

type CoverageLexicalV2CandidateCascadeSurfaceTokenCandidate = {
	surfaceText: string;
	normalizedText: string;
	cleanBoundary: boolean;
	compoundPenalty: boolean;
	surfaceCompletionGain: number;
};

const COVERAGE_LEXICAL_V2_CANDIDATE_CASCADE_LOCAL_WINDOW_FIELDS: readonly CoverageLexicalV2CandidateCascadeLocalWindowField[] = [
	"basename",
	"aliases",
	"headings",
	"body",
];

const COVERAGE_LEXICAL_V2_CANDIDATE_CASCADE_LOCAL_WINDOW_FIELD_PRIORITY: Record<
	CoverageLexicalV2CandidateCascadeLocalWindowField,
	number
> = {
	basename: 0,
	aliases: 1,
	headings: 2,
	body: 3,
};

const COVERAGE_LEXICAL_V2_PREFIX_SURFACE_TOKEN_PATTERN = /[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*/g;

export function buildCoverageLexicalV2CandidateCascadeMatchedPrimaryUnits(
	primaryUnits: readonly CoverageLexicalV2CandidateCascadePrimaryUnitDefinition[],
	document: CoverageLexicalV2CandidateCascadeDocumentLexicalState,
	options: CoverageLexicalV2CandidateCascadeMatchOptions,
	prefixHintsByPrimaryUnit?: ReadonlyMap<number, CoverageLexicalV2CandidateCascadePrefixHint>,
): CoverageLexicalV2MatchedPrimaryUnitEvidence[] {
	const normalizedFieldTerms: CoverageLexicalV2CandidateCascadeNormalizedFieldTerms = {
		basenameTerms: normalizeTerms(document.fieldTerms.basenameTerms),
		aliasTerms: normalizeTerms(document.fieldTerms.aliasTerms),
		headingsTerms: normalizeTerms(document.fieldTerms.headingsTerms),
		folderTerms: normalizeTerms(document.fieldTerms.folderTerms),
		tagTerms: normalizeTerms(document.fieldTerms.tagTerms),
		bodyTerms: normalizeTerms(document.fieldTerms.bodyTerms),
	};
	const units: CoverageLexicalV2MatchedPrimaryUnitEvidence[] = [];
	for (let primaryUnitIndex = 0; primaryUnitIndex < primaryUnits.length; primaryUnitIndex += 1) {
		const unit = primaryUnits[primaryUnitIndex];
		const fieldMatches = collectMatchedFields(unit.normalizedText, normalizedFieldTerms, options);
		if (fieldMatches.length === 0) {
			continue;
		}
		const matchQuality = selectBestMatchQuality(fieldMatches);
		const strongestField = fieldMatches[0].field;
		const prefixWitnessLite =
			matchQuality === "prefix" && isMetadataField(strongestField)
				? buildCoverageLexicalV2PrefixWitnessLite(
					unit,
					prefixHintsByPrimaryUnit?.get(primaryUnitIndex),
					document.record,
				)
				: undefined;
		units.push({
			normalizedText: unit.normalizedText,
			surfaceGroupIndex: unit.surfaceGroupIndex,
			surfaceKind: unit.surfaceKind,
			strongestField,
			corroboratedFields: fieldMatches.slice(1).map((fieldMatch) => fieldMatch.field),
			matchQuality,
			...(prefixWitnessLite ? { prefixWitnessLite } : {}),
		});
	}
	return units;
}

export function buildCoverageLexicalV2CandidateCascadeBestWindowForDocument(
	matchedPrimaryUnits: readonly CoverageLexicalV2MatchedPrimaryUnitEvidence[],
	document: CoverageLexicalV2CandidateCascadeDocumentLexicalState,
): CoverageLexicalV2BestWindowEvidence | null {
	let bestWindow: CoverageLexicalV2CandidateCascadeResolvedBestWindow | null = null;
	for (const field of COVERAGE_LEXICAL_V2_CANDIDATE_CASCADE_LOCAL_WINDOW_FIELDS) {
		const candidateWindow = buildCoverageLexicalV2CandidateCascadeFieldBestWindow(
			matchedPrimaryUnits,
			field,
			document,
		);
		if (
			candidateWindow != null &&
			(bestWindow == null || isBetterCoverageLexicalV2CandidateCascadeBestWindow(candidateWindow, bestWindow))
		) {
			bestWindow = candidateWindow;
		}
	}
	return bestWindow;
}

function buildCoverageLexicalV2CandidateCascadeFieldBestWindow(
	matchedPrimaryUnits: readonly CoverageLexicalV2MatchedPrimaryUnitEvidence[],
	field: CoverageLexicalV2CandidateCascadeLocalWindowField,
	document: CoverageLexicalV2CandidateCascadeDocumentLexicalState,
): CoverageLexicalV2CandidateCascadeResolvedBestWindow | null {
	const relevantUnits = matchedPrimaryUnits.filter(
		(unit) =>
			(unit.matchQuality === "exact" || unit.matchQuality === "prefix") &&
			(unit.strongestField === field || (unit.corroboratedFields ?? []).includes(field)),
	);
	if (relevantUnits.length === 0) {
		return null;
	}
	const tokenSequence = getCoverageLexicalV2CandidateCascadeFieldTokenSequence(document, field);
	const occurrences =
		buildCoverageLexicalV2CandidateCascadeFieldTokenOccurrences(relevantUnits, tokenSequence) ??
		buildCoverageLexicalV2CandidateCascadeFieldExactFallbackOccurrences(
			relevantUnits,
			field,
			document,
		);
	if (occurrences.length === 0) {
		return null;
	}
	const requiredUnitKeys = new Set(
		relevantUnits.map((unit) =>
			createCoverageLexicalV2CandidateCascadeUnitKey(unit.surfaceGroupIndex, unit.normalizedText),
		),
	);
	let bestWindow:
		| {
				start: number;
				end: number;
				matchedUnitKeys: string[];
				groupIndices: number[];
				contiguousSurfaceGroupCount: number;
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
			const windowSummary = summarizeCoverageLexicalV2CandidateCascadeWindowOccurrences(
				occurrences,
				start,
				end,
			);
			const candidateWindow = {
				start: startOccurrence.start,
				end: endOccurrence.end,
				matchedUnitKeys: windowSummary.matchedUnitKeys,
				groupIndices: windowSummary.groupIndices,
				contiguousSurfaceGroupCount: windowSummary.contiguousSurfaceGroupCount,
			};
			if (
				bestWindow == null ||
				isBetterCoverageLexicalV2CandidateCascadeWindowShape(candidateWindow, bestWindow)
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
			contiguousSurfaceGroupCount: 1,
			windowWidth: 1,
			averageDistance: 0,
			preservesSurfaceOrder: true,
		};
	}
	return {
		field,
		matchedUnitKeys: bestWindow.matchedUnitKeys,
		contiguousSurfaceGroupCount: bestWindow.contiguousSurfaceGroupCount,
		windowWidth: bestWindow.end - bestWindow.start + 1,
		averageDistance: computeCoverageLexicalV2CandidateCascadeAverageDistance(
			bestWindow.matchedUnitKeys.length,
			bestWindow.end - bestWindow.start,
		),
		preservesSurfaceOrder: preservesCoverageLexicalV2CandidateCascadeSurfaceOrder(bestWindow.groupIndices),
	};
}

function getCoverageLexicalV2CandidateCascadeFieldTokenSequence(
	document: CoverageLexicalV2CandidateCascadeDocumentLexicalState,
	field: CoverageLexicalV2CandidateCascadeLocalWindowField,
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

function buildCoverageLexicalV2CandidateCascadeTokenIndex(
	tokenSequence: readonly string[] | undefined,
): CoverageLexicalV2CandidateCascadeTokenIndex | null {
	if (!tokenSequence || tokenSequence.length === 0) {
		return null;
	}
	const normalizedTokens = normalizeTerms(tokenSequence);
	if (normalizedTokens.length === 0) {
		return null;
	}
	const positionsByToken = new Map<string, number[]>();
	for (let position = 0; position < normalizedTokens.length; position += 1) {
		const token = normalizedTokens[position];
		const positions = positionsByToken.get(token);
		if (positions) {
			positions.push(position);
			continue;
		}
		positionsByToken.set(token, [position]);
	}
	return {
		normalizedTokens,
		positionsByToken,
	};
}

function buildCoverageLexicalV2CandidateCascadeFieldTokenOccurrences(
	relevantUnits: readonly CoverageLexicalV2MatchedPrimaryUnitEvidence[],
	tokenSequence: readonly string[] | undefined,
): CoverageLexicalV2CandidateCascadeFieldOccurrence[] | null {
	const tokenIndex = buildCoverageLexicalV2CandidateCascadeTokenIndex(tokenSequence);
	if (!tokenIndex) {
		return null;
	}
	const occurrences: CoverageLexicalV2CandidateCascadeFieldOccurrence[] = [];
	for (const relevantUnit of relevantUnits) {
		if (relevantUnit.matchQuality === "prefix") {
			for (const [token, positions] of tokenIndex.positionsByToken.entries()) {
				if (!token.startsWith(relevantUnit.normalizedText)) {
					continue;
				}
				for (const position of positions) {
					occurrences.push(
						buildCoverageLexicalV2CandidateCascadeFieldOccurrence(
							relevantUnit,
							position,
							position,
						),
					);
				}
			}
			continue;
		}
		if (relevantUnit.surfaceKind === "latin") {
			for (const position of tokenIndex.positionsByToken.get(relevantUnit.normalizedText) ?? []) {
				occurrences.push(
					buildCoverageLexicalV2CandidateCascadeFieldOccurrence(
						relevantUnit,
						position,
						position,
					),
				);
			}
			continue;
		}
		for (const [start, end] of collectCoverageLexicalV2CandidateCascadeExactTokenSpans(
			tokenIndex.normalizedTokens,
			relevantUnit.normalizedText,
		)) {
			occurrences.push(
				buildCoverageLexicalV2CandidateCascadeFieldOccurrence(
					relevantUnit,
					start,
					end,
				),
			);
		}
	}
	return occurrences.length > 0
		? sortCoverageLexicalV2CandidateCascadeFieldOccurrences(occurrences)
		: null;
}

function buildCoverageLexicalV2CandidateCascadeFieldExactFallbackOccurrences(
	relevantUnits: readonly CoverageLexicalV2MatchedPrimaryUnitEvidence[],
	field: CoverageLexicalV2CandidateCascadeLocalWindowField,
	document: CoverageLexicalV2CandidateCascadeDocumentLexicalState,
): CoverageLexicalV2CandidateCascadeFieldOccurrence[] {
	if (field === "body") {
		const bodyOccurrences: CoverageLexicalV2CandidateCascadeFieldOccurrence[] = [];
		for (const relevantUnit of relevantUnits) {
			if (
				relevantUnit.matchQuality !== "exact" ||
				relevantUnit.surfaceKind === "latin" ||
				!document.getBodyHanExactWitness
			) {
				continue;
			}
			const witness = document.getBodyHanExactWitness(
				relevantUnit.normalizedText,
				extractHanBigrams(relevantUnit.normalizedText),
			);
			if (!witness) {
				continue;
			}
			bodyOccurrences.push(
				buildCoverageLexicalV2CandidateCascadeFieldOccurrence(
					relevantUnit,
					witness.start,
					witness.end,
				),
			);
		}
		return sortCoverageLexicalV2CandidateCascadeFieldOccurrences(bodyOccurrences);
	}
	const normalizedFieldText = normalizeCoverageLexicalV2Text(
		getCoverageLexicalV2CandidateCascadeLocalWindowFieldText(document.record, field),
	);
	if (!normalizedFieldText) {
		return [];
	}
	const occurrences: CoverageLexicalV2CandidateCascadeFieldOccurrence[] = [];
	for (const relevantUnit of relevantUnits) {
		if (relevantUnit.matchQuality !== "exact" || relevantUnit.surfaceKind === "latin") {
			continue;
		}
		for (const witness of collectCoverageLexicalV2CandidateCascadeExactTextWitnesses(
			normalizedFieldText,
			relevantUnit.normalizedText,
		)) {
			occurrences.push(
				buildCoverageLexicalV2CandidateCascadeFieldOccurrence(
					relevantUnit,
					witness.start,
					witness.end,
				),
			);
		}
	}
	return sortCoverageLexicalV2CandidateCascadeFieldOccurrences(occurrences);
}

function buildCoverageLexicalV2CandidateCascadeFieldOccurrence(
	relevantUnit: CoverageLexicalV2MatchedPrimaryUnitEvidence,
	start: number,
	end: number,
): CoverageLexicalV2CandidateCascadeFieldOccurrence {
	return {
		unitKey: createCoverageLexicalV2CandidateCascadeUnitKey(
			relevantUnit.surfaceGroupIndex,
			relevantUnit.normalizedText,
		),
		groupIndex: relevantUnit.surfaceGroupIndex,
		start,
		end,
	};
}

function collectCoverageLexicalV2CandidateCascadeExactTokenSpans(
	normalizedTokens: readonly string[],
	needle: string,
): Array<readonly [number, number]> {
	const spans: Array<readonly [number, number]> = [];
	for (let start = 0; start < normalizedTokens.length; start += 1) {
		let joined = "";
		for (let end = start; end < normalizedTokens.length; end += 1) {
			joined += normalizedTokens[end];
			if (joined === needle) {
				spans.push([start, end]);
				break;
			}
			if (!needle.startsWith(joined) || joined.length >= needle.length) {
				break;
			}
		}
	}
	return spans;
}

function collectCoverageLexicalV2CandidateCascadeExactTextWitnesses(
	text: string,
	needle: string,
): CoverageLexicalV2CandidateCascadeHanExactWitness[] {
	const witnesses: CoverageLexicalV2CandidateCascadeHanExactWitness[] = [];
	if (!needle) {
		return witnesses;
	}
	let searchStart = 0;
	while (searchStart < text.length) {
		const foundAt = text.indexOf(needle, searchStart);
		if (foundAt < 0) {
			break;
		}
		witnesses.push({
			start: foundAt,
			end: foundAt + needle.length - 1,
		});
		searchStart = foundAt + 1;
	}
	return witnesses;
}

function sortCoverageLexicalV2CandidateCascadeFieldOccurrences(
	occurrences: readonly CoverageLexicalV2CandidateCascadeFieldOccurrence[],
): CoverageLexicalV2CandidateCascadeFieldOccurrence[] {
	return [...occurrences].sort((left, right) => {
		if (left.start !== right.start) {
			return left.start - right.start;
		}
		if (left.end !== right.end) {
			return left.end - right.end;
		}
		return left.unitKey.localeCompare(right.unitKey);
	});
}

function getCoverageLexicalV2CandidateCascadeLocalWindowFieldText(
	record: CoverageLexicalV2CandidateCascadeDocumentRecord,
	field: CoverageLexicalV2CandidateCascadeLocalWindowField,
): string {
	switch (field) {
		case "basename":
			return record.basenameText;
		case "aliases":
			return record.aliasesText;
		case "headings":
			return record.headingsText;
		case "body":
		default:
			return "";
	}
}

function collectMatchedFields(
	term: string,
	terms: CoverageLexicalV2CandidateCascadeNormalizedFieldTerms,
	options: CoverageLexicalV2CandidateCascadeMatchOptions,
): CoverageLexicalV2CandidateCascadeFieldMatch[] {
	const fieldMatches: CoverageLexicalV2CandidateCascadeFieldMatch[] = [];
	pushCoverageLexicalV2CandidateCascadeFieldMatch(fieldMatches, "basename", term, terms.basenameTerms, options);
	pushCoverageLexicalV2CandidateCascadeFieldMatch(fieldMatches, "aliases", term, terms.aliasTerms, options);
	pushCoverageLexicalV2CandidateCascadeFieldMatch(fieldMatches, "headings", term, terms.headingsTerms, options);
	pushCoverageLexicalV2CandidateCascadeFieldMatch(fieldMatches, "folder", term, terms.folderTerms, options);
	pushCoverageLexicalV2CandidateCascadeFieldMatch(fieldMatches, "tag", term, terms.tagTerms, options);
	pushCoverageLexicalV2CandidateCascadeFieldMatch(fieldMatches, "body", term, terms.bodyTerms, options);
	return fieldMatches;
}

function pushCoverageLexicalV2CandidateCascadeFieldMatch(
	fieldMatches: CoverageLexicalV2CandidateCascadeFieldMatch[],
	field: CoverageLexicalV2MatchField,
	queryTerm: string,
	fieldTerms: readonly string[],
	options: CoverageLexicalV2CandidateCascadeMatchOptions,
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
	options: CoverageLexicalV2CandidateCascadeMatchOptions,
): CoverageLexicalV2MatchQualityKind | null {
	let bestMatchQuality: CoverageLexicalV2MatchQualityKind | null = null;
	for (const fieldTerm of fieldTerms) {
		const matchQuality = getCoverageLexicalV2CandidateCascadeMatchQuality(queryTerm, fieldTerm, options);
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
	fieldMatches: readonly CoverageLexicalV2CandidateCascadeFieldMatch[],
): CoverageLexicalV2MatchQualityKind {
	let bestMatchQuality = fieldMatches[0].quality;
	for (let index = 1; index < fieldMatches.length; index += 1) {
		if (compareCoverageLexicalV2MatchQuality(fieldMatches[index].quality, bestMatchQuality) < 0) {
			bestMatchQuality = fieldMatches[index].quality;
		}
	}
	return bestMatchQuality;
}

function buildCoverageLexicalV2PrefixWitnessLite(
	unit: CoverageLexicalV2CandidateCascadePrimaryUnitDefinition,
	prefixHint: CoverageLexicalV2CandidateCascadePrefixHint | undefined,
	record: CoverageLexicalV2CandidateCascadeDocumentRecord,
): CoverageLexicalV2PrefixWitnessLite | undefined {
	if (!prefixHint || !isMetadataField(prefixHint.field)) {
		return undefined;
	}
	const rawText = getCoverageLexicalV2CandidateCascadeMetadataFieldText(record, prefixHint.field);
	const surfaceCandidate =
		selectCoverageLexicalV2PrefixSurfaceToken(rawText, unit.normalizedText, prefixHint.matchedTerm) ??
		buildCoverageLexicalV2FallbackPrefixSurfaceToken(unit.normalizedText, prefixHint.matchedTerm);
	return {
		field: prefixHint.field,
		surfaceText: surfaceCandidate.surfaceText,
		cleanBoundary: surfaceCandidate.cleanBoundary,
		compoundPenalty: surfaceCandidate.compoundPenalty,
		surfaceCompletionGain: surfaceCandidate.surfaceCompletionGain,
		fieldDocCount: prefixHint.fieldDocCount,
	};
}

function selectCoverageLexicalV2PrefixSurfaceToken(
	rawText: string,
	queryTerm: string,
	matchedTerm: string,
): CoverageLexicalV2CandidateCascadeSurfaceTokenCandidate | null {
	let best: CoverageLexicalV2CandidateCascadeSurfaceTokenCandidate | null = null;
	for (const surfaceText of rawText.match(COVERAGE_LEXICAL_V2_PREFIX_SURFACE_TOKEN_PATTERN) ?? []) {
		const normalizedText = normalizeCoverageLexicalV2Text(surfaceText).trim();
		if (!normalizedText || !normalizedText.startsWith(queryTerm)) {
			continue;
		}
		const candidate: CoverageLexicalV2CandidateCascadeSurfaceTokenCandidate = {
			surfaceText,
			normalizedText,
			cleanBoundary: normalizedText === matchedTerm && !/[_-]/.test(surfaceText),
			compoundPenalty: /[_-]/.test(surfaceText),
			surfaceCompletionGain: Math.max(0, normalizedText.length - queryTerm.length),
		};
		if (
			best == null ||
			isBetterCoverageLexicalV2PrefixSurfaceTokenCandidate(candidate, best, matchedTerm)
		) {
			best = candidate;
		}
	}
	return best;
}

function buildCoverageLexicalV2FallbackPrefixSurfaceToken(
	queryTerm: string,
	matchedTerm: string,
): CoverageLexicalV2CandidateCascadeSurfaceTokenCandidate {
	return {
		surfaceText: matchedTerm,
		normalizedText: matchedTerm,
		cleanBoundary: /^[a-z0-9]+$/i.test(matchedTerm),
		compoundPenalty: /[_-]/.test(matchedTerm),
		surfaceCompletionGain: Math.max(0, matchedTerm.length - queryTerm.length),
	};
}

function isBetterCoverageLexicalV2PrefixSurfaceTokenCandidate(
	left: CoverageLexicalV2CandidateCascadeSurfaceTokenCandidate,
	right: CoverageLexicalV2CandidateCascadeSurfaceTokenCandidate,
	matchedTerm: string,
): boolean {
	const leftExact = left.normalizedText === matchedTerm;
	const rightExact = right.normalizedText === matchedTerm;
	if (leftExact !== rightExact) {
		return leftExact;
	}
	if (left.cleanBoundary !== right.cleanBoundary) {
		return left.cleanBoundary;
	}
	if (left.compoundPenalty !== right.compoundPenalty) {
		return !left.compoundPenalty;
	}
	if (left.surfaceCompletionGain !== right.surfaceCompletionGain) {
		return left.surfaceCompletionGain < right.surfaceCompletionGain;
	}
	if (left.normalizedText.length !== right.normalizedText.length) {
		return left.normalizedText.length < right.normalizedText.length;
	}
	return left.surfaceText.localeCompare(right.surfaceText) < 0;
}

function getCoverageLexicalV2CandidateCascadeMetadataFieldText(
	record: CoverageLexicalV2CandidateCascadeDocumentRecord,
	field: CoverageLexicalV2MatchField,
): string {
	switch (field) {
		case "basename":
			return record.basenameText;
		case "aliases":
			return record.aliasesText;
		case "headings":
			return record.headingsText;
		case "folder":
			return record.folderText;
		case "tag":
			return record.tagsText;
		case "body":
		default:
			return "";
	}
}

function isMetadataField(field: CoverageLexicalV2MatchField): boolean {
	return field !== "body";
}

function normalizeTerms(terms: readonly string[] | undefined): string[] {
	return (terms ?? [])
		.map((term) => normalizeCoverageLexicalV2Text(term).trim())
		.filter((term) => term.length > 0);
}

function isBetterCoverageLexicalV2CandidateCascadeBestWindow(
	left: CoverageLexicalV2CandidateCascadeResolvedBestWindow,
	right: CoverageLexicalV2CandidateCascadeResolvedBestWindow,
): boolean {
	if (left.matchedUnitKeys.length !== right.matchedUnitKeys.length) {
		return left.matchedUnitKeys.length > right.matchedUnitKeys.length;
	}
	if (left.preservesSurfaceOrder !== right.preservesSurfaceOrder) {
		return left.preservesSurfaceOrder;
	}
	if (left.contiguousSurfaceGroupCount !== right.contiguousSurfaceGroupCount) {
		return left.contiguousSurfaceGroupCount > right.contiguousSurfaceGroupCount;
	}
	if (left.windowWidth !== right.windowWidth) {
		return left.windowWidth < right.windowWidth;
	}
	if (left.averageDistance !== right.averageDistance) {
		return left.averageDistance < right.averageDistance;
	}
	const leftPriority = COVERAGE_LEXICAL_V2_CANDIDATE_CASCADE_LOCAL_WINDOW_FIELD_PRIORITY[left.field];
	const rightPriority = COVERAGE_LEXICAL_V2_CANDIDATE_CASCADE_LOCAL_WINDOW_FIELD_PRIORITY[right.field];
	if (leftPriority !== rightPriority) {
		return leftPriority < rightPriority;
	}
	return false;
}

function isBetterCoverageLexicalV2CandidateCascadeWindowShape(
	left: {
		start: number;
		end: number;
		matchedUnitKeys: string[];
		groupIndices: number[];
		contiguousSurfaceGroupCount: number;
	},
	right: {
		start: number;
		end: number;
		matchedUnitKeys: string[];
		groupIndices: number[];
		contiguousSurfaceGroupCount: number;
	},
): boolean {
	if (left.matchedUnitKeys.length !== right.matchedUnitKeys.length) {
		return left.matchedUnitKeys.length > right.matchedUnitKeys.length;
	}
	const leftPreservesOrder = preservesCoverageLexicalV2CandidateCascadeSurfaceOrder(left.groupIndices);
	const rightPreservesOrder = preservesCoverageLexicalV2CandidateCascadeSurfaceOrder(right.groupIndices);
	if (leftPreservesOrder !== rightPreservesOrder) {
		return leftPreservesOrder;
	}
	if (left.contiguousSurfaceGroupCount !== right.contiguousSurfaceGroupCount) {
		return left.contiguousSurfaceGroupCount > right.contiguousSurfaceGroupCount;
	}
	const leftWindowWidth = left.end - left.start + 1;
	const rightWindowWidth = right.end - right.start + 1;
	if (leftWindowWidth !== rightWindowWidth) {
		return leftWindowWidth < rightWindowWidth;
	}
	const leftAverageDistance = computeCoverageLexicalV2CandidateCascadeAverageDistance(
		left.matchedUnitKeys.length,
		left.end - left.start,
	);
	const rightAverageDistance = computeCoverageLexicalV2CandidateCascadeAverageDistance(
		right.matchedUnitKeys.length,
		right.end - right.start,
	);
	if (leftAverageDistance !== rightAverageDistance) {
		return leftAverageDistance < rightAverageDistance;
	}
	return left.start < right.start;
}

function summarizeCoverageLexicalV2CandidateCascadeWindowOccurrences(
	occurrences: readonly CoverageLexicalV2CandidateCascadeFieldOccurrence[],
	start: number,
	end: number,
): CoverageLexicalV2CandidateCascadeWindowSummary {
	const matchedUnitKeys: string[] = [];
	const seenUnitKeys = new Set<string>();
	const groupIndices: number[] = [];
	const contiguousByGroup = new Map<number, { lastEnd: number; contiguous: boolean }>();
	for (let index = start; index <= end; index += 1) {
		const occurrence = occurrences[index];
		groupIndices.push(occurrence.groupIndex);
		if (!seenUnitKeys.has(occurrence.unitKey)) {
			seenUnitKeys.add(occurrence.unitKey);
			matchedUnitKeys.push(occurrence.unitKey);
		}
		const contiguousGroup = contiguousByGroup.get(occurrence.groupIndex);
		if (!contiguousGroup) {
			contiguousByGroup.set(occurrence.groupIndex, {
				lastEnd: occurrence.end,
				contiguous: true,
			});
			continue;
		}
		if (occurrence.start > contiguousGroup.lastEnd + 1) {
			contiguousGroup.contiguous = false;
		}
		contiguousGroup.lastEnd = Math.max(contiguousGroup.lastEnd, occurrence.end);
	}
	let contiguousSurfaceGroupCount = 0;
	for (const item of contiguousByGroup.values()) {
		if (item.contiguous) {
			contiguousSurfaceGroupCount += 1;
		}
	}
	return {
		matchedUnitKeys,
		groupIndices,
		contiguousSurfaceGroupCount,
	};
}

function preservesCoverageLexicalV2CandidateCascadeSurfaceOrder(groupIndices: readonly number[]): boolean {
	for (let index = 1; index < groupIndices.length; index += 1) {
		if (groupIndices[index] < groupIndices[index - 1]) {
			return false;
		}
	}
	return true;
}

function computeCoverageLexicalV2CandidateCascadeAverageDistance(
	groupCount: number,
	span: number,
): number {
	if (groupCount <= 1) {
		return 0;
	}
	return span / (groupCount - 1);
}

function createCoverageLexicalV2CandidateCascadeUnitKey(
	surfaceGroupIndex: number,
	normalizedText: string,
): string {
	return String(surfaceGroupIndex) + ":" + normalizedText;
}

