// @ts-nocheck
import { container } from "tsyringe";

jest.mock("obsidian", () => {
	class TAbstractFile {
		path: string;
		name: string;

		constructor(path: string) {
			this.path = path;
			this.name = path.split("/").pop() ?? path;
		}
	}

	class TFile extends TAbstractFile {
		stat = { mtime: 1, size: 1 };
		basename: string;
		extension: string;

		constructor(path: string) {
			super(path);
			const dotIndex = this.name.lastIndexOf(".");
			this.basename = dotIndex >= 0 ? this.name.slice(0, dotIndex) : this.name;
			this.extension = dotIndex >= 0 ? this.name.slice(dotIndex + 1) : "";
		}
	}

	return {
		App: class App {},
		TAbstractFile,
		TFile,
		TFolder: class TFolder extends TAbstractFile {},
		Vault: class Vault {},
		parseFrontMatterAliases: jest.fn(() => []),
	};
});

jest.mock("src/services/obsidian/private-api", () => ({
	PrivateApi: class PrivateApi {},
}));

jest.mock("src/services/obsidian/view-registry", () => ({
	ViewRegistry: class ViewRegistry {},
	ViewType: {
		UNSUPPORTED: "unsupported",
		MARKDOWN: "markdown",
	},
}));

jest.mock("src/services/search/shared/file-snapshot-store", () => ({
	FileSnapshotStore: class FileSnapshotStore {},
}));

import { App, TFile, Vault } from "obsidian";
import {
	DEFAULT_OUTER_SETTING,
	OuterSetting,
} from "src/globals/plugin-setting";
import { DataProvider } from "src/services/obsidian/user-data/data-provider";
import { PrivateApi } from "src/services/obsidian/private-api";
import { ViewRegistry } from "src/services/obsidian/view-registry";
import { FileSnapshotStore } from "src/services/search/shared/file-snapshot-store";

describe("DataProvider extension filtering", () => {
	beforeEach(() => {
		if ("reset" in container && typeof container.reset === "function") {
			container.reset();
		} else {
			container.clearInstances();
		}
	});

	function createProvider(extensions = ["md"]) {
		const setting = JSON.parse(JSON.stringify(DEFAULT_OUTER_SETTING));
		setting.customExtensions.plaintext = extensions;
		const files = [
			new TFile("notes/readme.md"),
			new TFile("notes/readme.txt"),
			new TFile("notes/data.json"),
			new TFile("notes/UPPER.MD"),
		];
		const vault = new Vault();
		vault.getFiles = jest.fn(() => files);
		const app = new App();
		const privateApi = { isNotObsidianExcludedPath: jest.fn(() => true) };
		const viewRegistry = { viewTypeByPath: jest.fn(() => "markdown") };

		container.register(OuterSetting, { useValue: setting });
		container.register(App, { useValue: app });
		container.register(Vault, { useValue: vault });
		container.register(PrivateApi, { useValue: privateApi });
		container.register(ViewRegistry, { useValue: viewRegistry });
		container.register(FileSnapshotStore, { useValue: {} });

		return { provider: container.resolve(DataProvider), files };
	}

	test("uses markdown as the default and excludes other file extensions", () => {
		const { provider } = createProvider();

		expect(provider.allFilesToBeIndexed().map((file) => file.path)).toEqual([
			"notes/readme.md",
			"notes/UPPER.MD",
		]);
	});

	test("honors configured extensions after normalizing dots, whitespace, and case", () => {
		const { provider } = createProvider([" .TXT ", "MD"]);

		expect(provider.allFilesToBeIndexed().map((file) => file.path)).toEqual([
			"notes/readme.md",
			"notes/readme.txt",
			"notes/UPPER.MD",
		]);
	});
});
