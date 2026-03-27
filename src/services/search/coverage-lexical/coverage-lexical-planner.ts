import { buildCoverageLexicalFamilies } from "./coverage-lexical-families";
import type {
	CoverageLexicalFamilyProbe,
	CoverageLexicalPlan,
} from "./coverage-lexical-types";

const METADATA_HINT_REGEX = /[\\/]|(?:^|\s)(?:tag|path|title|folder):/iu;

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
	const route = selectRoute(
		hasMetadataHint,
		bodyFamilies,
		anchorFamilies,
		probes,
	);

	return {
		families,
		shortQueryOverlay,
		hasMetadataHint,
		route,
		coreFamilyCount: coreFamilies.length,
		anchorFamilyCount: anchorFamilies.length,
		bodyFamilyCount: bodyFamilies.length,
	};
}

function selectRoute(
	hasMetadataHint: boolean,
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
	if (anchorFamilies.length > 0 && bodyFamilies.length > 0) {
		return "body-with-anchor";
	}
	if (hasMetadataHint && anchorFamilies.length > 0) {
		return bodyFamilies.length > 0 ? "body-with-anchor" : "metadata-first";
	}
	return "body-first";
}
