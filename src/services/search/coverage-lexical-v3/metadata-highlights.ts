import type { HighlightRange } from "src/globals/search-types";
import type { EvidencePackingProfile } from "./ranking";
import type {
	V3HanBackstopGroup,
	V3QueryAnalysis,
	V3QueryUnit,
} from "./query/analysis";

type MetadataHighlightOccurrenceKind =
	| "real_exact"
	| "fuzzy"
	| "surface_completion"
	| "residual_support";

type MetadataHighlightOccurrence = Readonly<{
	kind: MetadataHighlightOccurrenceKind;
	start: number;
	end: number;
	queryUnitIndex: number | null;
	surfaceGroupIndex: number | null;
	residualSupportKind?: "residual_span" | "bridge_bigram" | null;
}>;

type TextSegment = Readonly<{
	start: number;
	end: number;
}>;

export function buildV3MetadataFieldHighlightRanges(params: {
	queryAnalysis: V3QueryAnalysis;
	candidate: EvidencePackingProfile;
	basenameText: string;
	folderText: string;
}): Readonly<{
	basenameHighlightRanges: HighlightRange[];
	basenameWeakHighlightRanges: HighlightRange[];
	folderHighlightRanges: HighlightRange[];
	folderWeakHighlightRanges: HighlightRange[];
}> {
	const eligibleSurfaceGroupIndices = new Set(
		params.candidate.hanSurfaceCompletionGroups.map((group) => group.surfaceGroupIndex),
	);
	const basenameHighlights = buildFieldHighlightRanges({
		text: params.basenameText,
		queryAnalysis: params.queryAnalysis,
		candidate: params.candidate,
		eligibleSurfaceGroupIndices,
		residualSegments:
			params.basenameText.length > 0
				? [{ start: 0, end: params.basenameText.length }]
				: [],
	});
	const folderHighlights = buildFieldHighlightRanges({
		text: params.folderText,
		queryAnalysis: params.queryAnalysis,
		candidate: params.candidate,
		eligibleSurfaceGroupIndices,
		residualSegments: splitPathSegments(params.folderText),
	});
	return {
		basenameHighlightRanges: basenameHighlights.strongHighlightRanges,
		basenameWeakHighlightRanges: basenameHighlights.weakHighlightRanges,
		folderHighlightRanges: folderHighlights.strongHighlightRanges,
		folderWeakHighlightRanges: folderHighlights.weakHighlightRanges,
	};
}

function buildFieldHighlightRanges(params: {
	text: string;
	queryAnalysis: V3QueryAnalysis;
	candidate: EvidencePackingProfile;
	eligibleSurfaceGroupIndices: ReadonlySet<number>;
	residualSegments: readonly TextSegment[];
}): Readonly<{
	strongHighlightRanges: HighlightRange[];
	weakHighlightRanges: HighlightRange[];
}> {
	if (params.text.length === 0) {
		return {
			strongHighlightRanges: [],
			weakHighlightRanges: [],
		};
	}
	const baseOccurrences = collectBaseOccurrences(
		params.text,
		params.queryAnalysis,
		params.candidate,
		params.eligibleSurfaceGroupIndices,
	);
	const residualOccurrences = collectResidualSupportOccurrences(
		params.text,
		params.queryAnalysis,
		baseOccurrences,
		params.eligibleSurfaceGroupIndices,
		params.residualSegments,
	);
	const keptOccurrences = resolveDominantOccurrences(
		[...baseOccurrences, ...residualOccurrences],
		params.queryAnalysis,
	);
	const strongHighlightRanges = mergeHighlightRanges(
		keptOccurrences
			.filter((occurrence) => occurrence.kind !== "fuzzy")
			.map((occurrence) => ({
				start: occurrence.start,
				end: occurrence.end,
			})),
	);
	const weakHighlightRanges = mergeHighlightRanges(
		keptOccurrences
			.filter((occurrence) => occurrence.kind === "fuzzy")
			.filter(
				(occurrence) =>
					!strongHighlightRanges.some((range) =>
						rangesOverlap(
							range.start,
							range.end,
							occurrence.start,
							occurrence.end,
						),
					),
			)
			.map((occurrence) => ({
				start: occurrence.start,
				end: occurrence.end,
			})),
	);
	return {
		strongHighlightRanges,
		weakHighlightRanges,
	};
}

