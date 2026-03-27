import { buildCoverageLexicalFamilies } from "./coverage-lexical-families";
import type {
	CoverageLexicalFamilyProbe,
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
	const activeFamilies = families.filter((family) => family.role !== "noise");
	const shortQueryOverlay = activeFamilies.length <= 2;
	const anchorFamilies = activeFamilies.filter((family) => family.role === "anchor");
	const bodyFamilies = activeFamilies.filter((family) => family.role === "body");
	const coreFamilies = activeFamilies.filter((family) => family.strength === "core");
	const hasMetadataHint = METADATA_HINT_REGEX.test(queryText);
	const hasPathShapeHint = detectPathShapeHint(queryText, queryTerms);
	const hasTitleShapeHint = detectTitleShapeHint(queryTerms);
	const hasMixedScriptHint = detectMixedScriptHint(queryTerms);
	const route = selectRoute(
		hasMetadataHint,
		hasPathShapeHint,
		hasTitleShapeHint,
		bodyFamilies,
		anchorFamilies,
		probes,
	);

	return {
		families,
		shortQueryOverlay,
		hasMetadataHint,
		hasMixedScriptHint,
		hasPathShapeHint,
		hasTitleShapeHint,
		route,
		coreFamilyCount: coreFamilies.length,
		anchorFamilyCount: anchorFamilies.length,
		bodyFamilyCount: bodyFamilies.length,
	};
}

function selectRoute(
	hasMetadataHint: boolean,
	hasPathShapeHint: boolean,
	hasTitleShapeHint: boolean,
	bodyFamilies: ReadonlyArray<CoverageLexicalPlan["families"][number]>,
	anchorFamilies: ReadonlyArray<CoverageLexicalPlan["families"][number]>,
	probes: readonly CoverageLexicalFamilyProbe[],
): CoverageLexicalPlan["route"] {
	const bodyExactSignal = bodyFamilies.reduce(
		(total, family) => total + (probes[family.index]?.bodyExactDocCount ?? 0),
		0,
	);
	const metadataExactSignal = anchorFamilies.reduce(
		(total, family) => total + (probes[family.index]?.metadataExactDocCount ?? 0),
		0,
	);
	const metadataDominant =
		anchorFamilies.length > 0 &&
		metadataExactSignal > 0 &&
		metadataExactSignal >= Math.max(2, bodyExactSignal * 2);

	if (
		anchorFamilies.length > 0 &&
		(bodyFamilies.length === 0 || metadataDominant)
	) {
		return "metadata-first";
	}
	if (
		anchorFamilies.length > 0 &&
		bodyFamilies.length > 0 &&
		(hasPathShapeHint || hasTitleShapeHint)
	) {
		return "body-with-anchor";
	}
	if (anchorFamilies.length > 0 && bodyFamilies.length > 0) {
		return "body-with-anchor";
	}
	if (hasMetadataHint && anchorFamilies.length > 0) {
		return bodyFamilies.length > 0 ? "body-with-anchor" : "metadata-first";
	}
	return "body-first";
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
