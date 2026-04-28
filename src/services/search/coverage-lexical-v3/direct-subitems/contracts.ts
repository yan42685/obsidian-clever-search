import type { FileSubItem } from "src/globals/search-types";
import type { ResidentBase } from "../layout/types";
import type { V3QueryAnalysis } from "../query/analysis";
import type { V3CandidateDocRecall } from "../recall";
import type { EvidencePackingProfile } from "../ranking";

export type V3DirectSubitemAnchorTier =
	| "none"
	| "singleton_han"
	| "real_lexical"
	| "matched_bigram"
	| "weak_opaque_bigram"
	| "opaque_bigram"
	| "confirmed_surface";

export type V3DirectSubitemAtomKind =
	| "singleton_han_atom"
	| "realized_family_atom"
	| "matched_bigram_atom"
	| "opaque_bigram_atom"
	| "confirmed_surface_atom";

export type V3DirectSubitemHighlightTier =
	| "strong"
	| "weak";

export type V3DirectSubitemEvidenceKind =
	| "singleton_han"
	| "real_exact"
	| "fuzzy"
	| "matched_bigram"
	| "opaque_bigram"
	| "confirmed_surface";

export type V3DirectSubitemResidualScopeTier =
	| "body_window"
	| "body_residue";

export type V3DirectSubitemAtom = Readonly<{
	kind: V3DirectSubitemAtomKind;
	evidenceKind: V3DirectSubitemEvidenceKind;
	queryUnitIndex: number | null;
	surfaceGroupIndex: number | null;
	blockId: number;
	start: number;
	end: number;
	matchedText: string;
	anchorTier: V3DirectSubitemAnchorTier;
	highlightTier: V3DirectSubitemHighlightTier;
	bigramText?: string | null;
}>;

export type V3DirectSubitemComponent = Readonly<{
	scopeStart: number;
	scopeEnd: number;
	scopeTier: V3DirectSubitemResidualScopeTier;
	blockIds: readonly number[];
	atoms: readonly V3DirectSubitemAtom[];
}>;

export type V3DirectSubitemCandidate = Readonly<{
	start: number;
	end: number;
	anchorOffset: number;
	component: V3DirectSubitemComponent;
	atoms: readonly V3DirectSubitemAtom[];
	displayAtoms: readonly V3DirectSubitemAtom[];
	hasAnchor: boolean;
	anchorTier: V3DirectSubitemAnchorTier;
	coveredRealPrimaryCount: number;
	confirmedSurfaceGroupCount: number;
	singletonHanCompletionTier: "none" | "tight";
	matchedOpaqueBigramCount: number;
	opaqueCoverageRatio: number;
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
	weakHighlightRanges?: Array<{ start: number; end: number }>;
}>;

export type V3DirectSubitemsBuildResult = Readonly<{
	candidates: readonly V3DirectSubitemCandidate[];
	renderPayloads: readonly V3DirectSubitemRenderPayload[];
	subItems: readonly FileSubItem[];
}>;

export type V3DirectSubitemPreparedText = Readonly<{
	text: string;
	normalizedOffsetToOriginalOffset: readonly number[];
	rawBlocks: readonly Readonly<{
		blockId: number;
		ordinal: number;
		start: number;
		end: number;
		text: string;
	}>[];
}>;

export type V3DirectSubitemsBuildParams = Readonly<{
	snapshotText: string;
	queryAnalysis: V3QueryAnalysis;
	candidate: EvidencePackingProfile;
	candidateRecall: V3CandidateDocRecall;
	residentBase: ResidentBase;
	maxSubItemResults?: number;
	candidateRangeMode?: "resident_locality" | "whole_document";
	hideWeaklyRelatedResults?: boolean;
}>;
