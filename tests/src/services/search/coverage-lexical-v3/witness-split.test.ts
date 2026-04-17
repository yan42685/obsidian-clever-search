import type { IndexedDocument } from "src/globals/search-types";
import { buildResidentBase } from "src/services/search/coverage-lexical-v3/build";
import { CoverageLexicalV3Engine } from "src/services/search/coverage-lexical-v3/engine";
import type { V3DocumentTokenizer } from "src/services/search/coverage-lexical-v3/query";
import { getFamilyText } from "src/services/search/coverage-lexical-v3/recall";

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

function createDocumentTokenizer(
	termMap: Readonly<Record<string, readonly string[]>>,
): V3DocumentTokenizer {
	return (text) => termMap[text] ?? [];
}

describe("coverage lexical v3 witness split", () => {
	test("witness-only han surfaces stay out of the main family lexicon while completion still works", () => {
		const tokenizer = createDocumentTokenizer({
			"生命力": ["生命"],
			"这里记录生命力训练": ["这里", "记录", "生命", "训练"],
		});
		const document = createDocument({
			path: "zh/life-force.md",
			basename: "普通笔记",
			folder: "zh",
			content: "这里记录生命力训练",
		});
		const residentBase = buildResidentBase([document], tokenizer);
		const familyTexts = Array.from(
			{ length: residentBase.familyLexicon.familyCount },
			(_, familyId) => getFamilyText(residentBase, familyId),
		);
		const engine = new CoverageLexicalV3Engine();

		expect(familyTexts).not.toContain("生命力");
		expect(residentBase.hanRoute.bodyWitnessStringIds.length).toBeGreaterThan(0);

		engine.buildResidentBase([document], tokenizer);
		const result = engine.search("生命力", ["生命"]);

		expect(result.rankedCandidates).toHaveLength(1);
		expect(result.rankedCandidates[0].path).toBe("zh/life-force.md");
		expect(result.rankedCandidates[0].completedHanSurfaceGroupCount).toBe(1);
		expect(result.rankedCandidates[0].strongestHanSurfaceCompletionTier).toBe(
			"body_residue",
		);
	});
});
