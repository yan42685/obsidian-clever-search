export const HAN_BODY_LOCALITY_MAX_ADJACENT_GAP = 15;
export const HAN_BODY_LOCALITY_MAX_HEAD_TAIL_SPAN = 160;
export const HAN_BODY_LOCALITY_MAX_BLOCK_DISTANCE = 1;

export const HAN_RESCUE_BIGRAM_SUPPORT_WEIGHT = 0.7;
export const HAN_RESCUE_REAL_ANCHOR_SUPPORT_WEIGHT = 1.0;
export const HAN_RESCUE_ENDPOINT_BONUS = 0.2;

export const HAN_RESCUE_ORDER_PENALTY = 0.15;
export const HAN_RESCUE_NON_ENDPOINT_ONLY_PENALTY = 0.1;

export const HAN_METADATA_DISTANCE_PENALTY_PER_CHAR = 0.015;
export const HAN_METADATA_MAX_DISTANCE_PENALTY = 0.25;

export type HanRescueContext = "body" | "metadata";
export type HanRescueStrength = "none" | "weak" | "strong";
export type HanRescueWitnessKind =
	| "identity"
	| "route"
	| "heading"
	| "body"
	| null;

export type PositionedHanRescueAtom = Readonly<{
	surfaceGroupIndex: number;
	kind: "real_anchor" | "rescue_bigram";
	text: string;
	queryCharStart: number;
	queryCharEnd: number;
	blockId: number;
	start: number;
	end: number;
}>;

export type HanRescueAssessment = Readonly<{
	surfaceGroupIndex: number;
	context: HanRescueContext;
	rescueMode: "residual_only" | "whole_group_when_real_miss";
	strength: HanRescueStrength;
	matchedBigramCount: number;
	matchedRealAnchorCount: number;
	coversStartAnchor: boolean;
	coversEndAnchor: boolean;
	coversEndpoints: boolean;
	preservesSurfaceOrder: boolean;
	rankingScore: number;
	approxMaxAdjacentGap: number | null;
	approxHeadTailSpan: number | null;
	blockIds: readonly number[];
	witnessKind: HanRescueWitnessKind;
}>;
