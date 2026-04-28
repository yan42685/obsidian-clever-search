import type { RealizedQueryUnitFamily } from "./ranking/types";
import type { V3QueryAnalysis, V3QuerySurfaceGroup, V3QueryUnit } from "./query/analysis";
import {
	mapNormalizedRangeToOriginalRange,
	normalizeText,
	normalizeTextWithOffsetMap,
} from "./query/text";

export type PrimitiveTextOccurrence = Readonly<{
	start: number;
	end: number;
	matchedText: string;
}>;

export type RealizedFamilyTextOccurrence = PrimitiveTextOccurrence &
	Readonly<{
		queryUnitIndex: number;
		surfaceGroupIndex: number | null;
		matchKind: RealizedQueryUnitFamily["matchKind"];
	}>;

export type OpaqueBigramTextOccurrence = PrimitiveTextOccurrence &
	Readonly<{
		surfaceGroupIndex: number;
		bigramText: string;
	}>;

export type ConfirmedSurfaceTextSpan = PrimitiveTextOccurrence &
	Readonly<{
		surfaceGroupIndex: number;
		surfaceText: string;
	}>;

export function findPrimitiveTextOccurrences(
	haystack: string,
	needle: string,
	caseInsensitive: boolean,
): PrimitiveTextOccurrence[] {
	const out: PrimitiveTextOccurrence[] = [];
	if (haystack.length === 0 || needle.length === 0) {
		return out;
	}
	if (caseInsensitive) {
		const normalizedHaystack = normalizeTextWithOffsetMap(haystack);
		const needleText = normalizeText(needle);
		let searchStart = 0;
		while (searchStart < normalizedHaystack.text.length) {
			const foundIndex = normalizedHaystack.text.indexOf(needleText, searchStart);
			if (foundIndex < 0) {
				break;
			}
			const range = mapNormalizedRangeToOriginalRange(
				normalizedHaystack,
				foundIndex,
				foundIndex + needleText.length,
			);
			out.push({
				start: range.start,
				end: range.end,
				matchedText: needle,
			});
			searchStart = foundIndex + 1;
		}
		return out;
	}
	const haystackText = haystack;
	const needleText = needle;
	let searchStart = 0;
	while (searchStart < haystackText.length) {
		const foundIndex = haystackText.indexOf(needleText, searchStart);
		if (foundIndex < 0) {
			break;
		}
		out.push({
			start: foundIndex,
			end: foundIndex + needleText.length,
			matchedText: needle,
		});
		searchStart = foundIndex + 1;
	}
	return out;
}

export function collectRealizedFamilyOccurrencesInText(params: Readonly<{
	text: string;
	queryAnalysis: V3QueryAnalysis;
	realizedFamilies: readonly RealizedQueryUnitFamily[];
	includeFamily?: (family: RealizedQueryUnitFamily) => boolean;
}>): RealizedFamilyTextOccurrence[] {
	const unitByIndex = new Map<number, V3QueryUnit>(
		params.queryAnalysis.primaryUnits.map((unit) => [unit.index, unit]),
	);
	const out: RealizedFamilyTextOccurrence[] = [];
	for (const family of params.realizedFamilies) {
		if (params.includeFamily != null && !params.includeFamily(family)) {
			continue;
		}
		if (
			family.matchKind !== "exact" &&
			family.matchKind !== "prefix" &&
			family.matchKind !== "fuzzy"
		) {
			continue;
		}
		const unit = unitByIndex.get(family.queryUnitIndex);
		const caseInsensitive = unit?.source === "surface";
		for (const occurrence of findPrimitiveTextOccurrences(
			params.text,
			family.familyText,
			caseInsensitive,
		)) {
			out.push({
				start: occurrence.start,
				end: occurrence.end,
				matchedText: family.familyText,
				queryUnitIndex: family.queryUnitIndex,
				surfaceGroupIndex:
					family.querySurfaceGroupIndex ?? unit?.surfaceGroupIndex ?? null,
				matchKind: family.matchKind,
			});
		}
	}
	return out.sort(comparePrimitiveOccurrenceOrder);
}

export function collectOpaqueBigramOccurrencesInText(params: Readonly<{
	text: string;
	surfaceGroupIndex: number;
	rescueBigrams: readonly string[];
}>): OpaqueBigramTextOccurrence[] {
	if (params.rescueBigrams.length === 0) {
		return [];
	}
	const out: OpaqueBigramTextOccurrence[] = [];
	for (const bigramText of params.rescueBigrams) {
		for (const occurrence of findPrimitiveTextOccurrences(
			params.text,
			bigramText,
			false,
		)) {
			out.push({
				start: occurrence.start,
				end: occurrence.end,
				matchedText: bigramText,
				surfaceGroupIndex: params.surfaceGroupIndex,
				bigramText,
			});
		}
	}
	return out.sort(comparePrimitiveOccurrenceOrder);
}

export function resolveConfirmedSurfaceSpans(params: Readonly<{
	text: string;
	surfaceGroup: V3QuerySurfaceGroup;
	supportingRanges: readonly PrimitiveTextOccurrence[];
}>): ConfirmedSurfaceTextSpan[] {
	if (
		params.surfaceGroup.kind !== "han" ||
		Array.from(params.surfaceGroup.text).length < 2 ||
		params.supportingRanges.length === 0
	) {
		return [];
	}
	const out: ConfirmedSurfaceTextSpan[] = [];
	for (const occurrence of findPrimitiveTextOccurrences(
		params.text,
		params.surfaceGroup.text,
		false,
	)) {
		const overlapsSupportingRange = params.supportingRanges.some(
			(range) => range.start >= occurrence.start && range.end <= occurrence.end,
		);
		if (!overlapsSupportingRange) {
			continue;
		}
		out.push({
			start: occurrence.start,
			end: occurrence.end,
			matchedText: params.surfaceGroup.text,
			surfaceGroupIndex: params.surfaceGroup.index,
			surfaceText: params.surfaceGroup.text,
		});
	}
	return out.sort(comparePrimitiveOccurrenceOrder);
}

function comparePrimitiveOccurrenceOrder(
	left: PrimitiveTextOccurrence,
	right: PrimitiveTextOccurrence,
): number {
	if (left.start !== right.start) {
		return left.start - right.start;
	}
	if (left.end !== right.end) {
		return left.end - right.end;
	}
	return left.matchedText.localeCompare(right.matchedText);
}
