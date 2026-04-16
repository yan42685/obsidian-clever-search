import { FileSubItem } from "src/globals/search-types";
import type {
	V3DirectSubitemCandidate,
	V3DirectSubitemRenderPayload,
	V3DirectSubitemsBuildParams,
	V3DirectSubitemsBuildResult,
} from "./contracts";
import { buildV3DirectSubitemCandidates } from "./evidence";
import { compareV3DirectSubitemCandidates } from "./ranker";
import { renderV3DirectSubitemCandidate } from "./renderer";

export function buildV3DirectSubitems(
	params: V3DirectSubitemsBuildParams,
): V3DirectSubitemsBuildResult {
	const candidates = dedupeV3DirectSubitemCandidates(
		buildV3DirectSubitemCandidates({
			snapshotText: params.snapshotText,
			queryAnalysis: params.queryAnalysis,
			candidate: params.candidate,
			candidateRecall: params.candidateRecall,
			residentBase: params.residentBase,
			candidateRangeMode: params.candidateRangeMode,
		}).sort(compareV3DirectSubitemCandidates),
	);
	const weakDeduped = weakDedupeRenderedCandidates(
		candidates.map((candidate) => ({
			candidate,
			payload: renderV3DirectSubitemCandidate({
				snapshotText: params.snapshotText,
				candidate,
			}),
		})),
	);
	const limited = weakDeduped.slice(
		0,
		Math.max(1, params.maxSubItemResults ?? 5),
	);
	const renderPayloads = limited.map((entry) => entry.payload);
	const subItems = limited.map((entry) => {
		const candidate = entry.candidate;
		const payload = entry.payload;
		const subItem = new FileSubItem(
			payload.text,
			payload.row,
			payload.col,
			candidate.coveredRealPrimaryCount,
			payload.html,
		);
		subItem.snippetText = payload.snippetText;
		subItem.highlightRanges = payload.highlightRanges.map((range) => ({
			start: range.start,
			end: range.end,
		}));
		subItem.weakHighlightRanges = (payload.weakHighlightRanges ?? []).map(
			(range) => ({
				start: range.start,
				end: range.end,
			}),
		);
		return subItem;
	});
	return {
		candidates: limited.map((entry) => entry.candidate),
		renderPayloads,
		subItems,
	};
}

function weakDedupeRenderedCandidates(
	entries: ReadonlyArray<{
		candidate: V3DirectSubitemCandidate;
		payload: V3DirectSubitemRenderPayload;
	}>,
): Array<{
	candidate: V3DirectSubitemCandidate;
	payload: V3DirectSubitemRenderPayload;
}> {
	if (entries.length <= 1) {
		return [...entries];
	}
	const kept = [entries[0]];
	const keptHighlightSignatures = new Map<string, number[]>([
		[buildHighlightRangeSignature(entries[0].payload), [0]],
	]);
	for (let index = 1; index < entries.length; index += 1) {
		const entry = entries[index];
		const highlightSignature = buildHighlightRangeSignature(entry.payload);
		const comparableKeptIndices = keptHighlightSignatures.get(highlightSignature) ?? [];
		const isDisplayEquivalent = comparableKeptIndices.some((keptIndex) =>
			computeDisplayOverlapRatio(kept[keptIndex].payload, entry.payload) >= 0.9,
		);
		if (isDisplayEquivalent) {
			continue;
		}
		kept.push(entry);
		const nextIndices = keptHighlightSignatures.get(highlightSignature) ?? [];
		nextIndices.push(kept.length - 1);
		keptHighlightSignatures.set(highlightSignature, nextIndices);
	}
	return kept;
}

function dedupeV3DirectSubitemCandidates(
	candidates: readonly V3DirectSubitemCandidate[],
): V3DirectSubitemCandidate[] {
	const selected: V3DirectSubitemCandidate[] = [];
	for (const candidate of candidates) {
		if (
			selected.some((existing) =>
				areEquivalentV3DirectSubitemCandidates(existing, candidate),
			)
		) {
			continue;
		}
		selected.push(candidate);
	}
	return selected;
}

function areEquivalentV3DirectSubitemCandidates(
	left: V3DirectSubitemCandidate,
	right: V3DirectSubitemCandidate,
): boolean {
	if (buildCandidateTermSignature(left) !== buildCandidateTermSignature(right)) {
		return false;
	}
	if (computeRangeOverlapRatio(left, right) < 0.85) {
		return false;
	}
	return buildCandidateOccurrenceSignature(left) === buildCandidateOccurrenceSignature(right);
}

function buildCandidateTermSignature(
	candidate: V3DirectSubitemCandidate,
): string {
	const realUnitIndices = [...new Set(
		candidate.occurrences
			.filter(
				(occurrence) =>
					occurrence.kind === "real_exact" || occurrence.kind === "fuzzy",
			)
			.map((occurrence) => occurrence.queryUnitIndex)
			.filter((value): value is number => value != null),
	)].sort((left, right) => left - right);
	const surfaceGroupIndices = [...new Set(
		candidate.occurrences
			.filter((occurrence) => occurrence.kind === "surface_completion")
			.map((occurrence) => occurrence.surfaceGroupIndex)
			.filter((value): value is number => value != null),
	)].sort((left, right) => left - right);
	return `real:${realUnitIndices.join(",")}|surface:${surfaceGroupIndices.join(",")}`;
}

function buildCandidateOccurrenceSignature(
	candidate: V3DirectSubitemCandidate,
): string {
	const sourceOccurrences =
		candidate.displayOccurrences.length > 0
			? candidate.displayOccurrences
			: candidate.occurrences;
	return sourceOccurrences
		.map(
			(occurrence) =>
				`${occurrence.kind}:${occurrence.queryUnitIndex ?? -1}:${occurrence.surfaceGroupIndex ?? -1}:${occurrence.start}:${occurrence.end}`,
		)
		.join("|");
}

function computeRangeOverlapRatio(
	left: Pick<V3DirectSubitemCandidate, "start" | "end">,
	right: Pick<V3DirectSubitemCandidate, "start" | "end">,
): number {
	const overlapStart = Math.max(left.start, right.start);
	const overlapEnd = Math.min(left.end, right.end);
	if (overlapEnd <= overlapStart) {
		return 0;
	}
	const overlap = overlapEnd - overlapStart;
	const base = Math.max(
		1,
		Math.min(left.end - left.start, right.end - right.start),
	);
	return overlap / base;
}

function computeDisplayOverlapRatio(
	left: Pick<V3DirectSubitemRenderPayload, "displayStart" | "displayEnd">,
	right: Pick<V3DirectSubitemRenderPayload, "displayStart" | "displayEnd">,
): number {
	const overlapStart = Math.max(left.displayStart, right.displayStart);
	const overlapEnd = Math.min(left.displayEnd, right.displayEnd);
	if (overlapEnd <= overlapStart) {
		return 0;
	}
	const overlap = overlapEnd - overlapStart;
	const base = Math.max(
		1,
		Math.min(
			left.displayEnd - left.displayStart,
			right.displayEnd - right.displayStart,
		),
	);
	return overlap / base;
}

function buildHighlightRangeSignature(
	payload: Pick<V3DirectSubitemRenderPayload, "highlightRanges" | "weakHighlightRanges">,
): string {
	return [
		...payload.highlightRanges.map((range) => `s:${range.start}:${range.end}`),
		...(payload.weakHighlightRanges ?? []).map(
			(range) => `w:${range.start}:${range.end}`,
		),
	]
		.join("|");
}
