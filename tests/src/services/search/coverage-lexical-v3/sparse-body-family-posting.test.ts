import type { IndexedDocument } from "src/globals/search-types";
import { buildResidentBase } from "src/services/search/coverage-lexical-v3/build";
import {
	collectBodyFamilyPostingBlockIds,
	getFamilyText,
} from "src/services/search/coverage-lexical-v3/recall";

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
			generation: overrides.generation ?? 1,
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

describe("coverage lexical v3 sparse body family posting", () => {
	test("body family posting stores only families that actually appear in block summaries", () => {
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
		const summarizedFamilyCount =
			residentBase.bodyFamilyPosting.singletonTermIds.length +
			residentBase.bodyFamilyPosting.pairTermIds.length +
			residentBase.bodyFamilyPosting.smallTermIds.length +
			residentBase.bodyFamilyPosting.deltaTermIds.length;

		expect(summarizedFamilyCount).toBeLessThan(
			residentBase.familyLexicon.familyCount,
		);
		expect(summarizedFamilyCount).toBe(1);
		expect(collectBodyFamilyPostingBlockIds(residentBase, metadataFamilyId)).toEqual(
			[],
		);
		expect(collectBodyFamilyPostingBlockIds(residentBase, bodyFamilyId)).toEqual(
			[0],
		);
	});
});
