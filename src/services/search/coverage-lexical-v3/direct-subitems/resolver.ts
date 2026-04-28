import { FileSubItem } from "src/globals/search-types";
import type {
	V3DirectSubitemCandidate,
	V3DirectSubitemsBuildParams,
	V3DirectSubitemsBuildResult,
} from "./contracts";
import {
	buildV3DirectSubitemCandidates,
	prepareV3DirectSubitemSnapshotText,
} from "./evidence";
import { mapNormalizedRangeToOriginalRange } from "../query/text";
import { compareV3DirectSubitemCandidates } from "./ranker";
import { renderV3DirectSubitemCandidate } from "./renderer";

export function buildV3DirectSubitems(
	params: V3DirectSubitemsBuildParams,
): V3DirectSubitemsBuildResult {
	const preparedText = prepareV3DirectSubitemSnapshotText(params.snapshotText);
	const normalizedCandidates = applyWeakFilePruneMode(
		buildV3DirectSubitemCandidates({
			snapshotText: preparedText.text,
			queryAnalysis: params.queryAnalysis,
			candidate: params.candidate,
			candidateRecall: params.candidateRecall,
			residentBase: params.residentBase,
			candidateRangeMode: params.candidateRangeMode,
		})
			.filter((candidate) => candidate.hasAnchor)
			.sort(compareV3DirectSubitemCandidates),
		params,
	);
	const candidates = normalizedCandidates.map((candidate) =>
		mapDirectSubitemCandidateToOriginalOffsets(candidate, preparedText),
	);
	const limitedCandidates = candidates.slice(0, Math.max(1, params.maxSubItemResults ?? 5));
	const renderPayloads = limitedCandidates.map((candidate) =>
		renderV3DirectSubitemCandidate({
			snapshotText: params.snapshotText,
			candidate,
		}),
	);
	const subItems = limitedCandidates.map((candidate, index) => {
		const payload = renderPayloads[index];
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
		candidates,
		renderPayloads,
		subItems,
	};
}

function mapDirectSubitemCandidateToOriginalOffsets(
	candidate: V3DirectSubitemCandidate,
	preparedText: ReturnType<typeof prepareV3DirectSubitemSnapshotText>,
): V3DirectSubitemCandidate {
	const atoms = candidate.atoms.map((atom) => mapDirectSubitemAtomToOriginalOffsets(atom, preparedText));
	const displayAtoms = candidate.displayAtoms.map((atom) =>
		mapDirectSubitemAtomToOriginalOffsets(atom, preparedText),
	);
	const componentAtoms = candidate.component.atoms.map((atom) =>
		mapDirectSubitemAtomToOriginalOffsets(atom, preparedText),
	);
	const candidateRange = mapNormalizedRangeToOriginalRange(preparedText, candidate.start, candidate.end);
	const componentRange = mapNormalizedRangeToOriginalRange(
		preparedText,
		candidate.component.scopeStart,
		candidate.component.scopeEnd,
	);
	return {
		...candidate,
		start: candidateRange.start,
		end: candidateRange.end,
		anchorOffset: mapNormalizedOffsetToOriginalOffset(preparedText, candidate.anchorOffset),
		component: {
			...candidate.component,
			scopeStart: componentRange.start,
			scopeEnd: componentRange.end,
			atoms: componentAtoms,
		},
		atoms,
		displayAtoms,
	};
}

function mapDirectSubitemAtomToOriginalOffsets(
	atom: V3DirectSubitemCandidate["atoms"][number],
	preparedText: ReturnType<typeof prepareV3DirectSubitemSnapshotText>,
): V3DirectSubitemCandidate["atoms"][number] {
	const range = mapNormalizedRangeToOriginalRange(preparedText, atom.start, atom.end);
	return {
		...atom,
		start: range.start,
		end: range.end,
	};
}

function mapNormalizedOffsetToOriginalOffset(
	preparedText: ReturnType<typeof prepareV3DirectSubitemSnapshotText>,
	offset: number,
): number {
	return (
		preparedText.normalizedOffsetToOriginalOffset[offset] ??
		offset
	);
}

function applyWeakFilePruneMode(
	candidates: readonly V3DirectSubitemCandidate[],
	params: Pick<V3DirectSubitemsBuildParams, "hideWeaklyRelatedResults">,
): V3DirectSubitemCandidate[] {
	if (candidates.length <= 1 || params.hideWeaklyRelatedResults !== true) {
		return [...candidates];
	}
	const topCandidate = candidates[0];
	if (topCandidate == null) {
		return [...candidates];
	}
	const kept = candidates.filter((candidate) => hasSameAnchorGate(candidate, topCandidate));
	return kept.length > 0 ? kept : [topCandidate];
}

function hasSameAnchorGate(
	left: V3DirectSubitemCandidate,
	right: V3DirectSubitemCandidate,
): boolean {
	return (
		left.coveredRealPrimaryCount === right.coveredRealPrimaryCount &&
		left.confirmedSurfaceGroupCount === right.confirmedSurfaceGroupCount &&
		left.singletonHanCompletionTier === right.singletonHanCompletionTier &&
		left.anchorTier === right.anchorTier
	);
}
