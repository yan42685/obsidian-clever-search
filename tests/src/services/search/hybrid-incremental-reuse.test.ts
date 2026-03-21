import { computeUnchangedOffsetBlocks } from "src/services/search/hybrid/incremental-reuse";

function sliceByBlocks(
	oldText: string,
	newText: string,
) {
	return computeUnchangedOffsetBlocks(oldText, newText).map((block) => ({
		oldText: oldText.slice(block.oldStartOffset, block.oldEndOffset),
		newText: newText.slice(block.newStartOffset, block.newEndOffset),
	}));
}

describe("hybrid incremental reuse", () => {
	test("finds multiple unchanged anchors around a middle insertion", () => {
		const oldText = [
			"# Title",
			"",
			"alpha",
			"beta",
			"gamma",
			"delta",
		].join("\n");
		const newText = [
			"# Title",
			"",
			"alpha",
			"INSERT",
			"beta",
			"gamma",
			"delta",
		].join("\n");

		const blocks = sliceByBlocks(oldText, newText);

		expect(blocks).toEqual([
			expect.objectContaining({
				oldText: "# Title\n\nalpha\n",
				newText: "# Title\n\nalpha\n",
			}),
			expect.objectContaining({
				oldText: "beta\ngamma\ndelta",
				newText: "beta\ngamma\ndelta",
			}),
		]);
	});

	test("does not treat a changed boundary line as unchanged", () => {
		const oldText = ["Sentence ends here.", "Stable body line."].join("\n");
		const newText = ["Sentence ends here", "Stable body line."].join("\n");

		const blocks = sliceByBlocks(oldText, newText);

		expect(blocks).toEqual([
			expect.objectContaining({
				oldText: "Stable body line.",
				newText: "Stable body line.",
			}),
		]);
	});

	test("keeps later unchanged islands when the middle section changes twice", () => {
		const oldText = [
			"# Parent",
			"intro",
			"## Section A",
			"keep-a",
			"## Section B",
			"keep-b",
			"## Section C",
			"keep-c",
		].join("\n");
		const newText = [
			"# Parent",
			"intro",
			"## Section A",
			"changed-a",
			"## Section B",
			"keep-b",
			"## Section C",
			"changed-c",
		].join("\n");

		const blocks = sliceByBlocks(oldText, newText);

		expect(blocks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					oldText: "# Parent\nintro\n## Section A\n",
					newText: "# Parent\nintro\n## Section A\n",
				}),
				expect.objectContaining({
					oldText: "## Section B\nkeep-b\n## Section C\n",
					newText: "## Section B\nkeep-b\n## Section C\n",
				}),
			]),
		);
	});
});
