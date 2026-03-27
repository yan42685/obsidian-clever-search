import { buildCoverageLexicalFamilies } from "./coverage-lexical-families";
import type { CoverageLexicalPlan } from "./coverage-lexical-types";

const METADATA_HINT_REGEX = /[\\/]|(?:^|\s)(?:tag|path|title|folder):/iu;

export function buildCoverageLexicalPlan(
	queryText: string,
	queryTerms: readonly string[],
): CoverageLexicalPlan {
	const families = buildCoverageLexicalFamilies(queryTerms);
	const isShortQuery = families.length <= 2;
	const metadataCapableCount = families.filter(
		(family) => family.isMetadataCapable,
	).length;
	const route = selectRoute(queryText, families.length, metadataCapableCount);

	return {
		families,
		isShortQuery,
		route,
	};
}

function selectRoute(
	queryText: string,
	familyCount: number,
	metadataCapableCount: number,
): CoverageLexicalPlan["route"] {
	if (
		METADATA_HINT_REGEX.test(queryText) ||
		metadataCapableCount >= Math.max(2, familyCount)
	) {
		return "metadata-first";
	}
	if (metadataCapableCount > 0) {
		return "body-with-anchor";
	}
	return "body-first";
}
