import type { HighlightRange } from "src/globals/search-types";
import type { EvidencePackingProfile } from "./ranking";
import type {
	V3QueryAnalysis,
	V3QuerySurfaceGroup,
} from "./query/analysis";
import {
	collectOpaqueBigramOccurrencesInText,
	collectRealizedFamilyOccurrencesInText,
	resolveConfirmedSurfaceSpans,
	type PrimitiveTextOccurrence,
} from "./primitive-evidence";

type MetadataHighlightOccurrenceKind =
	| "singleton_han"
	| "real_exact"
	| "fuzzy"
	| "opaque_bigram"
	| "confirmed_surface";

type MetadataHighlightOccurrence = Readonly<{
	kind: MetadataHighlightOccurrenceKind;
	start: number;
	end: number;
	queryUnitIndex: number | null;
	surfaceGroupIndex: number | null;
}>;

type MetadataWitness = Readonly<{
	field: "basename" | "folder";
	start: number;
	end: number;
	text: string;
	order: number;
}>;

type WitnessHighlightBundle = Readonly<{
	strong: readonly MetadataHighlightOccurrence[];
	weak: readonly MetadataHighlightOccurrence[];
}>;

type SurfaceWitnessCandidate = Readonly<{
	witness: MetadataWitness;
	realOccurrences: readonly MetadataHighlightOccurrence[];
	opaqueBigramOccurrences: readonly MetadataHighlightOccurrence[];
	confirmedSurfaceOccurrences: readonly MetadataHighlightOccurrence[];
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
	const witnesses = collectMetadataWitnesses(
		params.basenameText,
		params.folderText,
	);
	const realOccurrencesByField = collectRealMetadataOccurrencesByField({
		queryAnalysis: params.queryAnalysis,
		candidate: params.candidate,
		basenameText: params.basenameText,
		folderText: params.folderText,
	});
	const hanHighlightsByField = collectOpaqueHanHighlightsByField({
		queryAnalysis: params.queryAnalysis,
		witnesses,
	});
	const singletonHighlightsByField = collectSingletonHanHighlightsByField({
		queryAnalysis: params.queryAnalysis,
		candidate: params.candidate,
		witnesses,
	});
	const basenameBundle = buildWitnessHighlightBundle(
		realOccurrencesByField.basename,
		[
			...hanHighlightsByField.basename,
			...singletonHighlightsByField.basename,
		],
	);
	const folderBundle = buildWitnessHighlightBundle(
		realOccurrencesByField.folder,
		[
			...hanHighlightsByField.folder,
			...singletonHighlightsByField.folder,
		],
	);
	return {
		basenameHighlightRanges: mergeHighlightRanges(
			basenameBundle.strong.map(toHighlightRange),
		),
		basenameWeakHighlightRanges: mergeHighlightRanges(
			basenameBundle.weak.map(toHighlightRange),
		),
		folderHighlightRanges: mergeHighlightRanges(
			folderBundle.strong.map(toHighlightRange),
		),
		folderWeakHighlightRanges: mergeHighlightRanges(
			folderBundle.weak.map(toHighlightRange),
		),
	};
}

function collectMetadataWitnesses(
	basenameText: string,
	folderText: string,
): MetadataWitness[] {
	const witnesses: MetadataWitness[] = [];
	if (basenameText.length > 0) {
		witnesses.push({
			field: "basename",
			start: 0,
			end: basenameText.length,
			text: basenameText,
			order: 0,
		});
	}
	let order = 1;
	for (const segment of splitPathSegments(folderText)) {
		witnesses.push({
			field: "folder",
			start: segment.start,
			end: segment.end,
			text: folderText.slice(segment.start, segment.end),
			order,
		});
		order += 1;
	}
	return witnesses;
}

function collectRealMetadataOccurrencesByField(params: Readonly<{
	queryAnalysis: V3QueryAnalysis;
	candidate: EvidencePackingProfile;
	basenameText: string;
	folderText: string;
}>): Readonly<{
	basename: readonly MetadataHighlightOccurrence[];
	folder: readonly MetadataHighlightOccurrence[];
}> {
	const basenameOccurrences = collectRealizedFamilyOccurrencesInText({
		text: params.basenameText,
		queryAnalysis: params.queryAnalysis,
		realizedFamilies: params.candidate.realizedFamilies,
		includeFamily: (family) =>
			family.identityMetadataSource === "basename" ||
			(family.identityMetadataSource == null && family.matchKind !== "opaque_exact"),
	}).map<MetadataHighlightOccurrence>((occurrence) => ({
		kind: occurrence.matchKind === "fuzzy" ? "fuzzy" : "real_exact",
		start: occurrence.start,
		end: occurrence.end,
		queryUnitIndex: occurrence.queryUnitIndex,
		surfaceGroupIndex: occurrence.surfaceGroupIndex,
	}));
	const folderOccurrences = collectRealizedFamilyOccurrencesInText({
		text: params.folderText,
		queryAnalysis: params.queryAnalysis,
		realizedFamilies: params.candidate.realizedFamilies,
		includeFamily: (family) =>
			family.routeMetadataSource === "folder" ||
			(family.routeMetadataSource == null && family.matchKind !== "opaque_exact"),
	}).map<MetadataHighlightOccurrence>((occurrence) => ({
		kind: occurrence.matchKind === "fuzzy" ? "fuzzy" : "real_exact",
		start: occurrence.start,
		end: occurrence.end,
		queryUnitIndex: occurrence.queryUnitIndex,
		surfaceGroupIndex: occurrence.surfaceGroupIndex,
	}));
	return {
		basename: basenameOccurrences,
		folder: folderOccurrences,
	};
}

