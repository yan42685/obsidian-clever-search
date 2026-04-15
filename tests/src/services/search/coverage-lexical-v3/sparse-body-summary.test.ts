import type { IndexedDocument } from "src/globals/search-types";
import { buildResidentBase } from "src/services/search/coverage-lexical-v3/build";
import { collectBodySummaryBlockIds, getFamilyText } from "src/services/search/coverage-lexical-v3/recall";

function createDocument(
	overrides: Partial<IndexedDocument> &
		Pick<IndexedDocument, "path" | "basename" | "folder">,
): IndexedDocument {
	return {
		path: overrides.path,
		basename: overrides.basename,
		folder: overrides.folder,
		content: overrides.content,
		aliases: overrides.aliases,
		tags: overrides.tags,
		headings: overrides.headings,
		generation: overrides.generation,
		size: overrides.size,
	};
}

function findFamilyIdByText(
	familyTexts: readonly string[],
	target: string,
): number {
	const familyId = familyTexts.findIndex((familyText) => familyText === target);
	if (familyId === -1) {
		throw new Error(`Expected to find family text: ${target}`);
	}
	return familyId;
}

describe("coverage lexical v3 sparse body summary", () => {
	test("body summary stores only families that actually appear in block summaries", () => {
		const residentBase = buildResidentBase([
			createDocument({
				path: "notes/sparse.md",
				basename: "metadataonly",
				folder: "notes",
				content: "bodyonly",
			}),
		]);
		const familyTexts = Array.from(
			{ length: residentBase.familyLexicon.familyCount },
			(_, familyId) => getFamilyText(residentBase, familyId),
		);
		const metadataFamilyId = findFamilyIdByText(familyTexts, "metadataonly");
		const bodyFamilyId = findFamilyIdByText(familyTexts, "bodyonly");

		expect(residentBase.bodySummary.familyIds.length).toBeLessThan(
			residentBase.familyLexicon.familyCount,
		);
		expect(residentBase.bodySummary.postingStarts.length).toBe(
			residentBase.bodySummary.familyIds.length + 1,
		);
		expect(collectBodySummaryBlockIds(residentBase, metadataFamilyId)).toEqual([]);
		expect(collectBodySummaryBlockIds(residentBase, bodyFamilyId)).toEqual([0]);
	});
});
