import { buildCoverageLexicalFamilies } from "./coverage-lexical-families";
import { extractHanBigrams } from "./coverage-lexical-cjk";
import type {
	CoverageLexicalFamilyProbe,
	CoverageLexicalPlanExplain,
	CoverageLexicalPlanFamilyReason,
	CoverageLexicalQueryKind,
	CoverageLexicalQuerySpan,
	CoverageLexicalQuerySpanKind,
	CoverageLexicalPlan,
	CoverageLexicalResourceHints,
} from "./coverage-lexical-types";

const METADATA_HINT_REGEX = /[\\/]|(?:^|\s)(?:tag|path|title|folder):/iu;
const TITLE_HINT_TERM_REGEX =
	/^(?:guide|playbook|runbook|checklist|roadmap|faq|matrix|index|note|notes|template|review|postmortem|retrospective|rollout)$/u;
const PATHISH_TERM_REGEX =
	/^(?:tech-(?:en|zh)|pkm-(?:en|zh)|docs|content|concepts|tasks|plugins|releases|archive|projects|guides|ops|daily)$/u;
const ASCII_TERM_REGEX = /^[a-z0-9_-]+$/u;
const HAN_REGEX = /\p{Script=Han}/u;
const METADATA_INTENT_SEGMENT_REGEX =
	/(?:^|[\s:])(?:title|path|folder|tag|alias|heading|basename|file|doc|docs|page|frontmatter)(?:$|[\s:])/iu;
const TITLE_PATH_SEGMENT_REGEX =
	/(?:guide|playbook|runbook|checklist|roadmap|faq|index|page|pages|catalog|release|plugin|plugins|docs|doc|configmap|secret|namespace|ingress)/iu;
const FILLER_SEGMENT_REGEX =
	/(?:callout|nested list|checklist table|frontmatter|table|heading|code block|wiki link|alias migration|where|which|written|mentioned|note|notes)/iu;
const RAW_QUERY_SEGMENT_REGEX = /[\p{Script=Han}]+|[a-z0-9._/-]+/giu;
const QUESTION_LEAD_TERM_REGEX = /^(?:which|what|where|how|who|when)$/u;
const METADATA_CONTEXT_TERM_REGEX =
	/^(?:page|pages|note|notes|file|files|doc|docs|guide|runbook|playbook|checklist|matrix|faq|roadmap|catalog|index)$/u;
const BODY_GLUE_TERM_REGEX =
	/^(?:which|what|where|how|who|when|to|for|in|on|with|about|before|after|still|through|check|checks|checking|step|steps|wrote|written|mentioned|mention)$/u;
const MEMORY_WRAPPER_PHRASE_REGEX =
	/^(?:where we wrote|where .* note|which .* page|which .* note|what .* page|what .* note|looking for|look for|find the note|find that note|remember .* note|i remember|我记得|想找|在哪个 note 里)/u;
const METADATA_WRAPPER_PHRASE_REGEX =
	/\b(?:page|note|file|doc|docs|guide|runbook|playbook|checklist|matrix|faq|roadmap|catalog|index)\b/u;

type CoverageLexicalPlannerFamilyEvidence = {
	familyIndex: number;
	spanKinds: CoverageLexicalQuerySpanKind[];
	reasons: string[];
	metadataStructuredSignal: number;
	pathBasenameSignal: number;
	titleSignal: number;
	fillerScore: number;
	bodyScore: number;
};

export function buildCoverageLexicalPlan(
	queryText: string,
	queryTerms: readonly string[],
	probes: readonly CoverageLexicalFamilyProbe[] = [],
): CoverageLexicalPlan {
	const families = buildCoverageLexicalFamilies(queryTerms, probes);
	const spans = extractCoverageLexicalQuerySpans(queryText);
	const familyEvidence = buildCoverageLexicalPlannerFamilyEvidence(
		families,
		spans,
		probes,
	);
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
	const shortHanQueryShape = analyzeShortHanQueryShape(
		queryText,
		queryTerms,
	);
	const weightedAnchorMass = sumProbeFamilyWeight(anchorFamilies, probes);
	const weightedBodyMass = sumProbeFamilyWeight(bodyFamilies, probes);
	const decisiveAnchorMass = sumProbeFamilyWeightByTier(
		anchorFamilies,
		probes,
		"decisive",
	);
	const decisiveBodyMass = sumProbeFamilyWeightByTier(
		bodyFamilies,
		probes,
		"decisive",
	);
	const supportAnchorMass = sumProbeFamilyWeightByTier(
		anchorFamilies,
		probes,
		"support",
	);
	const supportBodyMass = sumProbeFamilyWeightByTier(
		bodyFamilies,
		probes,
		"support",
	);
	const resourceHints = computeCoverageLexicalResourceHints({
		activeFamilies,
		anchorFamilies,
		bodyFamilies,
		coreBodyFamilies,
		noiseFamilies,
		familyEvidence,
		spans,
		shortQueryOverlay,
		hasMetadataHint,
		hasPathShapeHint,
		hasTitleShapeHint,
		hasMixedScriptHint,
		hasPureHanMultiTermQuery: shortHanQueryShape.isPureHanMultiTerm,
		hasShortHanFallbackBigramExpansion:
			shortHanQueryShape.isFallbackBigramExpansion,
		probes,
		weightedAnchorMass,
		weightedBodyMass,
		decisiveAnchorMass,
		decisiveBodyMass,
		supportAnchorMass,
		supportBodyMass,
	});
	const {
		queryKind,
		queryKindReasons,
	} = selectQueryKind({
		activeFamilies,
		anchorFamilies,
		bodyFamilies,
		coreBodyFamilies,
		noiseFamilies,
		familyEvidence,
		spans,
		shortQueryOverlay,
		hasMetadataHint,
		hasPathShapeHint,
		hasTitleShapeHint,
		hasMixedScriptHint,
		hasPureHanMultiTermQuery: shortHanQueryShape.isPureHanMultiTerm,
		hasShortHanFallbackBigramExpansion:
			shortHanQueryShape.isFallbackBigramExpansion,
		probes,
	});
	const hardAnchorFamilies = selectHardAnchorFamilies(
		resourceHints,
		activeFamilies,
		familyEvidence,
		probes,
		shortQueryOverlay,
	);
	const decisiveBodyFamilies = selectDecisiveBodyFamilies(
		resourceHints,
		coreBodyFamilies,
		hardAnchorFamilies,
		familyEvidence,
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
		familyEvidence,
		probes,
	);
	const weightedOptionalMass = sumProbeFamilyWeight(optionalFamilies, probes);
	const relaxedMinimumMatchCount = computeRelaxedMinimumMatchCount(
		resourceHints,
		decisiveBodyFamilies.length,
		supportBodyFamilies.length,
	);
	const route = selectRoute(
		{
			resourceHints,
			hardAnchorFamilies,
			bodyFamilies,
			hasShortHanFallbackBigramExpansion:
				shortHanQueryShape.isFallbackBigramExpansion,
		},
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
		probes,
		weightedAnchorMass,
		weightedBodyMass,
		weightedOptionalMass,
		decisiveAnchorMass,
		decisiveBodyMass,
		supportAnchorMass,
		supportBodyMass,
		resourceHints,
		explain: buildPlanExplain(
			queryKind,
			route,
			spans,
			families,
			hardAnchorFamilies,
			decisiveBodyFamilies,
			supportBodyFamilies,
			optionalFamilies,
			noiseFamilies,
			bridgeFamilies,
			familyEvidence,
			queryKindReasons,
		),
	};
}

