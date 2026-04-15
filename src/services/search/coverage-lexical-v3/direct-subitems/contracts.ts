import type { FileSubItem } from "src/globals/search-types";
import type { ResidentBase } from "../layout/types";
import type { V3QueryAnalysis } from "../query/analysis";
import type { V3CandidateDocRecall } from "../recall";
import type { EvidencePackingProfile } from "../ranking";

export type V3DirectSubitemEvidenceKind =
	| "real_exact"
	| "surface_completion"
	| "route_only";

export type V3DirectSubitemOccurrence = Readonly<{
	kind: V3DirectSubitemEvidenceKind;
	start: number;
	end: number;
	queryUnitIndex: number | null;
	surfaceGroupIndex: number | null;
	text: string;
}>;

export type V3DirectSubitemCandidate = Readonly<{
	start: number;
	end: number;
	anchorOffset: number;
	occurrences: readonly V3DirectSubitemOccurrence[];
	displayOccurrences: readonly V3DirectSubitemOccurrence[];
	coveredRealPrimaryCount: number;
	completedHanSurfaceGroupCount: number;
	preservesQueryOrder: boolean;
	windowWidth: number;
	maxAdjacentGap: number;
	totalGap: number;
}>;

export type V3DirectSubitemRenderPayload = Readonly<{
	text: string;
	html: string;
	snippetText: string;
	row: number;
	col: number;
	coreStart: number;
	coreEnd: number;
	displayStart: number;
	displayEnd: number;
	anchorOffset: number;
	highlightRanges: Array<{ start: number; end: number }>;
}>;

export type V3DirectSubitemsBuildResult = Readonly<{
	candidates: readonly V3DirectSubitemCandidate[];
	renderPayloads: readonly V3DirectSubitemRenderPayload[];
	subItems: readonly FileSubItem[];
}>;

export type V3DirectSubitemsBuildParams = Readonly<{
	snapshotText: string;
	queryAnalysis: V3QueryAnalysis;
	candidate: EvidencePackingProfile;
	candidateRecall: V3CandidateDocRecall;
	residentBase: ResidentBase;
	maxSubItemResults?: number;
	candidateRangeMode?: "resident_locality" | "whole_document";
}>;
