import { buildCoverageLexicalFamilies } from "./coverage-lexical-families";
import type {
	CoverageLexicalFamilyProbe,
	CoverageLexicalQueryKind,
	CoverageLexicalPlan,
} from "./coverage-lexical-types";

const METADATA_HINT_REGEX = /[\\/]|(?:^|\s)(?:tag|path|title|folder):/iu;
const TITLE_HINT_TERM_REGEX =
	/^(?:guide|playbook|runbook|checklist|roadmap|faq|matrix|index|note|notes|template|review|postmortem|retrospective|rollout)$/u;
const PATHISH_TERM_REGEX =
	/^(?:tech-(?:en|zh)|pkm-(?:en|zh)|docs|content|concepts|tasks|plugins|releases|archive|projects|guides|ops|daily)$/u;
const ASCII_TERM_REGEX = /^[a-z0-9_-]+$/u;
const HAN_REGEX = /\p{Script=Han}/u;

export function buildCoverageLexicalPlan(
	queryText: string,
	queryTerms: readonly string[],
	probes: readonly CoverageLexicalFamilyProbe[] = [],
): CoverageLexicalPlan {
	const families = buildCoverageLexicalFamilies(queryTerms, probes);
	const noiseFamilies = families.filter((family) => family.role === "noise");
	const activeFamilies = families.filter((family) => family.role !== "noise");
	const shortQueryOverlay = activeFamilies.length <= 2;
	const anchorFamilies = activeFamilies.filter((family) => family.role === "anchor");
	const bodyFamilies = activeFamilies.filter((family) => family.role === "body");
	const coreFamilies = activeFamilies.filter((family) => family.strength === "core");
	const coreBodyFamilies = bodyFamilies.filter((family) => family.strength === "core");
	const softBodyFamilies = bodyFamilies.filter((family) => family.strength !== "core");
	const hasMetadataHint = METADATA_HINT_REGEX.test(queryText);
	const hasPathShapeHint = detectPathShapeHint(queryText, queryTerms);
	const hasTitleShapeHint = detectTitleShapeHint(queryTerms);
	const hasMixedScriptHint = detectMixedScriptHint(queryTerms);
	const queryKind = selectQueryKind({
		activeFamilies,
		anchorFamilies,
		bodyFamilies,
		coreBodyFamilies,
		noiseFamilies,
		shortQueryOverlay,
		hasMetadataHint,
		hasPathShapeHint,
		hasTitleShapeHint,
		hasMixedScriptHint,
		probes,
	});
	const hardAnchorFamilies = selectHardAnchorFamilies(
		queryKind,
		anchorFamilies,
		probes,
		shortQueryOverlay,
	);
	const decisiveBodyFamilies = selectDecisiveBodyFamilies(
		queryKind,
		coreBodyFamilies,
		probes,
	);
	const reservedFamilyIndices = new Set(
		[...hardAnchorFamilies, ...decisiveBodyFamilies].map((family) => family.index),
	);
	const supportBodyFamilies = [
		...coreBodyFamilies.filter((family) => !reservedFamilyIndices.has(family.index)),
		...softBodyFamilies.filter((family) => !reservedFamilyIndices.has(family.index)),
	];
	const supportFamilyIndices = new Set(
		supportBodyFamilies.map((family) => family.index),
	);
	const optionalFamilies = activeFamilies.filter(
		(family) =>
			!reservedFamilyIndices.has(family.index) &&
			!supportFamilyIndices.has(family.index),
	);
	const bridgeFamilies = selectBridgeFamilies(
		activeFamilies,
		queryTerms,
		hasMixedScriptHint,
		hasPathShapeHint,
		hasTitleShapeHint,
	);
	const relaxedMinimumMatchCount = computeRelaxedMinimumMatchCount(
		queryKind,
		decisiveBodyFamilies.length,
		supportBodyFamilies.length,
	);
	const route = selectRoute(
		queryKind,
		hardAnchorFamilies,
		bodyFamilies,
	);

	return {
		families,
		queryKind,
		shortQueryOverlay,
		hasMetadataHint,
		hasMixedScriptHint,
		hasPathShapeHint,
		hasTitleShapeHint,
		route,
		hardAnchorFamilies,
		decisiveBodyFamilies,
		supportBodyFamilies,
		optionalFamilies,
		noiseFamilies,
		bridgeFamilies,
		relaxedMinimumMatchCount,
		coreFamilyCount: coreFamilies.length,
		anchorFamilyCount: anchorFamilies.length,
		bodyFamilyCount: bodyFamilies.length,
	};
}

function selectRoute(
	queryKind: CoverageLexicalQueryKind,
	hardAnchorFamilies: ReadonlyArray<CoverageLexicalPlan["families"][number]>,
	bodyFamilies: ReadonlyArray<CoverageLexicalPlan["families"][number]>,
): CoverageLexicalPlan["route"] {
	if (queryKind === "metadata_only_anchored") {
		return "metadata-first";
	}
	if (hardAnchorFamilies.length > 0 && bodyFamilies.length > 0) {
		return "body-with-anchor";
	}
	return "body-first";
}

