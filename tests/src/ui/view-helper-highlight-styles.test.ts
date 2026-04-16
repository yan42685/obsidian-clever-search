import { FileSubItem } from "src/globals/search-types";
import { ViewHelper } from "src/ui/view-helper";

describe("view helper highlight styles", () => {
	test("renders strong and weak highlight markup without mark backgrounds", () => {
		const helper = Object.create(ViewHelper.prototype) as ViewHelper;

		const html = helper.renderHighlightedText(
			"obsidian runtime",
			[{ start: 9, end: 16 }],
			[{ start: 0, end: 8 }],
		);

		expect(html).toContain('<span class="cs-search-match-weak">obsidian</span>');
		expect(html).toContain('<strong class="cs-search-match">runtime</strong>');
		expect(html).not.toContain("<mark>");
	});

	test("structured snippet segments preserve strong and weak styles", () => {
		const helper = Object.create(ViewHelper.prototype) as ViewHelper;
		const subItem = new FileSubItem("obsidian runtime", 0, 0);
		subItem.snippetText = "obsidian runtime";
		subItem.highlightRanges = [{ start: 9, end: 16 }];
		subItem.weakHighlightRanges = [{ start: 0, end: 8 }];

		const segments = helper.getStructuredSnippetSegments(subItem);

		expect(segments).toEqual([
			{ text: "obsidian", highlight: true },
			{ text: " ", highlight: false },
			{ text: "runtime", highlight: true },
		]);
		expect(segments?.map((segment) => segment.style)).toEqual([
			"weak",
			"none",
			"strong",
		]);
	});
});