function collectOpaqueHanHighlightsByField(params: Readonly<{
	queryAnalysis: V3QueryAnalysis;
	witnesses: readonly MetadataWitness[];
}>): Readonly<{
	basename: readonly MetadataHighlightOccurrence[];
	folder: readonly MetadataHighlightOccurrence[];
}> {
	const outByField = {
		basename: [] as MetadataHighlightOccurrence[],
		folder: [] as MetadataHighlightOccurrence[],
	};
	for (const surfaceGroup of params.queryAnalysis.surfaceGroups) {
		if (
			surfaceGroup.kind !== "han" ||
			((surfaceGroup.queryResidualUniqueBigrams ?? []).length === 0 &&
				collectRealHanTermsForSurfaceGroup(surfaceGroup).length === 0)
		) {
			continue;
		}
		const bestWitness = chooseBestMetadataWitnessForSurfaceGroup(
			surfaceGroup,
			params.witnesses,
		);
		if (bestWitness == null) {
			continue;
		}
		const fieldOccurrences =
			outByField[bestWitness.witness.field as keyof typeof outByField];
		fieldOccurrences.push(
			...bestWitness.realOccurrences,
			...(bestWitness.confirmedSurfaceOccurrences.length > 0
				? bestWitness.confirmedSurfaceOccurrences
				: bestWitness.opaqueBigramOccurrences),
		);
	}
	return {
		basename: dedupeMetadataOccurrences(outByField.basename),
		folder: dedupeMetadataOccurrences(outByField.folder),
	};
}

function collectSingletonHanHighlightsByField(params: Readonly<{
	queryAnalysis: V3QueryAnalysis;
	candidate: EvidencePackingProfile;
	witnesses: readonly MetadataWitness[];
}>): Readonly<{
	basename: readonly MetadataHighlightOccurrence[];
	folder: readonly MetadataHighlightOccurrence[];
}> {
	const outByField = {
		basename: [] as MetadataHighlightOccurrence[],
		folder: [] as MetadataHighlightOccurrence[],
	};
	const singletonHanCompletion = params.candidate.singletonHanCompletion;
	const singletonHanChar =
		singletonHanCompletion?.matched && singletonHanCompletion.singletonHanChar != null
			? singletonHanCompletion.singletonHanChar
			: params.queryAnalysis.querySingletonHanRecallEligible
				? params.queryAnalysis.querySingletonHanChar
				: null;
	const singletonHanSurfaceGroupIndex =
		singletonHanCompletion?.matched
			? singletonHanCompletion.singletonHanSurfaceGroupIndex
			: null;
	if (
		singletonHanChar == null
	) {
		return outByField;
	}
	for (const witness of params.witnesses) {
		for (const charOffset of collectTextOffsets(
			witness.text,
			singletonHanChar,
		)) {
			outByField[witness.field].push({
				kind: "singleton_han",
				start: witness.start + charOffset,
				end:
					witness.start +
					charOffset +
					singletonHanChar.length,
				queryUnitIndex: null,
				surfaceGroupIndex: singletonHanSurfaceGroupIndex,
			});
		}
	}
	return {
		basename: dedupeMetadataOccurrences(outByField.basename),
		folder: dedupeMetadataOccurrences(outByField.folder),
	};
}

function chooseBestMetadataWitnessForSurfaceGroup(
	surfaceGroup: V3QuerySurfaceGroup,
	witnesses: readonly MetadataWitness[],
): SurfaceWitnessCandidate | null {
	const candidates = witnesses
		.map((witness) => buildSurfaceWitnessCandidate(surfaceGroup, witness))
		.filter(
			(candidate): candidate is SurfaceWitnessCandidate =>
				candidate != null &&
				(candidate.realOccurrences.length > 0 ||
					candidate.opaqueBigramOccurrences.length > 0 ||
					candidate.confirmedSurfaceOccurrences.length > 0),
		)
		.sort(compareSurfaceWitnessCandidates);
	return candidates[0] ?? null;
}