function selectRoute(input: {
	resourceHints: CoverageLexicalResourceHints;
	hardAnchorFamilies: ReadonlyArray<CoverageLexicalPlan["families"][number]>;
	bodyFamilies: ReadonlyArray<CoverageLexicalPlan["families"][number]>;
	hasShortHanFallbackBigramExpansion: boolean;
}): CoverageLexicalPlan["route"] {
	const metadataBudget =
		input.resourceHints.metadataBudget +
		(input.hasShortHanFallbackBigramExpansion &&
		input.hardAnchorFamilies.length > 0 &&
		input.bodyFamilies.length > 0
			? 0.1
			: 0);
	const hasHybridShape =
		input.hardAnchorFamilies.length > 0 && input.bodyFamilies.length > 0;
	const metadataLead =
		metadataBudget -
		Math.max(
			input.resourceHints.hybridBudget,
			input.resourceHints.bodyBudget,
		);
	const hybridMetadataLeadThreshold = input.hasShortHanFallbackBigramExpansion
		? 0.18
		: 0.3;
	if (
		hasHybridShape &&
		!input.hasShortHanFallbackBigramExpansion &&
		input.resourceHints.hybridBudget >= 0.7
	) {
		return "body-with-anchor";
	}
	if (!hasHybridShape && metadataBudget >= input.resourceHints.bodyBudget) {
		return "metadata-first";
	}
	if (hasHybridShape && metadataLead >= hybridMetadataLeadThreshold) {
		return "metadata-first";
	}
	if (hasHybridShape) {
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
	familyEvidence: Map<number, CoverageLexicalPlannerFamilyEvidence>;
	spans: CoverageLexicalQuerySpan[];
	shortQueryOverlay: boolean;
	hasMetadataHint: boolean;
	hasPathShapeHint: boolean;
	hasTitleShapeHint: boolean;
	hasMixedScriptHint: boolean;
	hasPureHanMultiTermQuery: boolean;
	hasShortHanFallbackBigramExpansion: boolean;
	probes: readonly CoverageLexicalFamilyProbe[];
}): {
	queryKind: CoverageLexicalQueryKind;
	queryKindReasons: string[];
} {
	const {
		activeFamilies,
		anchorFamilies,
		bodyFamilies,
		coreBodyFamilies,
		noiseFamilies,
		familyEvidence,
		spans,
		shortQueryOverlay,
		hasMetadataHint,
		hasPathShapeHint,
		hasTitleShapeHint,
		hasMixedScriptHint,
		hasPureHanMultiTermQuery,
		hasShortHanFallbackBigramExpansion,
		probes,
	} = input;
	const reasons: string[] = [];
	const softOrNoiseCount =
		activeFamilies.filter((family) => family.strength === "soft").length +
		noiseFamilies.length;
	const metadataDominantAnchorMass = sumProbeFamilyWeight(
		anchorFamilies.filter((family) => isMetadataDominantAnchor(family, probes)),
		probes,
	);
	const structuredAnchorMass = sumProbeFamilyWeight(
		activeFamilies.filter((family) =>
			isPlannerAnchorCandidate(family, familyEvidence, probes, shortQueryOverlay),
		),
		probes,
	);
	const meaningfulAnchorMass = sumMeaningfulProbeFamilyWeight(anchorFamilies, probes);
	const meaningfulBodyMass = sumMeaningfulProbeFamilyWeight(bodyFamilies, probes);
	const decisiveAnchorMass = sumProbeFamilyWeightByTier(
		anchorFamilies,
		probes,
		"decisive",
	);
	const decisiveBodyMass = sumProbeFamilyWeightByTier(
		bodyFamilies,
		probes,
		"decisive",
	);
	const titlePathSpanCount = spans.filter((span) => span.kind === "title_path").length;
	const metadataIntentSpanCount = spans.filter(
		(span) => span.kind === "metadata_intent",
	).length;
	const fillerSpanCount = spans.filter((span) => span.kind === "filler").length;
	const hasStrongMetadataIntent =
		hasMetadataHint ||
		metadataIntentSpanCount > 0 ||
		activeFamilies.some((family) =>
			familyEvidence.get(family.index)?.spanKinds.includes("metadata_intent"),
		);
	const suppressPureHanShortMetadataOnly =
		shortQueryOverlay &&
		hasPureHanMultiTermQuery &&
		!hasShortHanFallbackBigramExpansion &&
		bodyFamilies.length > 0 &&
		!hasStrongMetadataIntent &&
		!hasPathShapeHint &&
		!hasTitleShapeHint &&
		titlePathSpanCount === 0 &&
		meaningfulBodyMass >= Math.min(0.45, meaningfulAnchorMass * 0.75);
	const shortQueryMetadataEvidenceScore = shortQueryOverlay
		? computeShortQueryMetadataEvidenceScore({
				structuredAnchorMass,
				decisiveAnchorMass,
				metadataDominantAnchorMass,
				hasMetadataHint,
				hasPathShapeHint,
				hasTitleShapeHint,
				titlePathSpanCount,
				metadataIntentSpanCount,
			})
		: 0;
	const longQueryMetadataDominance =
		!shortQueryOverlay &&
		hasStrongMetadataIntent &&
		meaningfulAnchorMass >= Math.max(0.9, meaningfulBodyMass * 1.15) &&
		decisiveAnchorMass >= Math.max(0.45, decisiveBodyMass);
	const shortQueryMetadataDominance =
		shortQueryOverlay &&
		!suppressPureHanShortMetadataOnly &&
		(meaningfulAnchorMass > 0 || structuredAnchorMass > 0) &&
		shortQueryMetadataEvidenceScore >=
			Math.max(
				1.05,
				meaningfulBodyMass * 0.95 + decisiveBodyMass * 0.2,
			) &&
		(structuredAnchorMass >= Math.max(0.35, meaningfulBodyMass * 0.35) ||
			decisiveAnchorMass >= Math.max(0.35, decisiveBodyMass) ||
			metadataDominantAnchorMass >= Math.max(0.35, meaningfulAnchorMass * 0.45));
	const looksMetadataOnly =
		(meaningfulAnchorMass > 0 || structuredAnchorMass > 0) &&
		(bodyFamilies.length === 0 ||
			longQueryMetadataDominance ||
			shortQueryMetadataDominance);
	if (hasMixedScriptHint && activeFamilies.some(isBridgeEligibleFamily)) {
		reasons.push("mixed-script hint with bridge-eligible families");
		return {
			queryKind: "bridge_dependent",
			queryKindReasons: reasons,
		};
	}
	if (looksMetadataOnly) {
		reasons.push("structured metadata/title/path evidence dominates query");
		return {
			queryKind: "metadata_only_anchored",
			queryKindReasons: reasons,
		};
	}
	if (
		(meaningfulAnchorMass > 0 || structuredAnchorMass > 0) &&
		meaningfulBodyMass > 0 &&
		(
			shortQueryOverlay
				? shortQueryMetadataEvidenceScore >= 0.45
				: hasMetadataHint ||
					hasPathShapeHint ||
					hasTitleShapeHint ||
					structuredAnchorMass > 0 ||
					titlePathSpanCount > 0 ||
					metadataIntentSpanCount > 0
		)
	) {
		reasons.push("structured anchor evidence coexists with body evidence");
		return {
			queryKind: "anchor_body_hybrid",
			queryKindReasons: reasons,
		};
	}
	if (
		coreBodyFamilies.length >= 2 &&
		(softOrNoiseCount > 0 || fillerSpanCount > 0) &&
		activeFamilies.length >= 4
	) {
		reasons.push("multiple body families plus filler/noise suggests relaxed memory query");
		return {
			queryKind: "memory_relaxed",
			queryKindReasons: reasons,
		};
	}
	if (anchorFamilies.length > 0 && bodyFamilies.length > 0) {
		reasons.push("existing anchor and body families imply hybrid query");
		return {
			queryKind: "anchor_body_hybrid",
			queryKindReasons: reasons,
		};
	}
	reasons.push("no reliable structured anchor evidence found");
	return {
		queryKind: "body_only_local",
		queryKindReasons: reasons,
	};
}

