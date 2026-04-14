import type { ResidentBase } from "../layout/types";
import type { V3QueryAnalysis } from "../query/analysis";
import { getFamilyText } from "./access";
import type {
	V3QueryFamilyMatch,
	V3QueryUnitFamilyMatches,
} from "./types";

export function lookupQueryUnitFamilies(
	base: ResidentBase,
	queryAnalysis: V3QueryAnalysis,
): V3QueryUnitFamilyMatches[] {
	const familyTexts = Array.from(
		{ length: base.familyLexicon.familyCount },
		(_, familyId) => getFamilyText(base, familyId),
	);
	const prefixExpandableByFamilyId = base.familyLexicon.prefixExpandableByFamilyId;
	const sourceMaskByFamilyId = base.familyLexicon.sourceMaskByFamilyId;
	return queryAnalysis.primaryUnits.map((queryUnit) => ({
		queryUnitIndex: queryUnit.index,
		queryUnitText: queryUnit.text,
		queryUnitSource: queryUnit.source,
		querySurfaceGroupIndex: queryUnit.surfaceGroupIndex,
		matches:
			queryUnit.source === "opaque_han_confirmed"
				? []
				: familyTexts
						.map<V3QueryFamilyMatch | null>((familyText, familyId) => {
							if ((sourceMaskByFamilyId[familyId] ?? 0) === 0) {
								return null;
							}
							if (familyText === queryUnit.text) {
								return {
									familyId,
									familyText,
									matchKind: "exact",
								};
							}
							if (
								prefixExpandableByFamilyId[familyId] === 1 &&
								familyText.length > queryUnit.text.length &&
								familyText.startsWith(queryUnit.text)
							) {
								return {
									familyId,
									familyText,
									matchKind: "prefix",
								};
							}
							return null;
						})
						.filter((match): match is V3QueryFamilyMatch => match != null)
						.sort((left, right) =>
							compareQueryFamilyMatch(left, right, queryUnit.text),
						),
	}));
}

function compareQueryFamilyMatch(
	left: V3QueryFamilyMatch,
	right: V3QueryFamilyMatch,
	queryUnitText: string,
): number {
	if (left.matchKind !== right.matchKind) {
		return left.matchKind === "exact" ? -1 : 1;
	}
	const leftExpansion = left.familyText.length - queryUnitText.length;
	const rightExpansion = right.familyText.length - queryUnitText.length;
	if (leftExpansion !== rightExpansion) {
		return leftExpansion - rightExpansion;
	}
	return left.familyText.localeCompare(right.familyText);
}