function buildSurfaceWitnessCandidate(
	surfaceGroup: V3QuerySurfaceGroup,
	witness: MetadataWitness,
): SurfaceWitnessCandidate | null {
	const opaqueBigramOccurrences = collectOpaqueBigramOccurrencesInText({
		text: witness.text,
		surfaceGroupIndex: surfaceGroup.index,
		rescueBigrams: surfaceGroup.queryResidualUniqueBigrams,
	}).map<MetadataHighlightOccurrence>((occurrence) => ({
		kind: "opaque_bigram",
		start: witness.start + occurrence.start,
		end: witness.start + occurrence.end,
		queryUnitIndex: null,
		surfaceGroupIndex: occurrence.surfaceGroupIndex,
	}));
	const realOccurrences = collectRealHanSurfaceOccurrencesInWitness(
		surfaceGroup,
		witness,
	);
	const supportingRanges: PrimitiveTextOccurrence[] = [
		...realOccurrences.map((occurrence) => ({
			start: occurrence.start - witness.start,
			end: occurrence.end - witness.start,
			matchedText: witness.text.slice(
				occurrence.start - witness.start,
				occurrence.end - witness.start,
			),
		})),
		...opaqueBigramOccurrences.map((occurrence) => ({
			start: occurrence.start - witness.start,
			end: occurrence.end - witness.start,
			matchedText: witness.text.slice(
				occurrence.start - witness.start,
				occurrence.end - witness.start,
			),
		})),
	];
	const confirmedSurfaceOccurrences = resolveConfirmedSurfaceSpans({
		text: witness.text,
		surfaceGroup,
		supportingRanges,
	}).map<MetadataHighlightOccurrence>((occurrence) => ({
		kind: "confirmed_surface",
		start: witness.start + occurrence.start,
		end: witness.start + occurrence.end,
		queryUnitIndex: null,
		surfaceGroupIndex: occurrence.surfaceGroupIndex,
	}));
	return {
		witness,
		realOccurrences: dedupeMetadataOccurrences(realOccurrences),
		opaqueBigramOccurrences: dedupeMetadataOccurrences(opaqueBigramOccurrences),
		confirmedSurfaceOccurrences: dedupeMetadataOccurrences(
			confirmedSurfaceOccurrences,
		),
	};
}

function collectRealHanSurfaceOccurrencesInWitness(
	surfaceGroup: V3QuerySurfaceGroup,
	witness: MetadataWitness,
): MetadataHighlightOccurrence[] {
	const out: MetadataHighlightOccurrence[] = [];
	for (const realTerm of collectRealHanTermsForSurfaceGroup(surfaceGroup)) {
		for (const occurrence of collectRealizedFamilyOccurrencesInText({
			text: witness.text,
			queryAnalysis: {
				queryText: surfaceGroup.text,
				normalizedQueryText: surfaceGroup.text,
				querySingletonHanChar: null,
				querySingletonHanCodePoint: null,
				querySingletonHanRecallEligible: false,
				surfaceGroups: [surfaceGroup],
				primaryUnits: [
					{
						index: 0,
						text: realTerm,
						source: "han_tokenizer_real",
						surfaceGroupIndex: surfaceGroup.index,
					},
				],
				hanBackstopGroups: [],
				surfaceCoverageShapeKey: "h",
			},
			realizedFamilies: [
				{
					queryUnitIndex: 0,
					queryUnitText: realTerm,
					querySurfaceGroupIndex: surfaceGroup.index,
					familyId: 0,
					familyText: realTerm,
					matchKind: "exact",
					editDistance: 0,
					identityMetadataSource: "basename",
					routeMetadataSource: "folder",
					metadataPackingSource: "none",
					bodyPrefixSupportKind: "none",
					inIdentity: false,
					inRoute: false,
					inHeading: false,
					inBestBodyWindow: false,
					inBodyResidue: false,
				},
			],
		})) {
			out.push({
				kind: "real_exact",
				start: witness.start + occurrence.start,
				end: witness.start + occurrence.end,
				queryUnitIndex: occurrence.queryUnitIndex,
				surfaceGroupIndex: surfaceGroup.index,
			});
		}
	}
	return dedupeMetadataOccurrences(out);
}

