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
			generation: overrides.generation ?? 1,
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

	test("prefix collection respects a query-wide soft time budget", () => {
		const base = buildResidentBase([
			...buildPrefixDocuments("prefe", 600),
			...buildPrefixDocuments("alpha", 600),
		]);
		const nowSpy = jest.spyOn(performance, "now");
		nowSpy
			.mockReturnValueOnce(0)
			.mockReturnValueOnce(60)
			.mockReturnValue(60);

		const unitMatches = lookupQueryUnitFamilies(base, analyzeQuery("prefe alpha"));
		const prefeMatches = unitMatches[0].matches.filter((match) => match.matchKind === "prefix");
		const alphaMatches = unitMatches[1].matches.filter((match) => match.matchKind === "prefix");

		expect(prefeMatches).toHaveLength(64);
		expect(unitMatches[1].matches[0]).toEqual(
			expect.objectContaining({
				familyText: "alpha",
				matchKind: "exact",
			}),
		);
		expect(alphaMatches).toHaveLength(0);

		nowSpy.mockRestore();
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

	test("prefix collection can be disabled per request", () => {
		const base = buildResidentBase(buildPrefixDocuments("freefont", 12));
		const [unitMatches] = lookupQueryUnitFamilies(base, analyzeQuery("freefont"), {
			allowPrefixMatch: false,
		});

		expect(unitMatches.matches).toEqual([
			expect.objectContaining({
				familyText: "freefont",
				matchKind: "exact",
			}),
		]);
	});

	test("fuzzy rescue only triggers after exact and prefix both miss", () => {
		const base = buildResidentBase([
			createDocument({
				path: "latin/obsidian.md",
				basename: "obsidian",
				folder: "latin",
				content: "obsidian",
			}),
			createDocument({
				path: "latin/runtime.md",
				basename: "runtime",
				folder: "latin",
				content: "runtime",
			}),
		]);

		const [fuzzyOnly] = lookupQueryUnitFamilies(base, analyzeQuery("obsidan"));
		expect(fuzzyOnly.matches).toEqual([
			expect.objectContaining({
				familyText: "obsidian",
				matchKind: "fuzzy",
				editDistance: 1,
			}),
		]);

		const [exactPresent] = lookupQueryUnitFamilies(base, analyzeQuery("runtime"));
		expect(exactPresent.matches.some((match) => match.matchKind === "fuzzy")).toBe(false);

		const [prefixPresent] = lookupQueryUnitFamilies(base, analyzeQuery("runtim"));
		expect(prefixPresent.matches.some((match) => match.matchKind === "fuzzy")).toBe(false);
	});

	test("fuzzy rescue respects minimum length and edit-distance-one verification", () => {
		const base = buildResidentBase([
			createDocument({
				path: "latin/cache.md",
				basename: "cachex",
				folder: "latin",
				content: "cachex",
			}),
			createDocument({
				path: "latin/obsidian.md",
				basename: "obsidian",
				folder: "latin",
				content: "obsidian",
			}),
		]);

		const [tooShort] = lookupQueryUnitFamilies(base, analyzeQuery("cachx"));
		expect(tooShort.matches).toEqual([]);

		const [oneEdit] = lookupQueryUnitFamilies(base, analyzeQuery("obsidan"));
		expect(oneEdit.matches.some((match) => match.familyText === "obsidian")).toBe(true);

		const [twoEdits] = lookupQueryUnitFamilies(base, analyzeQuery("obsadn"));
		expect(twoEdits.matches).toEqual([]);
	});

	test("fuzzy rescue can be disabled per request", () => {
		const base = buildResidentBase([
			createDocument({
				path: "latin/obsidian.md",
				basename: "obsidian",
				folder: "latin",
				content: "obsidian",
			}),
		]);

		const [unitMatches] = lookupQueryUnitFamilies(base, analyzeQuery("obsidan"), {
			allowFuzzyMatch: false,
		});

		expect(unitMatches.matches).toEqual([]);
	});

	test("fuzzy rescue stays on metadata anchors and skips heading or body only families", () => {
		const base = buildResidentBase([
			createDocument({
				path: "latin/basename.md",
				basename: "obsidian",
				folder: "latin",
				content: "plain note",
			}),
			createDocument({
				path: "latin/alias.md",
				basename: "notes",
				folder: "latin",
				aliases: "workspace",
				content: "plain note",
			}),
			createDocument({
				path: "latin/route.md",
				basename: "notes",
				folder: "playbooks",
				tags: "restoration",
				content: "plain note",
			}),
			createDocument({
				path: "latin/heading-only.md",
				basename: "notes",
				folder: "latin",
				headings: "incident",
				content: "plain note",
			}),
			createDocument({
				path: "latin/body-only.md",
				basename: "notes",
				folder: "latin",
				content: "runbooks",
			}),
		]);

		const [basenameMatch] = lookupQueryUnitFamilies(base, analyzeQuery("obsidan"));
		expect(basenameMatch.matches).toEqual([
			expect.objectContaining({
				familyText: "obsidian",
				matchKind: "fuzzy",
			}),
		]);

		const [aliasMatch] = lookupQueryUnitFamilies(base, analyzeQuery("workspce"));
		expect(aliasMatch.matches).toEqual([
			expect.objectContaining({
				familyText: "workspace",
				matchKind: "fuzzy",
			}),
		]);

		const [routeMatch] = lookupQueryUnitFamilies(base, analyzeQuery("restoraton"));
		expect(routeMatch.matches).toEqual([
			expect.objectContaining({
				familyText: "restoration",
				matchKind: "fuzzy",
			}),
		]);

		const [headingOnlyMiss] = lookupQueryUnitFamilies(base, analyzeQuery("incdent"));
		expect(headingOnlyMiss.matches).toEqual([]);

		const [bodyOnlyMiss] = lookupQueryUnitFamilies(base, analyzeQuery("runboks"));
		expect(bodyOnlyMiss.matches).toEqual([]);
	});

	test("fuzzy rescue respects query-wide time budget", () => {
		const fuzzyChars = "abcdefghijklmnopqrstuvwxy0123456789".split("");
		const families = fuzzyChars.map((char) =>
			createDocument({
				path: `latin/obsidian-${char}.md`,
				basename: `obsidian${char}`,
				folder: "latin",
				content: `obsidian${char}`,
			}),
		);
		const base = buildResidentBase([
			...families,
			createDocument({
				path: "latin/incident.md",
				basename: "incident",
				folder: "latin",
				content: "incident",
			}),
		]);
		const nowSpy = jest.spyOn(performance, "now");
		nowSpy
			.mockReturnValueOnce(0)
			.mockReturnValueOnce(0)
			.mockReturnValueOnce(9)
			.mockReturnValue(9);

		const unitMatches = lookupQueryUnitFamilies(base, analyzeQuery("obsidianz incdent"));

		expect(unitMatches[0].matches.some((match) => match.matchKind === "fuzzy")).toBe(true);
		expect(unitMatches[1].matches.some((match) => match.matchKind === "fuzzy")).toBe(false);

		nowSpy.mockRestore();
	});
});