function selectHardAnchorFamilies(
	resourceHints: CoverageLexicalResourceHints,
	activeFamilies: ReadonlyArray<CoverageLexicalPlan["families"][number]>,
	familyEvidence: Map<number, CoverageLexicalPlannerFamilyEvidence>,
	probes: readonly CoverageLexicalFamilyProbe[],
	shortQueryOverlay: boolean,
): CoverageLexicalPlan["hardAnchorFamilies"] {
	if (
		activeFamilies.length === 0 ||
		(resourceHints.metadataBudget <= 0 && resourceHints.hybridBudget <= 0)
	) {
		return [];
	}
	const anchorFamilies = activeFamilies.filter(
		(family) =>
			family.role === "anchor" ||
			isPlannerAnchorCandidate(family, familyEvidence, probes, shortQueryOverlay),
	);
	if (anchorFamilies.length === 0) {
		return [];
	}
	const sorted = [...anchorFamilies].sort((left, right) => {
		const scoreDelta =
			computeAnchorPriority(right, probes, familyEvidence) -
			computeAnchorPriority(left, probes, familyEvidence);
		if (scoreDelta !== 0) {
			return scoreDelta;
		}
		return right.index - left.index;
	});
	const preserveHybridAnchors =
		resourceHints.hybridBudget >=
			Math.max(0.45, resourceHints.bodyBudget * 0.55) ||
		resourceHints.metadataBudget >= 0.75;
	const limit =
		resourceHints.metadataBudget >=
			Math.max(
				0.7,
				resourceHints.hybridBudget - 0.05,
				resourceHints.bodyBudget,
			)
			? shortQueryOverlay
				? anchorFamilies.length
				: Math.min(anchorFamilies.length, 3)
			: !preserveHybridAnchors &&
				  anchorFamilies.length > 2 &&
				  resourceHints.memoryBudget >=
						Math.max(
							resourceHints.metadataBudget,
							resourceHints.hybridBudget,
						)
				? 1
				: Math.min(anchorFamilies.length, 2);
	return sorted.slice(0, Math.max(1, limit)).sort((left, right) => left.index - right.index);
}

