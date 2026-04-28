import {
	extractDocumentFamilySupportOccurrences,
	extractDocumentFamilyTextSetOnly,
	splitBodyBlockFamilyTextSetsWithDocumentTokenizer,
	splitBodyBlocksWithDocumentTokenizer,
	type V3DocumentTokenizer,
} from "src/services/search/coverage-lexical-v3/query";

function dedupePreservingOrder(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		if (value.length === 0 || seen.has(value)) {
			continue;
		}
		seen.add(value);
		out.push(value);
	}
	return out;
}

const tokenizer: V3DocumentTokenizer = (text) => {
	const entries: Record<string, readonly string[]> = {
		"分批索引内存": ["分批", "索引", "内存"],
		"中文搜索召回": ["中文", "搜索", "召回"],
		"令牌投射": ["令牌", "投射"],
	};
	return entries[text] ?? [text];
};

describe("coverage lexical v3 family text-only extraction", () => {
	test.each([
		"projected secrets tokens",
		"pod-security projected-token route_anchor",
		"k8s/secrets/token lowMemoryMode hydrateCandidateEvidence",
		"分批索引内存 中文搜索召回",
		"projected token 令牌投射 route_anchor",
		"repeat repeat pod-security repeat",
	])("matches support occurrence text sets for %s", (text) => {
		const expected = dedupePreservingOrder(
			extractDocumentFamilySupportOccurrences(text, tokenizer).map(
				(occurrence) => occurrence.text,
			),
		);
		expect(extractDocumentFamilyTextSetOnly(text, tokenizer)).toEqual(expected);
	});

	test("matches body block family text sets from the full draft builder", () => {
		const text = [
			"projected secrets and pod-security",
			"",
			"hydrateCandidateEvidence lowMemoryMode",
			"",
			"分批索引内存 中文搜索召回",
			"",
			"k8s/secrets/token route_anchor",
		].join("\n");

		expect(splitBodyBlockFamilyTextSetsWithDocumentTokenizer(text, tokenizer)).toEqual(
			splitBodyBlocksWithDocumentTokenizer(text, tokenizer).map(
				(block) => block.familyTexts,
			),
		);
	});
});
