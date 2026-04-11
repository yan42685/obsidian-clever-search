import type {
	CoverageLexicalV2HanBackstopGroup,
	CoverageLexicalV2QueryAnalysis,
	CoverageLexicalV2QuerySurfaceGroup,
	CoverageLexicalV2QueryUnit,
	CoverageLexicalV2QueryUnitSurfaceKind,
} from "./coverage-lexical-query-unit-types";
import { analyzeCoverageLexicalV2QuerySurfaceShape } from "./coverage-lexical-query-shape";
import { extractHanBigrams } from "../../coverage-lexical/coverage-lexical-cjk";

const RAW_QUERY_SEGMENT_REGEX = /[\p{Script=Han}]+|[a-z0-9._/-]+/giu;
const HAN_REGEX = /\p{Script=Han}/u;
const LATIN_REGEX = /[a-z0-9]/u;
const HAN_FUNCTION_WORD_REGEX =
	/(?:关于|有关|对于|什么是|什么叫|如何|怎么|为什么|以及|及|与|和|的|地|得|并且|并|中|里|上|下|将|要|会|吗|呢)/gu;

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
	const hanBackstopGroups: CoverageLexicalV2HanBackstopGroup[] = [];

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
				const primaryUnitIndicesForGroup: number[] = [];
				const shouldPreserveIntactSegment =
					group.normalizedText.length <= 4 || matchingHanTerms.length === 0;
				if (shouldPreserveIntactSegment) {
					const primaryUnitIndex = pushUnit(primaryUnits, {
						text: group.text,
						normalizedText: group.normalizedText,
						tier: "primary",
						source: "surface_han_segment",
						surfaceGroupIndex: group.index,
						surfaceKind: group.kind,
					});
					primaryUnitIndicesForGroup.push(primaryUnitIndex);
					emittedTerms.add(group.normalizedText);
				}
				for (const term of matchingHanTerms) {
					if (emittedTerms.has(term)) {
						continue;
					}
					const primaryUnitIndex = pushUnit(primaryUnits, {
						text: term,
						normalizedText: term,
						tier: "primary",
						source: term === group.normalizedText ? "surface_han_segment" : "tokenizer_han_term",
						surfaceGroupIndex: group.index,
						surfaceKind: group.kind,
					});
					primaryUnitIndicesForGroup.push(primaryUnitIndex);
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
				hanBackstopGroups.push(
					...buildCoverageLexicalV2HanBackstopGroups(
						group,
						matchingHanTerms,
						primaryUnitIndicesForGroup,
					),
				);
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
		hanBackstopGroups,
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

function buildCoverageLexicalV2HanBackstopGroups(
	group: CoverageLexicalV2QuerySurfaceGroup,
	matchingHanTerms: readonly string[],
	primaryUnitIndices: readonly number[],
): CoverageLexicalV2HanBackstopGroup[] {
	const chars = Array.from(group.normalizedText);
	if (chars.length < 2) {
		return [];
	}
	const coverageFlags = new Array<boolean>(chars.length).fill(false);
	for (const term of matchingHanTerms) {
		markCoverageLexicalV2HanTerm(chars, term, coverageFlags);
	}
	if (isCoverageLexicalV2OpaqueFullHanTerm(group, matchingHanTerms)) {
		const reducedGroups = buildCoverageLexicalV2OpaqueHanBackstopGroups(
			group,
			primaryUnitIndices,
		);
		if (reducedGroups.length > 0) {
			return reducedGroups;
		}
	}
	if (coverageFlags.every(Boolean)) {
		const bigrams = extractHanBigrams(group.normalizedText);
		return bigrams.length > 0
			? [{
				surfaceGroupIndex: group.index,
				normalizedText: group.normalizedText,
				bigrams,
				charLength: chars.length,
				triggerKind: "fragile_covered",
				primaryUnitIndices: [...primaryUnitIndices],
			}]
			: [];
	}
	const groups: CoverageLexicalV2HanBackstopGroup[] = [];
	let startIndex: number | null = null;
	for (let index = 0; index <= coverageFlags.length; index += 1) {
		const isCovered = index < coverageFlags.length ? coverageFlags[index] : true;
		if (!isCovered && startIndex == null) {
			startIndex = index;
			continue;
		}
		if (!isCovered || startIndex == null) {
			continue;
		}
		const residualText = chars.slice(startIndex, index).join("");
		if (Array.from(residualText).length >= 2) {
			const bigrams = extractHanBigrams(residualText);
			if (bigrams.length > 0) {
				groups.push({
					surfaceGroupIndex: group.index,
					normalizedText: residualText,
					bigrams,
					charLength: Array.from(residualText).length,
					triggerKind: "residual",
					primaryUnitIndices: [...primaryUnitIndices],
				});
			}
		}
		startIndex = null;
	}
	return groups;
}

function isCoverageLexicalV2OpaqueFullHanTerm(
	group: CoverageLexicalV2QuerySurfaceGroup,
	matchingHanTerms: readonly string[],
): boolean {
	return (
		group.normalizedText.length > 4 &&
		matchingHanTerms.length === 1 &&
		matchingHanTerms[0] === group.normalizedText
	);
}

function buildCoverageLexicalV2OpaqueHanBackstopGroups(
	group: CoverageLexicalV2QuerySurfaceGroup,
	primaryUnitIndices: readonly number[],
): CoverageLexicalV2HanBackstopGroup[] {
	const reducedTerms = group.normalizedText
		.replace(HAN_FUNCTION_WORD_REGEX, " ")
		.split(/\s+/u)
		.map((term) => term.trim())
		.filter((term) => term.length >= 2);
	const uniqueReducedTerms = [...new Set(reducedTerms)];
	return uniqueReducedTerms
		.map((term) => ({
			surfaceGroupIndex: group.index,
			normalizedText: term,
			bigrams: extractHanBigrams(term),
			charLength: Array.from(term).length,
			triggerKind: "residual" as const,
			primaryUnitIndices: [...primaryUnitIndices],
		}))
		.filter((backstopGroup) => backstopGroup.bigrams.length > 0);
}

function markCoverageLexicalV2HanTerm(
	chars: readonly string[],
	term: string,
	coverageFlags: boolean[],
): void {
	const termChars = Array.from(term);
	if (termChars.length < 2 || termChars.length > chars.length) {
		return;
	}
	for (let startIndex = 0; startIndex <= chars.length - termChars.length; startIndex += 1) {
		let matches = true;
		for (let termIndex = 0; termIndex < termChars.length; termIndex += 1) {
			if (chars[startIndex + termIndex] !== termChars[termIndex]) {
				matches = false;
				break;
			}
		}
		if (!matches) {
			continue;
		}
		for (let termIndex = 0; termIndex < termChars.length; termIndex += 1) {
			coverageFlags[startIndex + termIndex] = true;
		}
	}
}

function pushUnit(
	units: CoverageLexicalV2QueryUnit[],
	unit: CoverageLexicalV2QueryUnit,
): number {
	const existingIndex = units.findIndex(
		(existing) =>
			existing.tier === unit.tier &&
			existing.normalizedText === unit.normalizedText &&
			existing.surfaceGroupIndex === unit.surfaceGroupIndex &&
			existing.source === unit.source,
	);
	if (existingIndex !== -1) {
		return existingIndex;
	}
	units.push(unit);
	return units.length - 1;
}