function selectDecisiveBodyFamilies(
	resourceHints: CoverageLexicalResourceHints,
	coreBodyFamilies: ReadonlyArray<CoverageLexicalPlan["families"][number]>,
	hardAnchorFamilies: ReadonlyArray<CoverageLexicalPlan["families"][number]>,
	familyEvidence: Map<number, CoverageLexicalPlannerFamilyEvidence>,
	probes: readonly CoverageLexicalFamilyProbe[],
): CoverageLexicalPlan["decisiveBodyFamilies"] {
	const suppressDecisiveBody =
		resourceHints.hybridBudget < 0.8 &&
		resourceHints.metadataBudget >=
			Math.max(
				resourceHints.hybridBudget + 0.45,
				resourceHints.bodyBudget + 0.3,
			);
	if (
		suppressDecisiveBody ||
		coreBodyFamilies.length === 0
	) {
		return [];
	}
	const hardAnchorIndices = new Set(hardAnchorFamilies.map((family) => family.index));
	const sorted = coreBodyFamilies
		.filter((family) => !hardAnchorIndices.has(family.index))
		.sort((left, right) => {
		const scoreDelta =
			computeBodyPriority(right, probes, familyEvidence) -
			computeBodyPriority(left, probes, familyEvidence);
		if (scoreDelta !== 0) {
			return scoreDelta;
		}
		return right.index - left.index;
	});
	const limit =
		resourceHints.localWitnessBudget >=
		Math.max(resourceHints.memoryBudget, resourceHints.hybridBudget)
			? coreBodyFamilies.length
			: resourceHints.memoryBudget >
				  Math.max(resourceHints.metadataBudget, resourceHints.hybridBudget)
				? Math.max(1, Math.ceil(coreBodyFamilies.length / 2))
				: Math.min(coreBodyFamilies.length, 2);
	const nonGlueSorted = sorted.filter(
		(family) => !isPlannerGlueBodyFamily(family, familyEvidence),
	);
	const decisiveTierSorted = sorted.filter(
		(family) => getProbeFamilyTier(probes[family.index]) === "decisive",
	);
	const nonGlueDecisiveSorted = decisiveTierSorted.filter(
		(family) => !isPlannerGlueBodyFamily(family, familyEvidence),
	);
	const shouldPromoteSupportBody =
		resourceHints.localWitnessBudget >= 1.1 ||
		resourceHints.memoryBudget >= 1.05 ||
		(
			resourceHints.hybridBudget >= 1 &&
			hardAnchorFamilies.length > 0
		);
	const candidatePool =
		nonGlueDecisiveSorted.length > 0
			? nonGlueDecisiveSorted
			: decisiveTierSorted.length > 0
				? decisiveTierSorted
				: shouldPromoteSupportBody
					? nonGlueSorted.length > 0
						? nonGlueSorted
						: sorted
					: [];
	return candidatePool
		.slice(0, limit)
		.sort((left, right) => left.index - right.index);
}

function selectBridgeFamilies(
	activeFamilies: ReadonlyArray<CoverageLexicalPlan["families"][number]>,
	queryTerms: readonly string[],
	hasMixedScriptHint: boolean,
	hasPathShapeHint: boolean,
	hasTitleShapeHint: boolean,
	familyEvidence: Map<number, CoverageLexicalPlannerFamilyEvidence>,
	probes: readonly CoverageLexicalFamilyProbe[],
): CoverageLexicalPlan["bridgeFamilies"] {
	const allowMetadataBridge = hasMixedScriptHint || hasPathShapeHint || hasTitleShapeHint;
	const queryHasAscii = queryTerms.some((term) => ASCII_TERM_REGEX.test(term));
	const queryHasHan = queryTerms.some((term) => HAN_REGEX.test(term));
	return activeFamilies.filter((family) => {
		if (family.role === "noise") {
			return false;
		}
		if (queryHasAscii && queryHasHan) {
			return (
				family.isMetadataCapable ||
				isBridgeEligibleFamily(family) ||
				hasStructuredMetadataBridgeSignal(family, probes, familyEvidence)
			);
		}
		if (allowMetadataBridge) {
			return (
				family.isMetadataCapable ||
				isBridgeEligibleFamily(family) ||
				hasStructuredMetadataBridgeSignal(family, probes, familyEvidence)
			);
		}
		return (
			isBridgeEligibleFamily(family) ||
			hasStructuredMetadataBridgeSignal(family, probes, familyEvidence)
		);
	});
}