function selectQueryKind(input: {
	activeFamilies: CoverageLexicalPlan["families"];
	anchorFamilies: CoverageLexicalPlan["families"];
	bodyFamilies: CoverageLexicalPlan["families"];
	coreBodyFamilies: CoverageLexicalPlan["families"];
	noiseFamilies: CoverageLexicalPlan["families"];
	shortQueryOverlay: boolean;
	hasMetadataHint: boolean;
	hasPathShapeHint: boolean;
	hasTitleShapeHint: boolean;
	hasMixedScriptHint: boolean;
	probes: readonly CoverageLexicalFamilyProbe[];
}): CoverageLexicalQueryKind {
	const {
		activeFamilies,
		anchorFamilies,
		bodyFamilies,
		coreBodyFamilies,
		noiseFamilies,
		shortQueryOverlay,
		hasMetadataHint,
		hasPathShapeHint,
		hasTitleShapeHint,
		hasMixedScriptHint,
		probes,
	} = input;
	const softOrNoiseCount =
		activeFamilies.filter((family) => family.strength === "soft").length +
		noiseFamilies.length;
	const metadataDominantAnchorCount = anchorFamilies.filter((family) =>
		isMetadataDominantAnchor(family, probes),
	).length;
	const looksMetadataOnly =
		anchorFamilies.length > 0 &&
		(bodyFamilies.length === 0 ||
			(shortQueryOverlay &&
				(hasTitleShapeHint ||
					hasPathShapeHint ||
					hasMetadataHint ||
					metadataDominantAnchorCount >= Math.max(1, anchorFamilies.length))));
	if (hasMixedScriptHint && activeFamilies.some(isBridgeEligibleFamily)) {
		return "bridge_dependent";
	}
	if (looksMetadataOnly) {
		return "metadata_only_anchored";
	}
	if (
		anchorFamilies.length > 0 &&
		bodyFamilies.length > 0 &&
		(hasMetadataHint || hasPathShapeHint || hasTitleShapeHint)
	) {
		return "anchor_body_hybrid";
	}
	if (
		coreBodyFamilies.length >= 2 &&
		softOrNoiseCount > 0 &&
		activeFamilies.length >= 4
	) {
		return "memory_relaxed";
	}
	if (anchorFamilies.length > 0 && bodyFamilies.length > 0) {
		return "anchor_body_hybrid";
	}
	return "body_only_local";
}

function selectHardAnchorFamilies(
	queryKind: CoverageLexicalQueryKind,
	anchorFamilies: ReadonlyArray<CoverageLexicalPlan["families"][number]>,
	probes: readonly CoverageLexicalFamilyProbe[],
	shortQueryOverlay: boolean,
): CoverageLexicalPlan["hardAnchorFamilies"] {
	if (
		queryKind === "body_only_local" ||
		anchorFamilies.length === 0
	) {
		return [];
	}
	const sorted = [...anchorFamilies].sort((left, right) => {
		const scoreDelta =
			computeAnchorPriority(right, probes) - computeAnchorPriority(left, probes);
		if (scoreDelta !== 0) {
			return scoreDelta;
		}
		return right.index - left.index;
	});
	const limit =
		queryKind === "metadata_only_anchored"
			? shortQueryOverlay
				? anchorFamilies.length
				: Math.min(anchorFamilies.length, 3)
			: queryKind === "memory_relaxed"
				? 1
				: Math.min(anchorFamilies.length, 2);
	return sorted.slice(0, Math.max(1, limit)).sort((left, right) => left.index - right.index);
}

function selectDecisiveBodyFamilies(
	queryKind: CoverageLexicalQueryKind,
	coreBodyFamilies: ReadonlyArray<CoverageLexicalPlan["families"][number]>,
	probes: readonly CoverageLexicalFamilyProbe[],
): CoverageLexicalPlan["decisiveBodyFamilies"] {
	if (
		queryKind === "metadata_only_anchored" ||
		coreBodyFamilies.length === 0
	) {
		return [];
	}
	const sorted = [...coreBodyFamilies].sort((left, right) => {
		const scoreDelta =
			computeBodyPriority(right, probes) - computeBodyPriority(left, probes);
		if (scoreDelta !== 0) {
			return scoreDelta;
		}
		return right.index - left.index;
	});
	const limit =
		queryKind === "body_only_local"
			? coreBodyFamilies.length
			: queryKind === "memory_relaxed"
				? Math.max(1, Math.ceil(coreBodyFamilies.length / 2))
				: Math.min(coreBodyFamilies.length, 2);
	return sorted.slice(0, limit).sort((left, right) => left.index - right.index);
}

