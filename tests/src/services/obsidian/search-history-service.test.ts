import { container } from "tsyringe";

describe("SearchHistoryService", () => {
	beforeEach(() => {
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "en"),
			},
		};
		(global as any).alert = jest.fn();
	});

	afterEach(() => {
		jest.restoreAllMocks();
		delete (global as any).window;
		delete (global as any).alert;
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
	});

	function createServiceHarness() {
		const { SearchHistoryService } = require("src/services/obsidian/user-data/search-history-service");
		const {
			OuterSetting,
			DEFAULT_OUTER_SETTING,
		} = require("src/globals/plugin-setting");
		const { THIS_PLUGIN } = require("src/globals/constants");

		const setting = JSON.parse(JSON.stringify(DEFAULT_OUTER_SETTING));
		setting.searchHistory.entries = [];
		const plugin = {
			saveData: jest.fn().mockResolvedValue(undefined),
		};

		container.register(OuterSetting, { useValue: setting });
		container.register(THIS_PLUGIN, { useValue: plugin });

		return {
			service: container.resolve(SearchHistoryService) as any,
			setting,
			plugin,
		};
	}

	test("deduplicates normalized history queries and aggregates counts", async () => {
		const { service, setting, plugin } = createServiceHarness();
		const nowSpy = jest.spyOn(Date, "now");

		nowSpy.mockReturnValueOnce(1000);
		await service.recordQuery("  history search  ");
		nowSpy.mockReturnValueOnce(2000);
		await service.recordQuery("history search");
		nowSpy.mockReturnValueOnce(3000);
		await service.recordQuery("history helper");

		const suggestions = service.getCandidateSuggestions("hist");
		const searchEntry = setting.searchHistory.entries.find(
			(entry: any) => entry.queryText === "history search",
		);

		expect(setting.searchHistory.entries).toHaveLength(2);
		expect(searchEntry).toMatchObject({
			queryText: "history search",
			count: 2,
			timestamp: 2000,
		});
		expect(
			suggestions.filter((entry: any) => entry.queryText === "history search"),
		).toHaveLength(1);
		expect(plugin.saveData).toHaveBeenCalledTimes(3);
	});

	test("orders history by latest confirmed interaction before older matches", async () => {
		const { service } = createServiceHarness();
		const nowSpy = jest.spyOn(Date, "now");

		nowSpy.mockReturnValueOnce(1000);
		await service.recordQuery("gamma note");
		nowSpy.mockReturnValueOnce(2000);
		await service.recordQuery("delta note");
		nowSpy.mockReturnValueOnce(3000);
		await service.recordSuggestionSelection("gamma note");

		const suggestions = service.getCandidateSuggestions("note");

		expect(suggestions.map((entry: any) => entry.queryText).slice(0, 2)).toEqual([
			"gamma note",
			"delta note",
		]);
	});
});
