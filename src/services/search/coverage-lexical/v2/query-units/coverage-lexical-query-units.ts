import type {
	CoverageLexicalV2QueryAnalysis,
	CoverageLexicalV2QuerySurfaceGroup,
	CoverageLexicalV2QueryUnit,
	CoverageLexicalV2QueryUnitSurfaceKind,
} from "./coverage-lexical-query-unit-types";
import { analyzeCoverageLexicalV2QuerySurfaceShape } from "./coverage-lexical-query-shape";

const RAW_QUERY_SEGMENT_REGEX = /[\p{Script=Han}]+|[a-z0-9._/-]+/giu;
const HAN_REGEX = /\p{Script=Han}/u;
const LATIN_REGEX = /[a-z0-9]/u;

export function buildCoverageLexicalV2QueryAnalysis(
	queryText: string,
	queryTerms: readonly string[],
): CoverageLexicalV2QueryAnalysis {
	const normalizedQueryText = normalizeCoverageLexicalV2Text(queryText);
	const rawSegments = (normalizedQueryText.match(RAW_QUERY_SEGMENT_REGEX) ?? [])
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0);
	const surfaceGroups = rawSegments.map<CoverageLexicalV2QuerySurfaceGroup>(
		(segment, index) => ({
			index,
			text: segment,
			normalizedText: segment,
			kind: classifySurfaceKind(segment),
		}),
	);
	const normalizedTerms = dedupeNormalizedTerms(queryTerms);
	const primaryUnits: CoverageLexicalV2QueryUnit[] = [];
	const fallbackUnits: CoverageLexicalV2QueryUnit[] = [];
	const derivedUnits: CoverageLexicalV2QueryUnit[] = [];

	for (const group of surfaceGroups) {
		switch (group.kind) {
			case "latin":
			case "mixed":
				pushUnit(primaryUnits, {
					text: group.text,
					normalizedText: group.normalizedText,
					tier: "primary",
					source: group.kind === "mixed" ? "mixed_script_segment" : "latin_segment",
					surfaceGroupIndex: group.index,
					surfaceKind: group.kind,
				});
				break;
			case "han": {
				const matchingHanTerms = normalizedTerms
					.filter((term) => HAN_REGEX.test(term) && term.length >= 2 && group.normalizedText.includes(term))
					.sort((left, right) => right.length - left.length || left.localeCompare(right));
				const emittedTerms = new Set<string>();
				const shouldPreserveIntactSegment = group.normalizedText.length <= 4 || matchingHanTerms.length === 0;
				if (shouldPreserveIntactSegment) {
					pushUnit(primaryUnits, {
						text: group.text,
						normalizedText: group.normalizedText,
						tier: "primary",
						source: "surface_han_segment",
						surfaceGroupIndex: group.index,
						surfaceKind: group.kind,
					});
					emittedTerms.add(group.normalizedText);
				}
				for (const term of matchingHanTerms) {
					if (emittedTerms.has(term)) {
						continue;
					}
					pushUnit(primaryUnits, {
						text: term,
						normalizedText: term,
						tier: "primary",
						source: term === group.normalizedText ? "surface_han_segment" : "tokenizer_han_term",
						surfaceGroupIndex: group.index,
						surfaceKind: group.kind,
					});
					emittedTerms.add(term);
				}
				for (const bigram of extractHanBigrams(group.normalizedText)) {
					pushUnit(fallbackUnits, {
						text: bigram,
						normalizedText: bigram,
						tier: "fallback",
						source: "han_bigram",
						surfaceGroupIndex: group.index,
						surfaceKind: group.kind,
					});
				}
				break;
			}
			default:
				break;
		}
	}

	const surfaceShape = analyzeCoverageLexicalV2QuerySurfaceShape(surfaceGroups);
	return {
		normalizedQueryText,
		surfaceGroups,
		surfaceShape,
		primaryUnits,
		fallbackUnits,
		derivedUnits,
		hasMixedScriptGroups: surfaceShape.requiresCrossScriptCoverage,
		hasHanGroups: surfaceShape.hanGroupCount > 0,
		hasLatinGroups: surfaceShape.latinGroupCount > 0,
	};
}

export function normalizeCoverageLexicalV2Text(text: string): string {
	return text.toLowerCase().normalize("NFKC");
}

function dedupeNormalizedTerms(queryTerms: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const term of queryTerms) {
		const normalized = normalizeCoverageLexicalV2Text(term).trim();
		if (normalized.length === 0 || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		out.push(normalized);
	}
	return out;
}

function classifySurfaceKind(segment: string): CoverageLexicalV2QueryUnitSurfaceKind {
	const hasHan = HAN_REGEX.test(segment);
	const hasLatin = LATIN_REGEX.test(segment);
	if (hasHan && hasLatin) {
		return "mixed";
	}
	if (hasHan) {
		return "han";
	}
	if (hasLatin) {
		return "latin";
	}
	return "other";
}

function extractHanBigrams(text: string): string[] {
	const bigrams: string[] = [];
	const seen = new Set<string>();
	for (const match of normalizeCoverageLexicalV2Text(text).matchAll(/[\p{Script=Han}]+/gu)) {
		const chars = Array.from(match[0]);
		for (let index = 0; index < chars.length - 1; index += 1) {
			const bigram = chars[index] + chars[index + 1];
			if (seen.has(bigram)) {
				continue;
			}
			seen.add(bigram);
			bigrams.push(bigram);
		}
	}
	return bigrams;
}

function pushUnit(
	units: CoverageLexicalV2QueryUnit[],
	unit: CoverageLexicalV2QueryUnit,
): void {
	if (
		units.some(
			(existing) =>
				existing.tier === unit.tier &&
				existing.normalizedText === unit.normalizedText &&
				existing.surfaceGroupIndex === unit.surfaceGroupIndex &&
				existing.source === unit.source,
		)
	) {
		return;
	}
	units.push(unit);
}
