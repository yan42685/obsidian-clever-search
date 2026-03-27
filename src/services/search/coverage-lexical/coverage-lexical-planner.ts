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
	const families = buildCoverageLexicalFamilies(queryTerms);
	const isShortQuery = families.length <= 2;
	const metadataCapableCount = families.filter(
		(family) => family.isMetadataCapable,
	).length;
	const hasMetadataHint = METADATA_HINT_REGEX.test(queryText);
	const route = selectRoute(
		hasMetadataHint,
		families.length,
		metadataCapableCount,
		probes,
	);

	return {
		families,
		isShortQuery,
		hasMetadataHint,
		route,
	};
}

function selectRoute(
	hasMetadataHint: boolean,
	familyCount: number,
	metadataCapableCount: number,
	probes: readonly CoverageLexicalFamilyProbe[],
): CoverageLexicalPlan["route"] {
	const bodyExactSignal = probes.reduce(
		(total, probe) => total + probe.bodyExactDocCount,
		0,
	);
	const metadataExactSignal = probes.reduce(
		(total, probe) => total + probe.metadataExactDocCount,
		0,
	);
	const metadataDominant =
		metadataCapableCount > 0 &&
		metadataExactSignal > 0 &&
		metadataExactSignal >= Math.max(2, bodyExactSignal * 2);

	if (
		hasMetadataHint ||
		(metadataCapableCount >= Math.max(2, familyCount) && metadataDominant)
	) {
		return "metadata-first";
	}
	if (metadataCapableCount > 0) {
		return "body-with-anchor";
	}
	return "body-first";
}