function selectBridgeFamilies(
	activeFamilies: ReadonlyArray<CoverageLexicalPlan["families"][number]>,
	queryTerms: readonly string[],
	hasMixedScriptHint: boolean,
	hasPathShapeHint: boolean,
	hasTitleShapeHint: boolean,
): CoverageLexicalPlan["bridgeFamilies"] {
	const allowMetadataBridge = hasMixedScriptHint || hasPathShapeHint || hasTitleShapeHint;
	const queryHasAscii = queryTerms.some((term) => ASCII_TERM_REGEX.test(term));
	const queryHasHan = queryTerms.some((term) => HAN_REGEX.test(term));
	return activeFamilies.filter((family) => {
		if (family.role === "noise") {
			return false;
		}
		if (queryHasAscii && queryHasHan) {
			return family.isMetadataCapable || isBridgeEligibleFamily(family);
		}
		if (allowMetadataBridge) {
			return family.isMetadataCapable || isBridgeEligibleFamily(family);
		}
		return isBridgeEligibleFamily(family);
	});
}

function computeRelaxedMinimumMatchCount(
	queryKind: CoverageLexicalQueryKind,
	decisiveBodyCount: number,
	supportBodyCount: number,
): number {
	if (queryKind === "metadata_only_anchored") {
		return 0;
	}
	const totalBodyFamilies = decisiveBodyCount + supportBodyCount;
	if (totalBodyFamilies === 0) {
		return 0;
	}
	if (queryKind === "anchor_body_hybrid" || queryKind === "bridge_dependent") {
		return 1;
	}
	if (queryKind === "memory_relaxed") {
		return Math.max(1, Math.min(totalBodyFamilies, Math.ceil(totalBodyFamilies * 0.5)));
	}
	return Math.max(1, Math.min(totalBodyFamilies, Math.ceil(decisiveBodyCount * 0.6)));
}

function detectPathShapeHint(queryText: string, queryTerms: readonly string[]): boolean {
	if (METADATA_HINT_REGEX.test(queryText)) {
		return true;
	}
	return queryTerms.some(
		(term) =>
			term.includes("/") ||
			term.includes("\\") ||
			term.includes(".") ||
			PATHISH_TERM_REGEX.test(term) ||
			(term.includes("-") && ASCII_TERM_REGEX.test(term)),
	);
}

function detectTitleShapeHint(queryTerms: readonly string[]): boolean {
	const significantTerms = queryTerms.filter((term) => term.length >= 3);
	if (significantTerms.length < 2) {
		return false;
	}
	return (
		TITLE_HINT_TERM_REGEX.test(significantTerms[0]) ||
		TITLE_HINT_TERM_REGEX.test(significantTerms[significantTerms.length - 1])
	);
}

function detectMixedScriptHint(queryTerms: readonly string[]): boolean {
	const hasHan = queryTerms.some((term) => HAN_REGEX.test(term));
	const hasAscii = queryTerms.some((term) => ASCII_TERM_REGEX.test(term));
	return hasHan && hasAscii;
}

function computeAnchorPriority(
	family: CoverageLexicalPlan["families"][number],
	probes: readonly CoverageLexicalFamilyProbe[],
): number {
	const probe = probes[family.index];
	const metadataBonus = Math.max(0, 8 - Math.min(8, probe?.metadataExactDocCount ?? 0));
	const dominanceBonus = isMetadataDominantAnchor(family, probes) ? 8 : 0;
	const shapeBonus =
		family.normalizedTerm.includes("/") ||
		family.normalizedTerm.includes("\\") ||
		family.normalizedTerm.includes(".")
			? 4
			: family.normalizedTerm.includes("-")
				? 2
				: 0;
	return computeTailWeight(family.index) + metadataBonus + dominanceBonus + shapeBonus;
}

function computeBodyPriority(
	family: CoverageLexicalPlan["families"][number],
	probes: readonly CoverageLexicalFamilyProbe[],
): number {
	const probe = probes[family.index];
	const rarityBonus = Math.max(0, 8 - Math.min(8, probe?.bodyExactDocCount ?? 0));
	return computeTailWeight(family.index) + rarityBonus;
}

function computeTailWeight(index: number): number {
	const position = index + 1;
	return position * position;
}

function isMetadataDominantAnchor(
	family: CoverageLexicalPlan["families"][number],
	probes: readonly CoverageLexicalFamilyProbe[],
): boolean {
	const probe = probes[family.index];
	return (
		(probe?.metadataExactDocCount ?? 0) > 0 &&
		(probe?.metadataExactDocCount ?? 0) >=
			Math.max(2, (probe?.bodyExactDocCount ?? 0) * 2)
	);
}

function isBridgeEligibleFamily(
	family: CoverageLexicalPlan["families"][number],
): boolean {
	return (
		HAN_REGEX.test(family.normalizedTerm) ||
		family.normalizedTerm.includes("-") ||
		family.normalizedTerm.includes("/") ||
		family.normalizedTerm.includes("\\") ||
		family.normalizedTerm.includes(".")
	);
}