function collectBaseOccurrences(
	text: string,
	queryAnalysis: V3QueryAnalysis,
	candidate: EvidencePackingProfile,
	eligibleSurfaceGroupIndices: ReadonlySet<number>,
): MetadataHighlightOccurrence[] {
	const occurrences: MetadataHighlightOccurrence[] = [];
	const realizedFamilyByUnitIndex = new Map(
		candidate.realizedFamilies.map((family) => [family.queryUnitIndex, family]),
	);
	for (const unit of queryAnalysis.primaryUnits) {
		const realizedFamily = realizedFamilyByUnitIndex.get(unit.index);
		const occurrenceKind =
			realizedFamily?.matchKind === "fuzzy" ? "fuzzy" : "real_exact";
		const occurrenceText =
			realizedFamily?.matchKind === "fuzzy"
				? realizedFamily.familyText
				: unit.text;
		for (const occurrence of findTextOccurrences(text, occurrenceText, unit)) {
			occurrences.push({
				kind: occurrenceKind,
				start: occurrence.start,
				end: occurrence.end,
				queryUnitIndex: unit.index,
				surfaceGroupIndex: unit.surfaceGroupIndex,
			});
		}
	}
	for (const group of queryAnalysis.surfaceGroups) {
		if (
			group.kind !== "han" ||
			Array.from(group.text).length < 2 ||
			(eligibleSurfaceGroupIndices.size > 0 &&
				!eligibleSurfaceGroupIndices.has(group.index))
		) {
			continue;
		}
		for (const occurrence of findTextOccurrences(text, group.text)) {
			occurrences.push({
				kind: "surface_completion",
				start: occurrence.start,
				end: occurrence.end,
				queryUnitIndex: null,
				surfaceGroupIndex: group.index,
			});
		}
	}
	return occurrences.sort(
		(left, right) => left.start - right.start || left.end - right.end,
	);
}

