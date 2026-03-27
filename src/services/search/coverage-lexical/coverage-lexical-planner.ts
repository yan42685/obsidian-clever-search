import { buildCoverageLexicalFamilies } from "./coverage-lexical-families";
import type {
	CoverageLexicalFamilyProbe,
	CoverageLexicalPlanExplain,
	CoverageLexicalPlanFamilyReason,
	CoverageLexicalQueryKind,
	CoverageLexicalQuerySpan,
	CoverageLexicalQuerySpanKind,
	CoverageLexicalPlan,
	CoverageLexicalSyntheticTerm,
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
const LOCALIZED_SYNTHETIC_TERM_RULES: Array<{
	pattern: RegExp;
	terms: string[];
	preferAnchor: boolean;
}> = [
	{ pattern: /检查点|checkpoint/u, terms: ["checkpoint"], preferAnchor: true },
	{ pattern: /回放|replay/u, terms: ["replay"], preferAnchor: false },
	{ pattern: /恢复|restore/u, terms: ["restore"], preferAnchor: false },
	{ pattern: /插件|plugin/u, terms: ["plugin", "plugins"], preferAnchor: true },
	{ pattern: /路线图|roadmap/u, terms: ["roadmap"], preferAnchor: true },
	{ pattern: /页面|总览|overview|page/u, terms: ["page"], preferAnchor: true },
	{ pattern: /配置映射|configmap/u, terms: ["configmap"], preferAnchor: true },
	{ pattern: /配置|configuration/u, terms: ["configuration"], preferAnchor: false },
	{ pattern: /凭证|credential|secret/u, terms: ["credentials", "secret"], preferAnchor: false },
	{ pattern: /令牌|token/u, terms: ["token"], preferAnchor: false },
	{ pattern: /服务账号|service account/u, terms: ["service", "account"], preferAnchor: true },
	{ pattern: /挂载|mounted|mount/u, terms: ["mounted"], preferAnchor: false },
	{ pattern: /容器|pod/u, terms: ["pod", "pods"], preferAnchor: false },
	{ pattern: /技术说明|docs|guide/u, terms: ["docs", "guide"], preferAnchor: true },
];

type CoverageLexicalPlannerFamilyEvidence = {
	familyIndex: number;
	spanKinds: CoverageLexicalQuerySpanKind[];
	reasons: string[];
	metadataStructuredSignal: number;
	pathBasenameSignal: number;
	titleSignal: number;
	fillerScore: number;
	bodyScore: number;
	canonicalScore: number;
};

function hasSyntheticHardAnchorTerms(
	syntheticTerms: readonly CoverageLexicalSyntheticTerm[],
): boolean {
	return syntheticTerms.some((term) => term.bucket === "hard_anchor");
}

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
	const syntheticTerms = synthesizeLocalizedTerms(
		families,
		spans,
		familyEvidence,
	);
	const canonicalFamilies = selectCanonicalFamilies(families, familyEvidence);
	const noiseFamilies = families.filter((family) => family.role === "noise");
	const activeFamilies = families.filter((family) => family.role !== "noise");
	const canonicalActiveFamilies = canonicalFamilies.filter(
		(family) => family.role !== "noise",
	);
	const shortQueryOverlay = activeFamilies.length <= 2;
	const anchorFamilies = activeFamilies.filter((family) => family.role === "anchor");
	const bodyFamilies = activeFamilies.filter((family) => family.role === "body");
	const coreFamilies = activeFamilies.filter((family) => family.strength === "core");
	const canonicalBodyFamilies = canonicalActiveFamilies.filter(
		(family) => family.role === "body",
	);
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
		canonicalActiveFamilies,
		anchorFamilies,
		bodyFamilies,
		coreBodyFamilies,
		canonicalBodyFamilies,
		noiseFamilies,
		familyEvidence,
		spans,
		shortQueryOverlay,
		hasMetadataHint,
		hasPathShapeHint,
		hasTitleShapeHint,
		hasMixedScriptHint,
		syntheticTerms,
		probes,
	});
	const hardAnchorFamilies = selectHardAnchorFamilies(
		queryKind,
		activeFamilies,
		familyEvidence,
		syntheticTerms,
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
		...coreBodyFamilies.filter(
			(family) =>
				!reservedFamilyIndices.has(family.index) &&
				isSupportBodyCandidate(family, familyEvidence),
		),
		...softBodyFamilies.filter(
			(family) =>
				!reservedFamilyIndices.has(family.index) &&
				isSupportBodyCandidate(family, familyEvidence),
		),
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
		syntheticTerms,
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
			canonicalFamilies,
			syntheticTerms,
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
	canonicalActiveFamilies: CoverageLexicalPlan["families"];
	anchorFamilies: CoverageLexicalPlan["families"];
	bodyFamilies: CoverageLexicalPlan["families"];
	coreBodyFamilies: CoverageLexicalPlan["families"];
	canonicalBodyFamilies: CoverageLexicalPlan["families"];
	noiseFamilies: CoverageLexicalPlan["families"];
	familyEvidence: Map<number, CoverageLexicalPlannerFamilyEvidence>;
	spans: CoverageLexicalQuerySpan[];
	shortQueryOverlay: boolean;
	hasMetadataHint: boolean;
	hasPathShapeHint: boolean;
	hasTitleShapeHint: boolean;
	hasMixedScriptHint: boolean;
	syntheticTerms: readonly CoverageLexicalSyntheticTerm[];
	probes: readonly CoverageLexicalFamilyProbe[];
}): {
	queryKind: CoverageLexicalQueryKind;
	queryKindReasons: string[];
} {
	const {
		activeFamilies,
		canonicalActiveFamilies,
		anchorFamilies,
		bodyFamilies,
		coreBodyFamilies,
		canonicalBodyFamilies,
		noiseFamilies,
		familyEvidence,
		spans,
		shortQueryOverlay,
		hasMetadataHint,
		hasPathShapeHint,
		hasTitleShapeHint,
		hasMixedScriptHint,
		syntheticTerms,
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
	const syntheticHardAnchorCount = hasSyntheticHardAnchorTerms(syntheticTerms) ? 1 : 0;
	const canonicalBodyCount = canonicalBodyFamilies.length;
	const canonicalActiveCount = canonicalActiveFamilies.length;
	const titlePathSpanCount = spans.filter((span) => span.kind === "title_path").length;
	const metadataIntentSpanCount = spans.filter(
		(span) => span.kind === "metadata_intent",
	).length;
	const fillerSpanCount = spans.filter((span) => span.kind === "filler").length;
	const looksMetadataOnly =
		(anchorFamilies.length > 0 || structuredAnchorCount > 0 || syntheticHardAnchorCount > 0) &&
		(canonicalBodyCount === 0 ||
			(shortQueryOverlay &&
				(hasTitleShapeHint ||
					hasPathShapeHint ||
					hasMetadataHint ||
					structuredAnchorCount > 0 ||
					syntheticHardAnchorCount > 0 ||
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
		(anchorFamilies.length > 0 || structuredAnchorCount > 0 || syntheticHardAnchorCount > 0) &&
		canonicalBodyCount > 0 &&
		(
			hasMetadataHint ||
			hasPathShapeHint ||
			hasTitleShapeHint ||
			structuredAnchorCount > 0 ||
			syntheticHardAnchorCount > 0 ||
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
		canonicalActiveCount >= 3
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
	syntheticTerms: readonly CoverageLexicalSyntheticTerm[],
	probes: readonly CoverageLexicalFamilyProbe[],
	shortQueryOverlay: boolean,
): CoverageLexicalPlan["hardAnchorFamilies"] {
	if (
		queryKind === "body_only_local" ||
		activeFamilies.length === 0
	) {
		return [];
	}
	const syntheticHardAnchorFamilyIndices = new Set(
		syntheticTerms
			.filter((term) => term.bucket === "hard_anchor")
			.map((term) => term.sourceFamilyIndex),
	);
	const anchorFamilies = activeFamilies.filter(
		(family) =>
			family.role === "anchor" ||
			syntheticHardAnchorFamilyIndices.has(family.index) ||
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
	return sorted.slice(0, limit).sort((left, right) => left.index - right.index);
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
		Math.min(3, evidence?.fillerScore ?? 0);
	return computeTailWeight(family.index) + rarityBonus + bodyBonus;
}

function selectCanonicalFamilies(
	families: readonly CoverageLexicalPlan["families"][number][],
	familyEvidence: Map<number, CoverageLexicalPlannerFamilyEvidence>,
): CoverageLexicalPlan["families"] {
	return families.filter((family) => {
		if (family.role === "noise") {
			return false;
		}
		const evidence = familyEvidence.get(family.index);
		if (!evidence) {
			return family.role !== "noise";
		}
		if (
			evidence.spanKinds.includes("raw_shape") ||
			evidence.spanKinds.includes("title_path") ||
			evidence.spanKinds.includes("metadata_intent")
		) {
			return true;
		}
		if (evidence.bodyScore > evidence.fillerScore) {
			return true;
		}
		return evidence.canonicalScore > 0;
	});
}

function isSupportBodyCandidate(
	family: CoverageLexicalPlan["families"][number],
	familyEvidence: Map<number, CoverageLexicalPlannerFamilyEvidence>,
): boolean {
	const evidence = familyEvidence.get(family.index);
	if (!evidence) {
		return family.role === "body";
	}
	return (
		family.role === "body" &&
		(
			evidence.bodyScore > 0 ||
			evidence.canonicalScore > 0
		) &&
		evidence.fillerScore <= evidence.bodyScore
	);
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
	return (
		structuredSignal > 0 &&
		(
			evidence?.spanKinds.includes("raw_shape") ||
			evidence?.spanKinds.includes("title_path") ||
			evidence?.spanKinds.includes("metadata_intent")
		)
	);
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
	if (evidence.pathBasenameSignal > 0) {
		return (
			shortQueryOverlay ||
			evidence.pathBasenameSignal >= Math.max(1, Math.floor(probe.bodyExactDocCount * 0.5))
		);
	}
	if (evidence.titleSignal > 0) {
		return (
			shortQueryOverlay ||
			evidence.titleSignal >= Math.max(1, Math.floor(probe.bodyExactDocCount * 0.75))
		);
	}
	return false;
}

function extractCoverageLexicalQuerySpans(queryText: string): CoverageLexicalQuerySpan[] {
	const normalized = queryText.toLowerCase().normalize("NFKC");
	const roughSegments = normalized.split(/\s+/u).filter((segment) => segment.trim().length > 0);
	const segments = roughSegments.length > 0
		? roughSegments
		: normalized.match(RAW_QUERY_SEGMENT_REGEX) ?? [];
	return segments.map(classifyCoverageLexicalQuerySpan);
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
			fillerScore: matchedSpans.filter((span) => span.kind === "filler").length,
			bodyScore: matchedSpans.filter((span) => span.kind === "body").length,
			canonicalScore:
				spanKinds.filter((kind) => kind !== "filler").length -
				matchedSpans.filter((span) => span.kind === "filler").length,
		});
	}
	return evidenceByFamily;
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
	canonicalFamilies: readonly CoverageLexicalPlan["families"][number][],
	syntheticTerms: readonly CoverageLexicalSyntheticTerm[],
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
		canonicalTerms: canonicalFamilies.map((family) => family.normalizedTerm),
		droppedFillerTerms: families
			.filter((family) => !canonicalFamilies.some((candidate) => candidate.index === family.index))
			.map((family) => family.normalizedTerm),
		familyReasons,
		queryKindReasons: [
			...queryKindReasons,
			...syntheticTerms.map(
				(term) => `synthetic-${term.bucket}:${term.term}:${term.reason}`,
			),
		],
	};
}

function synthesizeLocalizedTerms(
	families: readonly CoverageLexicalPlan["families"][number][],
	spans: readonly CoverageLexicalQuerySpan[],
	familyEvidence: Map<number, CoverageLexicalPlannerFamilyEvidence>,
): CoverageLexicalSyntheticTerm[] {
	const out: CoverageLexicalSyntheticTerm[] = [];
	const seen = new Set<string>();
	for (const family of families) {
		const evidence = familyEvidence.get(family.index);
		if (!evidence) {
			continue;
		}
		const matchedSpans = spans.filter((span) =>
			span.text.includes(family.normalizedTerm) ||
			family.normalizedTerm.includes(span.text),
		);
		for (const span of matchedSpans) {
			for (const rule of LOCALIZED_SYNTHETIC_TERM_RULES) {
				if (!rule.pattern.test(span.text)) {
					continue;
				}
				for (const term of rule.terms) {
					const bucket: CoverageLexicalSyntheticTerm["bucket"] =
						rule.preferAnchor &&
						(
							span.kind === "title_path" ||
							span.kind === "metadata_intent" ||
							span.kind === "raw_shape"
						)
							? "hard_anchor"
							: "bridge";
					const scope: CoverageLexicalSyntheticTerm["scope"] =
						bucket === "hard_anchor" ? "metadata-only" : "all";
					const key = `${family.index}:${term}:${bucket}:${scope}`;
					if (seen.has(key)) {
						continue;
					}
					seen.add(key);
					out.push({
						sourceFamilyIndex: family.index,
						term,
						bucket,
						scope,
						reason: `${span.kind}:${span.text}`,
					});
				}
			}
		}
	}
	return out;
}