function computeRelaxedMinimumMatchCount(
	resourceHints: CoverageLexicalResourceHints,
	decisiveBodyCount: number,
	supportBodyCount: number,
): number {
	if (
		resourceHints.metadataBudget >=
		Math.max(resourceHints.hybridBudget + 0.2, resourceHints.bodyBudget + 0.2)
	) {
		return 0;
	}
	const totalBodyFamilies = decisiveBodyCount + supportBodyCount;
	if (totalBodyFamilies === 0) {
		return 0;
	}
	if (
		resourceHints.hybridBudget >= resourceHints.bodyBudget ||
		resourceHints.bridgeBudget >= resourceHints.bodyBudget
	) {
		return 1;
	}
	if (resourceHints.memoryBudget >= resourceHints.localWitnessBudget) {
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

function analyzeShortHanQueryShape(
	queryText: string,
	queryTerms: readonly string[],
): {
	isPureHanMultiTerm: boolean;
	isFallbackBigramExpansion: boolean;
} {
	const normalized = queryText.trim().normalize("NFKC");
	const compact = normalized.replace(/\s+/gu, "");
	if (!/^[\p{Script=Han}]+$/u.test(compact)) {
		return {
			isPureHanMultiTerm: false,
			isFallbackBigramExpansion: false,
		};
	}
	const hanCharCount = compact.match(/\p{Script=Han}/gu)?.length ?? 0;
	if (hanCharCount < 2 || hanCharCount > 6) {
		return {
			isPureHanMultiTerm: false,
			isFallbackBigramExpansion: false,
		};
	}
	const hanTerms = queryTerms
		.map((term) => term.trim())
		.filter((term) => term.length > 0);
	if (hanTerms.length < 2) {
		return {
			isPureHanMultiTerm: false,
			isFallbackBigramExpansion: false,
		};
	}
	if (!hanTerms.every((term) => /^[\p{Script=Han}]+$/u.test(term))) {
		return {
			isPureHanMultiTerm: false,
			isFallbackBigramExpansion: false,
		};
	}
	const fallbackBigrams = new Set(extractHanBigrams(compact));
	if (fallbackBigrams.size === 0) {
		return {
			isPureHanMultiTerm: true,
			isFallbackBigramExpansion: false,
		};
	}
	const expandedTerms = hanTerms.filter((term) => term !== compact);
	return {
		isPureHanMultiTerm: true,
		isFallbackBigramExpansion:
			expandedTerms.length > 0 &&
			expandedTerms.every((term) => fallbackBigrams.has(term)),
	};
}

function computeAnchorPriority(
	family: CoverageLexicalPlan["families"][number],
	probes: readonly CoverageLexicalFamilyProbe[],
	familyEvidence: Map<number, CoverageLexicalPlannerFamilyEvidence>,
): number {
	const probe = probes[family.index];
	const evidence = familyEvidence.get(family.index);
	const weightBonus = Math.round(getProbeFamilyWeight(probe) * 10);
	const metadataBonus = Math.max(0, 8 - Math.min(8, probe?.metadataExactDocCount ?? 0));
	const dominanceBonus = isMetadataDominantAnchor(family, probes) ? 8 : 0;
	const basenameBonus = probe?.basenameExactDocCount
		? Math.max(0, 10 - Math.min(10, probe.basenameExactDocCount)) + 6
		: 0;
	const folderBonus = probe?.folderExactDocCount
		? Math.max(0, 10 - Math.min(10, probe.folderExactDocCount)) + 4
		: 0;
	const titleBonus =
		(probe?.headingExactDocCount ?? 0) > 0 || (probe?.aliasExactDocCount ?? 0) > 0
			? Math.max(
					0,
					8 -
						Math.min(
							8,
							(probe?.headingExactDocCount ?? 0) +
								(probe?.aliasExactDocCount ?? 0),
						),
				) + 2
			: 0;
	const spanBonus =
		(evidence?.spanKinds.includes("raw_shape") ? 6 : 0) +
		(evidence?.spanKinds.includes("title_path") ? 4 : 0) +
		(evidence?.spanKinds.includes("metadata_intent") ? 3 : 0);
	const shapeBonus =
		family.normalizedTerm.includes("/") ||
		family.normalizedTerm.includes("\\") ||
		family.normalizedTerm.includes(".")
			? 4
			: family.normalizedTerm.includes("-")
				? 2
				: 0;
	return (
		computeTailWeight(family.index) +
		weightBonus +
		metadataBonus +
		dominanceBonus +
		basenameBonus +
		folderBonus +
		titleBonus +
		spanBonus +
		shapeBonus
	);
}

function computeBodyPriority(
	family: CoverageLexicalPlan["families"][number],
	probes: readonly CoverageLexicalFamilyProbe[],
	familyEvidence: Map<number, CoverageLexicalPlannerFamilyEvidence>,
): number {
	const probe = probes[family.index];
	const weightBonus = Math.round(getProbeFamilyWeight(probe) * 10);
	const rarityBonus = Math.max(0, 8 - Math.min(8, probe?.bodyExactDocCount ?? 0));
	const evidence = familyEvidence.get(family.index);
	const bodyBonus =
		(evidence?.spanKinds.includes("body") ? 4 : 0) -
		Math.min(4, evidence?.fillerScore ?? 0);
	const gluePenalty = isPlannerGlueBodyFamily(family, familyEvidence) ? 8 : 0;
	return (
		computeTailWeight(family.index) +
		weightBonus +
		rarityBonus +
		bodyBonus -
		gluePenalty
	);
}

function computeTailWeight(index: number): number {
	const position = index + 1;
	return position * position;
}

function getProbeFamilyWeight(probe: CoverageLexicalFamilyProbe | undefined): number {
	return probe?.familyWeight ?? 1;
}

function getProbeFamilyTier(
	probe: CoverageLexicalFamilyProbe | undefined,
): "decisive" | "support" | "weak" {
	return probe?.familyTier ?? "support";
}

function sumProbeFamilyWeight(
	families: ReadonlyArray<CoverageLexicalPlan["families"][number]>,
	probes: readonly CoverageLexicalFamilyProbe[],
): number {
	return families.reduce(
		(total, family) => total + getProbeFamilyWeight(probes[family.index]),
		0,
	);
}

function sumMeaningfulProbeFamilyWeight(
	families: ReadonlyArray<CoverageLexicalPlan["families"][number]>,
	probes: readonly CoverageLexicalFamilyProbe[],
): number {
	return families.reduce((total, family) => {
		const probe = probes[family.index];
		if (getProbeFamilyTier(probe) === "weak") {
			return total;
		}
		return total + getProbeFamilyWeight(probe);
	}, 0);
}

function sumProbeFamilyWeightByTier(
	families: ReadonlyArray<CoverageLexicalPlan["families"][number]>,
	probes: readonly CoverageLexicalFamilyProbe[],
	tier: "decisive" | "support",
): number {
	return families.reduce((total, family) => {
		const probe = probes[family.index];
		if (getProbeFamilyTier(probe) !== tier) {
			return total;
		}
		return total + getProbeFamilyWeight(probe);
	}, 0);
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

function hasStructuredMetadataBridgeSignal(
	family: CoverageLexicalPlan["families"][number],
	probes: readonly CoverageLexicalFamilyProbe[],
	familyEvidence: Map<number, CoverageLexicalPlannerFamilyEvidence>,
): boolean {
	const probe = probes[family.index];
	const evidence = familyEvidence.get(family.index);
	if (!probe) {
		return false;
	}
	const structuredSignal =
		(probe.basenameExactDocCount ?? 0) * 2 +
		(probe.folderExactDocCount ?? 0) * 2 +
		(probe.headingExactDocCount ?? 0) +
		(probe.aliasExactDocCount ?? 0);
	const hasBridgeSpanKind =
		evidence?.spanKinds.some(
			(spanKind) =>
				spanKind === "raw_shape" ||
				spanKind === "title_path" ||
				spanKind === "metadata_intent",
		) ?? false;
	return structuredSignal > 0 && hasBridgeSpanKind;
}

function isPlannerAnchorCandidate(
	family: CoverageLexicalPlan["families"][number],
	familyEvidence: Map<number, CoverageLexicalPlannerFamilyEvidence>,
	probes: readonly CoverageLexicalFamilyProbe[],
	shortQueryOverlay: boolean,
): boolean {
	const evidence = familyEvidence.get(family.index);
	const probe = probes[family.index];
	if (!evidence || !probe) {
		return false;
	}
	if (getProbeFamilyTier(probe) === "weak") {
		return false;
	}
	const hasAnchorLikeSpan =
		evidence.spanKinds.includes("raw_shape") ||
		evidence.spanKinds.includes("title_path") ||
		evidence.spanKinds.includes("metadata_intent");
	if (!hasAnchorLikeSpan) {
		return false;
	}
	let qualifies = false;
	if (evidence.pathBasenameSignal > 0) {
		qualifies =
			evidence.pathBasenameSignal >=
			computePlannerAnchorThreshold("path", probe, shortQueryOverlay);
	}
	if (!qualifies && evidence.titleSignal > 0) {
		qualifies =
			evidence.titleSignal >=
			computePlannerAnchorThreshold("title", probe, shortQueryOverlay);
	}
	if (
		!qualifies &&
		evidence.spanKinds.includes("metadata_intent") &&
		!isPlannerGlueTerm(family.normalizedTerm) &&
		(probe.metadataExactDocCount ?? 0) > 0
	) {
		qualifies =
			(probe.metadataExactDocCount ?? 0) >=
				computePlannerAnchorThreshold("metadata", probe, shortQueryOverlay);
	}
	return qualifies;
}

function computeShortQueryMetadataEvidenceScore(input: {
	structuredAnchorMass: number;
	decisiveAnchorMass: number;
	metadataDominantAnchorMass: number;
	hasMetadataHint: boolean;
	hasPathShapeHint: boolean;
	hasTitleShapeHint: boolean;
	titlePathSpanCount: number;
	metadataIntentSpanCount: number;
}): number {
	return (
		Math.min(1.2, input.structuredAnchorMass * 0.7) +
		Math.min(1.0, input.decisiveAnchorMass * 0.8) +
		Math.min(0.8, input.metadataDominantAnchorMass * 0.7) +
		(input.hasMetadataHint ? 0.55 : 0) +
		(input.hasPathShapeHint ? 0.45 : 0) +
		(input.hasTitleShapeHint ? 0.35 : 0) +
		Math.min(0.5, input.titlePathSpanCount * 0.25) +
		Math.min(0.7, input.metadataIntentSpanCount * 0.35)
	);
}

function computeCoverageLexicalResourceHints(input: {
	activeFamilies: CoverageLexicalPlan["families"];
	anchorFamilies: CoverageLexicalPlan["families"];
	bodyFamilies: CoverageLexicalPlan["families"];
	coreBodyFamilies: CoverageLexicalPlan["families"];
	noiseFamilies: CoverageLexicalPlan["families"];
	familyEvidence: Map<number, CoverageLexicalPlannerFamilyEvidence>;
	spans: CoverageLexicalQuerySpan[];
	shortQueryOverlay: boolean;
	hasMetadataHint: boolean;
	hasPathShapeHint: boolean;
	hasTitleShapeHint: boolean;
	hasMixedScriptHint: boolean;
	hasPureHanMultiTermQuery: boolean;
	hasShortHanFallbackBigramExpansion: boolean;
	probes: readonly CoverageLexicalFamilyProbe[];
	weightedAnchorMass: number;
	weightedBodyMass: number;
	decisiveAnchorMass: number;
	decisiveBodyMass: number;
	supportAnchorMass: number;
	supportBodyMass: number;
}): CoverageLexicalResourceHints {
	const {
		activeFamilies,
		anchorFamilies,
		bodyFamilies,
		coreBodyFamilies,
		noiseFamilies,
		familyEvidence,
		spans,
		shortQueryOverlay,
		hasMetadataHint,
		hasPathShapeHint,
		hasTitleShapeHint,
		hasMixedScriptHint,
		hasPureHanMultiTermQuery,
		hasShortHanFallbackBigramExpansion,
		probes,
		weightedAnchorMass,
		weightedBodyMass,
		decisiveAnchorMass,
		decisiveBodyMass,
		supportAnchorMass,
		supportBodyMass,
	} = input;
	const softOrNoiseCount =
		activeFamilies.filter((family) => family.strength === "soft").length +
		noiseFamilies.length;
	const metadataDominantAnchorMass = sumProbeFamilyWeight(
		anchorFamilies.filter((family) => isMetadataDominantAnchor(family, probes)),
		probes,
	);
	const structuredAnchorMass = sumProbeFamilyWeight(
		activeFamilies.filter((family) =>
			isPlannerAnchorCandidate(family, familyEvidence, probes, shortQueryOverlay),
		),
		probes,
	);
	const meaningfulAnchorMass = sumMeaningfulProbeFamilyWeight(anchorFamilies, probes);
	const meaningfulBodyMass = sumMeaningfulProbeFamilyWeight(bodyFamilies, probes);
	const titlePathSpanCount = spans.filter((span) => span.kind === "title_path").length;
	const metadataIntentSpanCount = spans.filter(
		(span) => span.kind === "metadata_intent",
	).length;
	const fillerSpanCount = spans.filter((span) => span.kind === "filler").length;
	const hasStrongMetadataIntent =
		hasMetadataHint ||
		metadataIntentSpanCount > 0 ||
		activeFamilies.some((family) =>
			familyEvidence.get(family.index)?.spanKinds.includes("metadata_intent"),
		);
	const suppressPureHanShortMetadataOnly =
		shortQueryOverlay &&
		hasPureHanMultiTermQuery &&
		!hasShortHanFallbackBigramExpansion &&
		bodyFamilies.length > 0 &&
		!hasStrongMetadataIntent &&
		!hasPathShapeHint &&
		!hasTitleShapeHint &&
		titlePathSpanCount === 0 &&
		meaningfulBodyMass >= Math.min(0.45, meaningfulAnchorMass * 0.75);
	const shortQueryMetadataEvidenceScore = shortQueryOverlay
		? computeShortQueryMetadataEvidenceScore({
				structuredAnchorMass,
				decisiveAnchorMass,
				metadataDominantAnchorMass,
				hasMetadataHint,
				hasPathShapeHint,
				hasTitleShapeHint,
				titlePathSpanCount,
				metadataIntentSpanCount,
			})
		: 0;
	const metadataBudget = clampPlannerPrior(
		Math.min(1.3, shortQueryMetadataEvidenceScore * 0.55) +
			Math.min(0.45, weightedAnchorMass * 0.16) +
			Math.min(0.95, structuredAnchorMass * 0.45) +
			Math.min(0.9, decisiveAnchorMass * 0.55) +
			Math.min(0.55, supportAnchorMass * 0.25) +
			Math.min(0.75, metadataDominantAnchorMass * 0.6) +
			(hasMetadataHint ? 0.24 : 0) +
			(hasPathShapeHint ? 0.2 : 0) +
			(hasTitleShapeHint ? 0.14 : 0) +
			Math.min(0.24, titlePathSpanCount * 0.12) +
			Math.min(0.3, metadataIntentSpanCount * 0.15) -
			Math.min(0.8, meaningfulBodyMass * 0.22) -
			(suppressPureHanShortMetadataOnly ? 0.42 : 0),
	);
	const bridgeBudget = clampPlannerPrior(
		(hasMixedScriptHint ? 0.85 : 0) +
			Math.min(
				0.65,
				sumProbeFamilyWeight(
					activeFamilies.filter(isBridgeEligibleFamily),
					probes,
				) * 0.32,
			) +
			Math.min(0.35, structuredAnchorMass * 0.18),
	);
	const hybridBudget = clampPlannerPrior(
		(bodyFamilies.length > 0 && anchorFamilies.length > 0 ? 0.45 : 0) +
			Math.min(0.35, weightedAnchorMass * 0.12) +
			Math.min(0.7, Math.min(meaningfulAnchorMass, meaningfulBodyMass) * 0.5) +
			Math.min(0.35, structuredAnchorMass * 0.18) +
			Math.min(0.24, decisiveBodyMass * 0.12) -
			Math.min(0.25, Math.max(0, metadataBudget - 0.9) * 0.25),
	);
	const memoryBudget = clampPlannerPrior(
		(coreBodyFamilies.length >= 2 ? 0.45 : 0) +
			Math.min(0.7, decisiveBodyMass * 0.28) +
			Math.min(0.55, supportBodyMass * 0.22) +
			Math.min(0.4, fillerSpanCount * 0.15) +
			Math.min(0.45, softOrNoiseCount * 0.12) -
			Math.min(0.28, meaningfulAnchorMass * 0.12),
	);
	const localWitnessBudget = clampPlannerPrior(
		Math.min(0.95, weightedBodyMass * 0.32) +
			Math.min(0.9, decisiveBodyMass * 0.4) +
			Math.min(0.45, supportBodyMass * 0.2) +
			(meaningfulAnchorMass <= 0 ? 0.28 : 0) +
			(!hasStrongMetadataIntent ? 0.12 : 0) -
			Math.min(0.45, structuredAnchorMass * 0.18),
	);
	const bodyBudget = clampPlannerPrior(
		Math.max(localWitnessBudget, memoryBudget * 0.9) +
			Math.min(0.18, weightedBodyMass * 0.06) -
			Math.min(0.24, metadataBudget * 0.12),
	);
	return {
		metadataBudget,
		hybridBudget,
		bodyBudget,
		memoryBudget,
		bridgeBudget,
		localWitnessBudget,
	};
}

function clampPlannerPrior(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.max(0, Math.min(1.75, value));
}

function computePlannerAnchorThreshold(
	channel: "path" | "title" | "metadata",
	probe: CoverageLexicalFamilyProbe,
	shortQueryOverlay: boolean,
): number {
	const bodyExactDocCount = probe.bodyExactDocCount ?? 0;
	if (!shortQueryOverlay) {
		return channel === "path"
			? Math.max(1, Math.floor(bodyExactDocCount * 0.5))
			: channel === "title"
				? Math.max(1, Math.floor(bodyExactDocCount * 0.75))
				: Math.max(1, Math.floor(bodyExactDocCount * 0.4));
	}
	switch (getProbeFamilyTier(probe)) {
		case "decisive":
			return channel === "path"
				? Math.max(1, Math.floor(bodyExactDocCount * 0.35))
				: channel === "title"
					? Math.max(1, Math.floor(bodyExactDocCount * 0.5))
					: Math.max(1, Math.floor(bodyExactDocCount * 0.3));
		case "support":
			return channel === "path"
				? Math.max(1, Math.floor(bodyExactDocCount * 0.75))
				: channel === "title"
					? Math.max(1, Math.floor(bodyExactDocCount * 0.9))
					: Math.max(1, bodyExactDocCount);
		case "weak":
		default:
			return Number.POSITIVE_INFINITY;
	}
}

function extractCoverageLexicalQuerySpans(queryText: string): CoverageLexicalQuerySpan[] {
	const normalized = queryText.toLowerCase().normalize("NFKC");
	const roughSegments = normalized.split(/\s+/u).filter((segment) => segment.trim().length > 0);
	const segments = roughSegments.length > 0
		? roughSegments
		: normalized.match(RAW_QUERY_SEGMENT_REGEX) ?? [];
	const baseSpans = segments.map(classifyCoverageLexicalQuerySpan);
	const compressedPhraseSpans = extractCompressedPhraseSpans(segments);
	return dedupePlannerSpans([...baseSpans, ...compressedPhraseSpans]);
}

function classifyCoverageLexicalQuerySpan(segment: string): CoverageLexicalQuerySpan {
	if (
		segment.includes("/") ||
		segment.includes("\\") ||
		segment.includes(".") ||
		segment.includes("-")
	) {
		return {
			text: segment,
			kind: "raw_shape",
			reason: "contains raw path/basename shape markers",
		};
	}
	if (METADATA_INTENT_SEGMENT_REGEX.test(` ${segment} `) || containsChineseMetadataCue(segment)) {
		return {
			text: segment,
			kind: "metadata_intent",
			reason: "contains metadata-intent wording",
		};
	}
	if (FILLER_SEGMENT_REGEX.test(segment) || containsChineseFillerCue(segment)) {
		return {
			text: segment,
			kind: "filler",
			reason: "looks like narrative or markdown-location filler",
		};
	}
	if (TITLE_PATH_SEGMENT_REGEX.test(segment) || containsChineseTitlePathCue(segment)) {
		return {
			text: segment,
			kind: "title_path",
			reason: "contains title/path-like lexical cues",
		};
	}
	return {
		text: segment,
		kind: "body",
		reason: "default body-content segment",
	};
}

function extractCompressedPhraseSpans(
	segments: readonly string[],
): CoverageLexicalQuerySpan[] {
	const spans: CoverageLexicalQuerySpan[] = [];
	for (let start = 0; start < segments.length; start++) {
		for (
			let width = 2;
			width <= 4 && start + width <= segments.length;
			width++
		) {
			const phrase = segments.slice(start, start + width).join(" ");
			const compressed = classifyCompressedQueryPhrase(phrase);
			if (!compressed) {
				continue;
			}
			spans.push(compressed);
		}
	}
	return spans;
}

function classifyCompressedQueryPhrase(
	phrase: string,
): CoverageLexicalQuerySpan | null {
	if (MEMORY_WRAPPER_PHRASE_REGEX.test(phrase)) {
		return {
			text: phrase,
			kind: "filler",
			reason: "compressed memory/question wrapper phrase",
		};
	}
	if (
		METADATA_WRAPPER_PHRASE_REGEX.test(phrase) &&
		phrase.split(/\s+/u).some((term) => !isPlannerGlueTerm(term))
	) {
		return {
			text: phrase,
			kind: "metadata_intent",
			reason: "compressed metadata-intent phrase",
		};
	}
	if (TITLE_PATH_SEGMENT_REGEX.test(phrase)) {
		return {
			text: phrase,
			kind: "title_path",
			reason: "compressed title/path phrase",
		};
	}
	return null;
}

function containsChineseMetadataCue(segment: string): boolean {
	return /标题|路径|页面|文档|元数据|别名|标签|前言|frontmatter|别名里|标签里/u.test(segment);
}

function containsChineseFillerCue(segment: string): boolean {
	return /写在|写在哪|哪个|哪条|提示块|列表|表格|兼容说明|回滚步骤|补充备注|迁移说明|附近/u.test(segment);
}

function containsChineseTitlePathCue(segment: string): boolean {
	return /总览页面|路线图|指南|手册|回放顺序|恢复|插件|技术说明|检查点|缓存|配置|凭证/u.test(segment);
}

function buildCoverageLexicalPlannerFamilyEvidence(
	families: readonly CoverageLexicalPlan["families"][number][],
	spans: readonly CoverageLexicalQuerySpan[],
	probes: readonly CoverageLexicalFamilyProbe[],
): Map<number, CoverageLexicalPlannerFamilyEvidence> {
	const evidenceByFamily = new Map<number, CoverageLexicalPlannerFamilyEvidence>();
	for (const family of families) {
		const probe = probes[family.index];
		const matchedSpans = spans.filter((span) =>
			span.text.includes(family.normalizedTerm) ||
			family.normalizedTerm.includes(span.text),
		);
		const pathBasenameSignal =
			((probe?.basenameExactDocCount ?? 0) * 2) +
			((probe?.folderExactDocCount ?? 0) * 2);
		const titleSignal =
			(probe?.headingExactDocCount ?? 0) +
			(probe?.aliasExactDocCount ?? 0);
		const spanKinds = Array.from(
			new Set(matchedSpans.map((span) => span.kind)),
		);
		const reasons = matchedSpans.map((span) => `${span.kind}:${span.reason}`);
		if (pathBasenameSignal > 0 && !spanKinds.includes("title_path")) {
			spanKinds.push("title_path");
			reasons.push("title_path:structured basename/folder probe signal");
		}
		if (titleSignal > 0 && !spanKinds.includes("metadata_intent")) {
			spanKinds.push("metadata_intent");
			reasons.push("metadata_intent:structured heading/alias probe signal");
		}
		evidenceByFamily.set(family.index, {
			familyIndex: family.index,
			spanKinds,
			reasons,
			metadataStructuredSignal:
				pathBasenameSignal +
				titleSignal,
			pathBasenameSignal,
			titleSignal,
			fillerScore:
				matchedSpans.filter((span) => span.kind === "filler").length +
				(isPlannerGlueTerm(family.normalizedTerm) ? 1 : 0),
			bodyScore: matchedSpans.filter((span) => span.kind === "body").length,
		});
	}
	return evidenceByFamily;
}

function isPlannerGlueBodyFamily(
	family: CoverageLexicalPlan["families"][number],
	familyEvidence: Map<number, CoverageLexicalPlannerFamilyEvidence>,
): boolean {
	const evidence = familyEvidence.get(family.index);
	if (isPlannerGlueTerm(family.normalizedTerm)) {
		return true;
	}
	return (
		(evidence?.spanKinds.includes("metadata_intent") ?? false) &&
		METADATA_CONTEXT_TERM_REGEX.test(family.normalizedTerm)
	);
}

function isPlannerGlueTerm(term: string): boolean {
	return (
		QUESTION_LEAD_TERM_REGEX.test(term) ||
		METADATA_CONTEXT_TERM_REGEX.test(term) ||
		BODY_GLUE_TERM_REGEX.test(term)
	);
}

function dedupePlannerSpans(
	spans: readonly CoverageLexicalQuerySpan[],
): CoverageLexicalQuerySpan[] {
	const out: CoverageLexicalQuerySpan[] = [];
	const seen = new Set<string>();
	for (const span of spans) {
		const key = `${span.kind}:${span.text}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(span);
	}
	return out;
}

function buildPlanExplain(
	queryKind: CoverageLexicalQueryKind,
	route: CoverageLexicalPlan["route"],
	spans: readonly CoverageLexicalQuerySpan[],
	families: readonly CoverageLexicalPlan["families"][number][],
	hardAnchorFamilies: readonly CoverageLexicalPlan["families"][number][],
	decisiveBodyFamilies: readonly CoverageLexicalPlan["families"][number][],
	supportBodyFamilies: readonly CoverageLexicalPlan["families"][number][],
	optionalFamilies: readonly CoverageLexicalPlan["families"][number][],
	noiseFamilies: readonly CoverageLexicalPlan["families"][number][],
	bridgeFamilies: readonly CoverageLexicalPlan["families"][number][],
	familyEvidence: Map<number, CoverageLexicalPlannerFamilyEvidence>,
	queryKindReasons: readonly string[],
): CoverageLexicalPlanExplain {
	const familyReasons: CoverageLexicalPlanFamilyReason[] = [];
	const pushFamilyReasons = (
		bucket: CoverageLexicalPlanFamilyReason["bucket"],
		bucketFamilies: readonly CoverageLexicalPlan["families"][number][],
	): void => {
		for (const family of bucketFamilies) {
			const evidence = familyEvidence.get(family.index);
			familyReasons.push({
				familyIndex: family.index,
				term: family.normalizedTerm,
				bucket,
				reasons: evidence?.reasons ?? [`bucket=${bucket}`],
				spanKinds: evidence?.spanKinds ?? [],
			});
		}
	};
	pushFamilyReasons("hard_anchor", hardAnchorFamilies);
	pushFamilyReasons("decisive_body", decisiveBodyFamilies);
	pushFamilyReasons("support_body", supportBodyFamilies);
	pushFamilyReasons("optional", optionalFamilies);
	pushFamilyReasons("noise", noiseFamilies);
	pushFamilyReasons("bridge", bridgeFamilies);
	return {
		queryKind,
		route,
		spans: [...spans],
		familyReasons,
		queryKindReasons: [...queryKindReasons],
	};
}