function collectResidualSupportOccurrences(
	text: string,
	queryAnalysis: V3QueryAnalysis,
	baseOccurrences: readonly MetadataHighlightOccurrence[],
	eligibleSurfaceGroupIndices: ReadonlySet<number>,
	residualSegments: readonly TextSegment[],
): MetadataHighlightOccurrence[] {
	if (residualSegments.length === 0) {
		return [];
	}
	const unitByIndex = new Map(
		queryAnalysis.primaryUnits.map((unit) => [unit.index, unit]),
	);
	const supportingRealOccurrencesByGroup = new Map<
		number,
		MetadataHighlightOccurrence[]
	>();
	const surfaceCompletionsByGroup = new Map<number, MetadataHighlightOccurrence[]>();
	for (const occurrence of baseOccurrences) {
		if (occurrence.kind === "surface_completion" && occurrence.surfaceGroupIndex != null) {
			const existing =
				surfaceCompletionsByGroup.get(occurrence.surfaceGroupIndex) ?? [];
			existing.push(occurrence);
			surfaceCompletionsByGroup.set(occurrence.surfaceGroupIndex, existing);
			continue;
		}
		if (
			occurrence.kind !== "real_exact" ||
			occurrence.surfaceGroupIndex == null
		) {
			continue;
		}
		const unit = unitByIndex.get(occurrence.queryUnitIndex ?? -1);
		if (unit?.source !== "han_tokenizer_real") {
			continue;
		}
		const existing =
			supportingRealOccurrencesByGroup.get(occurrence.surfaceGroupIndex) ?? [];
		existing.push(occurrence);
		supportingRealOccurrencesByGroup.set(occurrence.surfaceGroupIndex, existing);
	}
	const residualOccurrences: MetadataHighlightOccurrence[] = [];
	const seen = new Set<string>();
	for (const segment of residualSegments) {
		const segmentText = text.slice(segment.start, segment.end);
		for (const backstopGroup of queryAnalysis.hanBackstopGroups) {
			if (
				backstopGroup.triggerKind === "whole_group_backstop" ||
				(eligibleSurfaceGroupIndices.size > 0 &&
					!eligibleSurfaceGroupIndices.has(backstopGroup.surfaceGroupIndex))
			) {
				continue;
			}
			const supportingRealOccurrences =
				(supportingRealOccurrencesByGroup.get(backstopGroup.surfaceGroupIndex) ?? []).filter(
					(occurrence) =>
						occurrence.start >= segment.start && occurrence.end <= segment.end,
				);
			if (supportingRealOccurrences.length === 0) {
				continue;
			}
			const localSurfaceCompletions =
				(surfaceCompletionsByGroup.get(backstopGroup.surfaceGroupIndex) ?? []).filter(
					(occurrence) =>
						occurrence.start >= segment.start && occurrence.end <= segment.end,
				);
			if (localSurfaceCompletions.length > 0) {
				continue;
			}
			if (backstopGroup.triggerKind === "residual_span") {
				pushResidualSpanOccurrences(
					residualOccurrences,
					seen,
					segment,
					segmentText,
					backstopGroup,
				);
				continue;
			}
			pushBridgeResidualOccurrences(
				residualOccurrences,
				seen,
				segment,
				segmentText,
				backstopGroup,
				supportingRealOccurrences,
			);
		}
	}
	return residualOccurrences.sort(
		(left, right) => left.start - right.start || left.end - right.end,
	);
}

function pushResidualSpanOccurrences(
	target: MetadataHighlightOccurrence[],
	seen: Set<string>,
	segment: TextSegment,
	segmentText: string,
	backstopGroup: V3HanBackstopGroup,
): void {
	for (const occurrence of findTextOccurrences(segmentText, backstopGroup.normalizedText)) {
		pushUniqueOccurrence(target, seen, {
			kind: "residual_support",
			start: segment.start + occurrence.start,
			end: segment.start + occurrence.end,
			queryUnitIndex: null,
			surfaceGroupIndex: backstopGroup.surfaceGroupIndex,
			residualSupportKind: "residual_span",
		});
	}
}

function pushBridgeResidualOccurrences(
	target: MetadataHighlightOccurrence[],
	seen: Set<string>,
	segment: TextSegment,
	segmentText: string,
	backstopGroup: V3HanBackstopGroup,
	supportingRealOccurrences: readonly MetadataHighlightOccurrence[],
): void {
	for (const bigram of backstopGroup.bigrams) {
		const residualOffset = bigram.indexOf(backstopGroup.normalizedText);
		if (residualOffset < 0) {
			continue;
		}
		for (const occurrence of findTextOccurrences(segmentText, bigram)) {
			const bigramStart = segment.start + occurrence.start;
			const bigramEnd = segment.start + occurrence.end;
			if (
				!supportingRealOccurrences.some((realOccurrence) =>
					rangesOverlap(realOccurrence.start, realOccurrence.end, bigramStart, bigramEnd),
				)
			) {
				continue;
			}
			pushUniqueOccurrence(target, seen, {
				kind: "residual_support",
				start: segment.start + occurrence.start + residualOffset,
				end:
					segment.start +
					occurrence.start +
					residualOffset +
					backstopGroup.normalizedText.length,
				queryUnitIndex: null,
				surfaceGroupIndex: backstopGroup.surfaceGroupIndex,
				residualSupportKind: "bridge_bigram",
			});
		}
	}
}

