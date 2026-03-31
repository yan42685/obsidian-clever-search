import { buildCoverageLexicalFamilies } from "./coverage-lexical-families";
import type {
	CoverageLexicalFamilyProbe,
	CoverageLexicalPlanExplain,
	CoverageLexicalPlanFamilyReason,
	CoverageLexicalQueryKind,
	CoverageLexicalQuerySpan,
	CoverageLexicalQuerySpanKind,
	CoverageLexicalPlan,
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
		probes,
	});
	const hardAnchorFamilies = selectHardAnchorFamilies(
		queryKind,
		activeFamilies,
		familyEvidence,
		probes,
		shortQueryOverlay,
	);
	const decisiveBodyFamilies = selectDecisiveBodyFamilies(
		queryKind,
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
		explain: buildPlanExplain(
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
	familyEvidence: Map<number, CoverageLexicalPlannerFamilyEvidence>;
	spans: CoverageLexicalQuerySpan[];
	shortQueryOverlay: boolean;
	hasMetadataHint: boolean;
	hasPathShapeHint: boolean;
	hasTitleShapeHint: boolean;
	hasMixedScriptHint: boolean;
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
		probes,
	} = input;
	const reasons: string[] = [];
	const softOrNoiseCount =
		activeFamilies.filter((family) => family.strength === "soft").length +
		noiseFamilies.length;
	const metadataDominantAnchorCount = anchorFamilies.filter((family) =>
		isMetadataDominantAnchor(family, probes),
	).length;
	const structuredAnchorCount = activeFamilies.filter((family) =>
		isPlannerAnchorCandidate(family, familyEvidence, probes, shortQueryOverlay),
	).length;
	const titlePathSpanCount = spans.filter((span) => span.kind === "title_path").length;
	const metadataIntentSpanCount = spans.filter(
		(span) => span.kind === "metadata_intent",
	).length;
	const fillerSpanCount = spans.filter((span) => span.kind === "filler").length;
	const looksMetadataOnly =
		(anchorFamilies.length > 0 || structuredAnchorCount > 0) &&
		(bodyFamilies.length === 0 ||
			(shortQueryOverlay &&
				(hasTitleShapeHint ||
					hasPathShapeHint ||
					hasMetadataHint ||
					structuredAnchorCount > 0 ||
					titlePathSpanCount > 0 ||
					metadataIntentSpanCount > 0 ||
					metadataDominantAnchorCount >= Math.max(1, anchorFamilies.length))));
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
		(anchorFamilies.length > 0 || structuredAnchorCount > 0) &&
		bodyFamilies.length > 0 &&
		(
			hasMetadataHint ||
			hasPathShapeHint ||
			hasTitleShapeHint ||
			structuredAnchorCount > 0 ||
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
	queryKind: CoverageLexicalQueryKind,
	activeFamilies: ReadonlyArray<CoverageLexicalPlan["families"][number]>,
	familyEvidence: Map<number, CoverageLexicalPlannerFamilyEvidence>,
	probes: readonly CoverageLexicalFamilyProbe[],
	shortQueryOverlay: boolean,
): CoverageLexicalPlan["hardAnchorFamilies"] {
	if (
		queryKind === "body_only_local" ||
		activeFamilies.length === 0
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
	hardAnchorFamilies: ReadonlyArray<CoverageLexicalPlan["families"][number]>,
	familyEvidence: Map<number, CoverageLexicalPlannerFamilyEvidence>,
	probes: readonly CoverageLexicalFamilyProbe[],
): CoverageLexicalPlan["decisiveBodyFamilies"] {
	if (
		queryKind === "metadata_only_anchored" ||
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
		queryKind === "body_only_local"
			? coreBodyFamilies.length
			: queryKind === "memory_relaxed"
				? Math.max(1, Math.ceil(coreBodyFamilies.length / 2))
				: Math.min(coreBodyFamilies.length, 2);
	const nonGlueSorted = sorted.filter(
		(family) => !isPlannerGlueBodyFamily(family, familyEvidence),
	);
	const candidatePool = nonGlueSorted.length > 0 ? nonGlueSorted : sorted;
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
	familyEvidence: Map<number, CoverageLexicalPlannerFamilyEvidence>,
): number {
	const probe = probes[family.index];
	const evidence = familyEvidence.get(family.index);
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
	const rarityBonus = Math.max(0, 8 - Math.min(8, probe?.bodyExactDocCount ?? 0));
	const evidence = familyEvidence.get(family.index);
	const bodyBonus =
		(evidence?.spanKinds.includes("body") ? 4 : 0) -
		Math.min(4, evidence?.fillerScore ?? 0);
	const gluePenalty = isPlannerGlueBodyFamily(family, familyEvidence) ? 8 : 0;
	return computeTailWeight(family.index) + rarityBonus + bodyBonus - gluePenalty;
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
			shortQueryOverlay ||
			evidence.pathBasenameSignal >= Math.max(1, Math.floor(probe.bodyExactDocCount * 0.5));
	}
	if (!qualifies && evidence.titleSignal > 0) {
		qualifies =
			shortQueryOverlay ||
			evidence.titleSignal >= Math.max(1, Math.floor(probe.bodyExactDocCount * 0.75));
	}
	if (
		!qualifies &&
		evidence.spanKinds.includes("metadata_intent") &&
		!isPlannerGlueTerm(family.normalizedTerm) &&
		(probe.metadataExactDocCount ?? 0) > 0
	) {
		qualifies =
			shortQueryOverlay ||
			(probe.metadataExactDocCount ?? 0) >=
				Math.max(1, Math.floor((probe.bodyExactDocCount ?? 0) * 0.4));
	}
	return qualifies;
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
		spans: [...spans],
		familyReasons,
		queryKindReasons: [...queryKindReasons],
	};
}
