import { container } from "tsyringe";

jest.mock("obsidian", () => ({
	App: class App {},
	TFile: class TFile {},
	Vault: class Vault {},
	parseFrontMatterAliases: jest.fn(() => []),
	moment: {
		locale: () => "en",
	},
}));

describe("SearchAutocompleteService", () => {
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
	});

	afterEach(() => {
		jest.restoreAllMocks();
		delete (global as any).window;
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
	});

	function createServiceHarness() {
		const { App, Vault } = require("obsidian");
		const {
			OuterSetting,
			DEFAULT_OUTER_SETTING,
		} = require("src/globals/plugin-setting");
		const { THIS_PLUGIN } = require("src/globals/constants");
		const { DataProvider } = require("src/services/obsidian/user-data/data-provider");
		const {
			SearchHistoryService,
		} = require("src/services/obsidian/user-data/search-history-service");
		const {
			SearchAutocompleteService,
		} = require("src/services/obsidian/user-data/search-autocomplete-service");

		const setting = JSON.parse(JSON.stringify(DEFAULT_OUTER_SETTING));
		const app = new App();
		app.commands = {
			commands: {
				"app:open": { id: "app:open", name: "Open file" },
				"app:new": { id: "app:new", name: "New note" },
			},
		};
		app.plugins = {
			plugins: {
				app: { manifest: { name: "Obsidian" } },
			},
		};
		app.metadataCache = {
			on: jest.fn(() => ({})),
			getFileCache: jest.fn(() => null),
		};
		app.workspace = {
			getLastOpenFiles: jest.fn(() => []),
		};
		const vault = new Vault();
		vault.on = jest.fn(() => ({}));
		const plugin = {
			registerEvent: jest.fn(),
		};
		const dataProvider = {
			allFilesToBeIndexed: jest.fn(() => []),
			getFileByPath: jest.fn(() => null),
			isIndexable: jest.fn(() => false),
		};
		const searchHistoryService = {
			getNavigationHabitSignals: jest.fn(() => new Map()),
			getQuickCommandHabitSignals: jest.fn(() => new Map()),
			getRecentNavigationSelections: jest.fn(() => []),
			getRecentQuickCommandSelections: jest.fn(() => [
				{
					queryText: "",
					path: "removed:command",
					openLinkText: "removed:command",
					primaryText: "Removed Command",
					kind: "quickCommand",
					timestamp: 3000,
				},
				{
					queryText: "",
					path: "app:open",
					openLinkText: "app:open",
					primaryText: "Old Open Label",
					kind: "quickCommand",
					timestamp: 2000,
				},
			]),
		};

		container.register(OuterSetting, { useValue: setting });
		container.register(THIS_PLUGIN, { useValue: plugin });
		container.register(App, { useValue: app });
		container.register(Vault, { useValue: vault });
		container.register(DataProvider, { useValue: dataProvider });
		container.register(SearchHistoryService, { useValue: searchHistoryService });

		return {
			app,
			service: container.resolve(SearchAutocompleteService) as any,
		};
	}

	test("filters stale recent QuickCommand history against the live command registry", () => {
		const { service } = createServiceHarness();

		const suggestions = service.getQuickCommandSuggestions("", 24);

		expect(suggestions.map((candidate: any) => candidate.openLinkText)).toEqual([
			"app:open",
		]);
		expect(suggestions[0]).toMatchObject({
			primaryText: "Open file",
			path: "app:open",
		});
	});

	test("refreshes QuickCommand candidates from the live command registry", () => {
		const { app, service } = createServiceHarness();

		expect(
			service
				.getQuickCommandSuggestions("beta", 24)
				.map((candidate: any) => candidate.openLinkText),
		).toEqual([]);

		app.commands.commands["plugin:beta"] = {
			id: "plugin:beta",
			name: "Beta Action",
		};

		expect(
			service
				.getQuickCommandSuggestions("beta", 24)
				.map((candidate: any) => candidate.openLinkText),
		).toEqual(["plugin:beta"]);
	});

	test("orders QuickCommand memory by recency before old high-frequency selections", () => {
		const { service } = createServiceHarness();
		const searchHistoryService = service.searchHistoryService;
		searchHistoryService.getRecentQuickCommandSelections = jest.fn(() => [
			{
				queryText: "",
				path: "app:open",
				openLinkText: "app:open",
				primaryText: "Open file",
				kind: "quickCommand",
				timestamp: 1_000,
			},
			{
				queryText: "",
				path: "app:new",
				openLinkText: "app:new",
				primaryText: "New note",
				kind: "quickCommand",
				timestamp: 10_000,
			},
		]);
		searchHistoryService.getQuickCommandHabitSignals = jest.fn(() =>
			new Map([
				[
					"app:new",
					{
						querySelectionCount: 1,
						totalSelectionCount: 1,
						recentDayCount: 1,
						dayStreak: 1,
						lastTimestamp: 10_000,
						queryLastTimestamp: 0,
					},
				],
				[
					"app:open",
					{
						querySelectionCount: 99,
						totalSelectionCount: 99,
						recentDayCount: 7,
						dayStreak: 7,
						lastTimestamp: 1_000,
						queryLastTimestamp: 0,
					},
				],
			]),
		);
		jest.spyOn(Date, "now").mockReturnValue(10_000);

		const suggestions = service.getQuickCommandSuggestions("", 24);

		expect(suggestions.map((candidate: any) => candidate.openLinkText)).toEqual([
			"app:new",
			"app:open",
		]);
	});

});