function resolveDominantOccurrences(
	occurrences: readonly MetadataHighlightOccurrence[],
	queryAnalysis: V3QueryAnalysis,
): MetadataHighlightOccurrence[] {
	const unitByIndex = new Map(
		queryAnalysis.primaryUnits.map((unit) => [unit.index, unit]),
	);
	const surfaceGroupIndices = new Set(
		occurrences
			.filter((occurrence) => occurrence.kind === "surface_completion")
			.map((occurrence) => occurrence.surfaceGroupIndex ?? -1),
	);
	return occurrences.filter((occurrence) => {
		if (occurrence.kind === "surface_completion") {
			return true;
		}
		if (
			occurrence.kind === "residual_support" &&
			surfaceGroupIndices.has(occurrence.surfaceGroupIndex ?? -1)
		) {
			return false;
		}
		if (
			occurrence.kind !== "real_exact" ||
			occurrence.surfaceGroupIndex == null ||
			!surfaceGroupIndices.has(occurrence.surfaceGroupIndex)
		) {
			return true;
		}
		const unit = unitByIndex.get(occurrence.queryUnitIndex ?? -1);
		return unit?.source !== "han_tokenizer_real";
	});
}

function findTextOccurrences(
	haystack: string,
	needle: string,
	unit?: V3QueryUnit,
): Array<{ start: number; end: number }> {
	const out: Array<{ start: number; end: number }> = [];
	if (needle.length === 0 || haystack.length === 0) {
		return out;
	}
	const useCaseInsensitive = unit == null || unit.source === "surface";
	const haystackText = useCaseInsensitive ? haystack.toLowerCase() : haystack;
	const needleText = useCaseInsensitive ? needle.toLowerCase() : needle;
	let searchStart = 0;
	while (searchStart < haystackText.length) {
		const index = haystackText.indexOf(needleText, searchStart);
		if (index < 0) {
			break;
		}
		out.push({ start: index, end: index + needleText.length });
		searchStart = index + 1;
	}
	return out;
}

function splitPathSegments(text: string): TextSegment[] {
	const segments: TextSegment[] = [];
	let segmentStart = -1;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		const isSeparator = char === "/" || char === "\\";
		if (!isSeparator && segmentStart < 0) {
			segmentStart = index;
		}
		if (!isSeparator) {
			continue;
		}
		if (segmentStart >= 0 && segmentStart < index) {
			segments.push({ start: segmentStart, end: index });
		}
		segmentStart = -1;
	}
	if (segmentStart >= 0 && segmentStart < text.length) {
		segments.push({ start: segmentStart, end: text.length });
	}
	return segments;
}

function pushUniqueOccurrence(
	target: MetadataHighlightOccurrence[],
	seen: Set<string>,
	occurrence: MetadataHighlightOccurrence,
): void {
	const key = [
		occurrence.kind,
		occurrence.queryUnitIndex ?? -1,
		occurrence.surfaceGroupIndex ?? -1,
		occurrence.start,
		occurrence.end,
		occurrence.residualSupportKind ?? "none",
	].join(":");
	if (seen.has(key)) {
		return;
	}
	seen.add(key);
	target.push(occurrence);
}

function mergeHighlightRanges(
	ranges: readonly HighlightRange[],
): HighlightRange[] {
	if (ranges.length <= 1) {
		return [...ranges];
	}
	const sorted = [...ranges].sort(
		(left, right) => left.start - right.start || left.end - right.end,
	);
	const merged: HighlightRange[] = [sorted[0]];
	for (let index = 1; index < sorted.length; index += 1) {
		const current = sorted[index];
		const previous = merged[merged.length - 1];
		if (current.start <= previous.end) {
			previous.end = Math.max(previous.end, current.end);
			continue;
		}
		merged.push({ ...current });
	}
	return merged;
}

function rangesOverlap(
	leftStart: number,
	leftEnd: number,
	rightStart: number,
	rightEnd: number,
): boolean {
	return Math.min(leftEnd, rightEnd) > Math.max(leftStart, rightStart);
}
