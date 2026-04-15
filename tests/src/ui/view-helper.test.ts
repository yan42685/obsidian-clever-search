import { FileSubItem } from "src/globals/search-types";
import { ViewHelper } from "src/ui/view-helper";

describe("view helper structured snippet segments", () => {
	test("clamps out-of-bounds highlight ranges into the visible snippet", () => {
		const helper = Object.create(ViewHelper.prototype) as ViewHelper;
		const subItem = new FileSubItem("生命力", 0, 0);
		subItem.snippetText = "生命力";
		subItem.highlightRanges = [{ start: 0, end: 8 }];

		const segments = helper.getStructuredSnippetSegments(subItem);

		expect(segments).toEqual([{ text: "生命力", highlight: true }]);
	});
});
