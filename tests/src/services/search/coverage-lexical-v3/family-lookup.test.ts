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

function buildPrefixDocuments(prefix: string, count: number): IndexedDocument[] {
	return [
		createDocument({
			path: `latin/${prefix}-exact.md`,
			basename: "notes",
			folder: "latin",
			content: prefix,
		}),
		...Array.from({ length: count }, (_, index) =>
			createDocument({
				path: `latin/${prefix}-${index.toString().padStart(4, "0")}.md`,
				basename: "notes",
				folder: "latin",
				content: `${prefix}${index.toString().padStart(4, "0")}`,
			}),
		),
	];
}

describe("coverage lexical v3 family lookup", () => {
	test("prefix collection keeps exact and applies a loose bounded budget", () => {
		const base = buildResidentBase(buildPrefixDocuments("prefe", 320));
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
		expect(prefixMatches[0]?.familyText).toBe("prefe0000");
		expect(prefixMatches[1]?.familyText).toBe("prefe0001");
		expect(prefixMatches.at(-1)?.familyText).toBe("prefe0063");
	});

	test("prefix collection grows match limit with longer query units", () => {
		const eightCharBase = buildResidentBase(buildPrefixDocuments("prefix08", 400));
		const [eightCharMatches] = lookupQueryUnitFamilies(
			eightCharBase,
			analyzeQuery("prefix08"),
		);
		const eightCharPrefixMatches = eightCharMatches.matches.filter(
			(match) => match.matchKind === "prefix",
		);

		expect(eightCharPrefixMatches).toHaveLength(112);
		expect(eightCharPrefixMatches[0]?.familyText).toBe("prefix080000");
		expect(eightCharPrefixMatches.at(-1)?.familyText).toBe("prefix080111");

		const longBase = buildResidentBase(buildPrefixDocuments("prefixLong", 400));
		const [longMatches] = lookupQueryUnitFamilies(longBase, analyzeQuery("prefixLong"));
		const longPrefixMatches = longMatches.matches.filter(
			(match) => match.matchKind === "prefix",
		);

		expect(longPrefixMatches).toHaveLength(128);
		expect(longPrefixMatches[0]?.familyText).toBe("prefixlong0000");
		expect(longPrefixMatches.at(-1)?.familyText).toBe("prefixlong0127");
	});
});
