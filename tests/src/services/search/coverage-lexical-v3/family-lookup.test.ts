import type { IndexedDocument } from "src/globals/search-types";
import { buildResidentBase } from "src/services/search/coverage-lexical-v3/build";
import { analyzeQuery } from "src/services/search/coverage-lexical-v3/query";
import { lookupQueryUnitFamilies } from "src/services/search/coverage-lexical-v3/recall/family-lookup";

function createDocument(
	overrides: Partial<IndexedDocument> & Pick<IndexedDocument, "path" | "basename" | "folder">,
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

describe("coverage lexical v3 family lookup", () => {
	test("prefix collection keeps exact and applies a loose bounded budget", () => {
		const documents: IndexedDocument[] = [
			createDocument({
				path: "latin/exact.md",
				basename: "notes",
				folder: "latin",
				content: "prefe",
			}),
			...Array.from({ length: 320 }, (_, index) =>
				createDocument({
					path: `latin/prefix-${index.toString().padStart(3, "0")}.md`,
					basename: "notes",
					folder: "latin",
					content: `prefe${index.toString().padStart(3, "0")}`,
				}),
			),
		];
		const base = buildResidentBase(documents);
		const [unitMatches] = lookupQueryUnitFamilies(base, analyzeQuery("prefe"));
		const prefixMatches = unitMatches.matches.filter(
			(match) => match.matchKind === "prefix",
		);

		expect(unitMatches.matches[0]).toEqual(
			expect.objectContaining({
				familyText: "prefe",
				matchKind: "exact",
			}),
		);
		expect(unitMatches.matches).toHaveLength(65);
		expect(prefixMatches).toHaveLength(64);
		expect(prefixMatches[0]?.familyText).toBe("prefe000");
		expect(prefixMatches[1]?.familyText).toBe("prefe001");
		expect(prefixMatches.at(-1)?.familyText).toBe("prefe063");
	});
});
