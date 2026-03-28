describe("mounted modal helper", () => {
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

	test("treats native lexical subitems as direct even when the list is empty", () => {
		const { EngineType, FileItem } = require("src/globals/search-types");
		const { usesDirectFileSubItems } = require("src/ui/mounted-modal-helper");
		const item = new FileItem(
			EngineType.LEXICAL,
			"notes/example.md",
			["cache"],
			["cache"],
			[],
			"nothing",
			true,
		);

		expect(usesDirectFileSubItems(item)).toBe(true);
	});
});