function collectRealHanTermsForSurfaceGroup(
	surfaceGroup: V3QuerySurfaceGroup,
): string[] {
	const coveredTerms: string[] = [];
	const chars = Array.from(surfaceGroup.text);
	const coveredCharMask = surfaceGroup.coveredCharMask ?? [];
	let start = -1;
	for (let index = 0; index < chars.length; index += 1) {
		if (coveredCharMask[index] === true) {
			if (start < 0) {
				start = index;
			}
			continue;
		}
		if (start >= 0) {
			const text = chars.slice(start, index).join("");
			if (Array.from(text).length >= 2) {
				coveredTerms.push(text);
			}
			start = -1;
		}
	}
	if (start >= 0) {
		const text = chars.slice(start).join("");
		if (Array.from(text).length >= 2) {
			coveredTerms.push(text);
		}
	}
	return [...new Set(coveredTerms)];
}

function compareSurfaceWitnessCandidates(
	left: SurfaceWitnessCandidate,
	right: SurfaceWitnessCandidate,
): number {
	if (
		left.confirmedSurfaceOccurrences.length !==
		right.confirmedSurfaceOccurrences.length
	) {
		return (
			right.confirmedSurfaceOccurrences.length -
			left.confirmedSurfaceOccurrences.length
		);
	}
	if (left.realOccurrences.length !== right.realOccurrences.length) {
		return right.realOccurrences.length - left.realOccurrences.length;
	}
	if (
		left.opaqueBigramOccurrences.length !== right.opaqueBigramOccurrences.length
	) {
		return (
			right.opaqueBigramOccurrences.length -
			left.opaqueBigramOccurrences.length
		);
	}
	if (left.witness.field !== right.witness.field) {
		return left.witness.field === "basename" ? -1 : 1;
	}
	return left.witness.order - right.witness.order;
}

function buildWitnessHighlightBundle(
	realOccurrences: readonly MetadataHighlightOccurrence[],
	hanOccurrences: readonly MetadataHighlightOccurrence[],
): WitnessHighlightBundle {
	const confirmedSurfaceGroups = new Set<number>(
		hanOccurrences
			.filter((occurrence) => occurrence.kind === "confirmed_surface")
			.map((occurrence) => occurrence.surfaceGroupIndex)
			.filter((value): value is number => value != null),
	);
	const strong = dedupeMetadataOccurrences(
		[
			...realOccurrences.filter(
				(occurrence) =>
					occurrence.kind !== "fuzzy" &&
					!(
						occurrence.surfaceGroupIndex != null &&
						confirmedSurfaceGroups.has(occurrence.surfaceGroupIndex)
					),
			),
			...hanOccurrences,
		].sort(compareMetadataOccurrenceOrder),
	);
	const weak = dedupeMetadataOccurrences(
		realOccurrences
			.filter((occurrence) => occurrence.kind === "fuzzy")
			.filter(
				(occurrence) =>
					!strong.some((strongOccurrence) =>
						rangesOverlap(
							strongOccurrence.start,
							strongOccurrence.end,
							occurrence.start,
							occurrence.end,
						),
					),
			),
	);
	return { strong, weak };
}

function splitPathSegments(text: string): Array<{ start: number; end: number }> {
	const segments: Array<{ start: number; end: number }> = [];
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

function dedupeMetadataOccurrences(
	occurrences: readonly MetadataHighlightOccurrence[],
): MetadataHighlightOccurrence[] {
	const deduped = new Map<string, MetadataHighlightOccurrence>();
	for (const occurrence of occurrences) {
		const key = [
			occurrence.kind,
			occurrence.queryUnitIndex ?? -1,
			occurrence.surfaceGroupIndex ?? -1,
			occurrence.start,
			occurrence.end,
		].join(":");
		deduped.set(key, occurrence);
	}
	return [...deduped.values()].sort(compareMetadataOccurrenceOrder);
}

function compareMetadataOccurrenceOrder(
	left: MetadataHighlightOccurrence,
	right: MetadataHighlightOccurrence,
): number {
	if (left.start !== right.start) {
		return left.start - right.start;
	}
	if (left.end !== right.end) {
		return left.end - right.end;
	}
	return left.kind.localeCompare(right.kind);
}

function mergeHighlightRanges(
	ranges: readonly HighlightRange[],
): HighlightRange[] {
	if (ranges.length <= 1) {
		return ranges.map((range) => ({ ...range }));
	}
	const sorted = [...ranges].sort(
		(left, right) => left.start - right.start || left.end - right.end,
	);
	const merged: HighlightRange[] = [{ ...sorted[0] }];
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

function toHighlightRange(
	occurrence: MetadataHighlightOccurrence,
): HighlightRange {
	return {
		start: occurrence.start,
		end: occurrence.end,
	};
}

function collectTextOffsets(text: string, target: string): number[] {
	const offsets: number[] = [];
	let searchStart = 0;
	while (searchStart <= text.length - target.length) {
		const matchIndex = text.indexOf(target, searchStart);
		if (matchIndex < 0) {
			break;
		}
		offsets.push(matchIndex);
		searchStart = matchIndex + 1;
	}
	return offsets;
}
