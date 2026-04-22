import { buildV3DirectSubitems } from "src/services/search/coverage-lexical-v3/direct-subitems";
import { splitBodyBlocks } from "src/services/search/coverage-lexical-v3/query";
import {
	createLatinQueryAnalysis,
	createMinimalCandidate,
	createMinimalCandidateRecall,
	createMinimalResidentBaseForBlockCounts,
} from "./test-fixtures";

function buildTripleBlockSnapshot(): string {
	for (let fillerLength = 1200; fillerLength <= 1800; fillerLength += 25) {
		const snapshotText = [
			`first target ${"a".repeat(fillerLength)}.`,
			`middle target ${"b".repeat(fillerLength)}.`,
			`last target ${"c".repeat(fillerLength)}.`,
		].join("\n");
		const blocks = splitBodyBlocks(snapshotText);
		if (
			blocks.length === 3 &&
			blocks[0]?.normalizedText.includes("first target") &&
			blocks[1]?.normalizedText.includes("middle target") &&
			blocks[2]?.normalizedText.includes("last target")
		) {
			return snapshotText;
		}
	}
	throw new Error("failed to construct a triple-block snapshot");
}

describe("coverage lexical v3 direct subitems shortlist", () => {
	test("uses candidate-local shortlisted body blocks to limit body scanning to selected blocks", () => {
		const snapshotText = buildTripleBlockSnapshot();
		const result = buildV3DirectSubitems({
			snapshotText,
			queryAnalysis: createLatinQueryAnalysis("target"),
			candidate: createMinimalCandidate(),
			candidateRecall: createMinimalCandidateRecall([1]),
			residentBase: createMinimalResidentBaseForBlockCounts([3]),
		});

		expect(result.candidates).toHaveLength(1);
		expect(result.subItems).toHaveLength(1);
		expect(result.subItems[0]?.snippetText).toContain("middle target");
		expect(result.subItems[0]?.snippetText).not.toContain("first target");
		expect(result.subItems[0]?.snippetText).not.toContain("last target");
	});
});
