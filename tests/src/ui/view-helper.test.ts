export {};

describe("view helper", () => {
	beforeEach(() => {
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "zh"),
				setItem: jest.fn(),
				removeItem: jest.fn(),
			},
		};
	});

	afterEach(() => {
		delete (global as any).window;
		jest.resetModules();
	});

	test("scrolls to the newly selected next subitem", () => {
		const { FileSubItem } = require("src/globals/search-types");
		const { ViewHelper } = require("src/ui/view-helper");
		const helper = Object.create(ViewHelper.prototype) as {
			updateSubItemIndex: (
				subItems: InstanceType<typeof FileSubItem>[],
				currSubIndex: number,
				direction: "next" | "prev",
			) => number;
			scrollTo: jest.Mock;
		};
		helper.scrollTo = jest.fn();
		const first = new FileSubItem("alpha", 0, 0);
		const second = new FileSubItem("beta", 1, 0);

		const nextIndex = helper.updateSubItemIndex([first, second], 0, "next");

		expect(nextIndex).toBe(1);
		expect(helper.scrollTo).toHaveBeenCalledWith("center", second, "auto");
	});

	test("starts from the first subitem when nothing is selected yet", () => {
		const { NULL_NUMBER } = require("src/globals/constants");
		const { FileSubItem } = require("src/globals/search-types");
		const { ViewHelper } = require("src/ui/view-helper");
		const helper = Object.create(ViewHelper.prototype) as {
			updateSubItemIndex: (
				subItems: InstanceType<typeof FileSubItem>[],
				currSubIndex: number,
				direction: "next" | "prev",
			) => number;
			scrollTo: jest.Mock;
		};
		helper.scrollTo = jest.fn();
		const first = new FileSubItem("alpha", 0, 0);
		const second = new FileSubItem("beta", 1, 0);

		const nextIndex = helper.updateSubItemIndex(
			[first, second],
			NULL_NUMBER,
			"next",
		);

		expect(nextIndex).toBe(0);
		expect(helper.scrollTo).toHaveBeenCalledWith("center", first, "auto");
	});
});
