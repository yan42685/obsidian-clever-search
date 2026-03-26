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
		stat: { mtime: number; size: number };
		basename: string;
		extension: string;

		constructor(path: string, text = "", mtime = Date.now()) {
			super(path);
			this.stat = {
				mtime,
				size: Buffer.byteLength(text, "utf8"),
			};
			const dotIndex = this.name.lastIndexOf(".");
			this.basename = dotIndex >= 0 ? this.name.slice(0, dotIndex) : this.name;
			this.extension = dotIndex >= 0 ? this.name.slice(dotIndex + 1) : "";
		}
	}

	return {
		TAbstractFile,
		TFile,
		Vault: class Vault {},
		Notice: class Notice {
			constructor(_message?: string, _timeout?: number) {}
		},
		htmlToMarkdown(text: string) {
			return text;
		},
	};
});

jest.mock("src/services/obsidian/transformed-api", () => {
	class MockNotice {
		static messages: string[] = [];

		constructor(text: string) {
			MockNotice.messages.push(text);
		}

		setText(text: string) {
			MockNotice.messages.push(text);
			return this;
		}

		hide() {}

		static clear() {
			MockNotice.messages = [];
		}
	}

	return {
		MyNotice: MockNotice,
	};
});

jest.mock("src/globals/plugin-setting", () => {
	class OuterSetting {}

	return {
		OuterSetting,
		DEFAULT_OUTER_SETTING: {
			customExtensions: { plaintext: ["md"] },
			fileSearchBackend: "passage-bm25",
			isCaseSensitive: false,
			enableChinesePatch: false,
			enableStopWordsEn: false,
			enableStopWordsZh: false,
			ui: {
				maxItemResults: 10,
			},
			hybrid: {
				enabled: false,
				vectorCompression: "int8",
				maxResultCount: 10,
				excludedPaths: [],
				indexConcurrency: 3,
				highPerformanceMaxMb: 60,
				minIncrementalEmbedIntervalSec: 60,
				failedEmbeddingRetryIntervalMin: 10,
			},
		},
	};
});

jest.mock("src/services/database/database", () => ({
	Database: class Database {},
}));

jest.mock("src/services/obsidian/user-data/data-provider", () => ({
	DataProvider: class DataProvider {},
}));

jest.mock("src/services/search/lexical-engine", () => ({
	LexicalEngine: class LexicalEngine {},
}));

jest.mock("src/services/search/shared/file-snapshot-store", () => ({
	FileSnapshotStore: class FileSnapshotStore {},
}));

jest.mock("src/services/obsidian/search-service", () => ({
	SearchService: class SearchService {},
}));

jest.mock("src/services/obsidian/user-data/file-watcher", () => ({
	FileWatcher: class FileWatcher {},
}));

jest.mock("src/services/obsidian/translations/locale-helper", () => ({
	t(key: string) {
		return key;
	},
}));

jest.mock("src/services/search/hybrid/bm25", () => ({
	BM25Engine: class BM25Engine {
		clear() {}
		addDocument() {}
		serialize() {
			return {};
		}
	},
}));

import { THIS_PLUGIN } from "src/globals/constants";
import type { TFile } from "obsidian";
import type { OuterSetting as OuterSettingType } from "src/globals/plugin-setting";
import { Database } from "src/services/database/database";
import { SearchService } from "src/services/obsidian/search-service";
import {
	DataManager,
} from "src/services/obsidian/user-data/data-manager";
import { DataProvider } from "src/services/obsidian/user-data/data-provider";
import {
	DocMoveOperation,
	DocUpsertOperation,
} from "src/services/obsidian/user-data/doc-operation-buffer";
import { FileWatcher } from "src/services/obsidian/user-data/file-watcher";
import { LexicalEngine } from "src/services/search/lexical-engine";
import { FileSnapshotStore } from "src/services/search/shared/file-snapshot-store";

const { MyNotice } = jest.requireMock(
	"src/services/obsidian/transformed-api",
) as {
	MyNotice: { messages: string[]; clear(): void };
};
const { TFile: MockTFile } = jest.requireMock("obsidian") as {
	TFile: new (path: string, text?: string, mtime?: number) => TFile;
};

type MockFileSnapshotStore = ReturnType<typeof createMockFileSnapshotStore>;
type MockHybridEngine = ReturnType<typeof createMockHybridEngine>;
type MockDatabase = ReturnType<typeof createMockDatabase>;
type MockDataProvider = ReturnType<typeof createMockDataProvider>;
type MockLexicalEngine = ReturnType<typeof createMockLexicalEngine>;

function cloneSetting(): OuterSettingType {
	const { DEFAULT_OUTER_SETTING } =
		require("src/globals/plugin-setting") as typeof import("src/globals/plugin-setting");
	return JSON.parse(JSON.stringify(DEFAULT_OUTER_SETTING)) as OuterSettingType;
}

function createFile(path: string, text: string, mtime: number): TFile {
	return new MockTFile(path, text, mtime);
}

function createMockFileSnapshotStore() {
	const current = new Map<string, { text: string; generation?: number }>();
	const persisted = new Map<string, { text: string; generation?: number }>();

	return {
		current,
		persisted,
		clearCurrentFiles: jest.fn(() => {
			current.clear();
		}),
		invalidateCurrentFile: jest.fn((path: string) => {
			current.delete(path);
		}),
		setCurrentFileText: jest.fn(
			(path: string, text: string, generation?: number) => {
				current.set(path, { text, generation });
				return text;
			},
		),
		peekCurrentFileText: jest.fn((path: string) => current.get(path)?.text),
		commitCurrentFileAsIndexed: jest.fn(
			async (path: string, generation?: number) => {
				const currentEntry = current.get(path);
				if (!currentEntry) {
					return;
				}
				persisted.set(path, {
					text: currentEntry.text,
					generation: generation ?? currentEntry.generation,
				});
			},
		),
		commitCurrentFilesAsIndexed: jest.fn(
			async (files: ReadonlyArray<{ path: string; generation?: number }>) => {
				for (const file of files) {
					const currentEntry = current.get(file.path);
					if (!currentEntry) {
						continue;
					}
					persisted.set(file.path, {
						text: currentEntry.text,
						generation: file.generation ?? currentEntry.generation,
					});
				}
			},
		),
		deleteIndexedSnapshot: jest.fn(async (path: string) => {
			persisted.delete(path);
		}),
		deleteIndexedSnapshots: jest.fn(async (paths: readonly string[]) => {
			for (const path of paths) {
				persisted.delete(path);
			}
		}),
		getIndexedSnapshotTexts: jest.fn(async (paths: string[]) => {
			const result = new Map<string, string>();
			for (const path of paths) {
				const entry = persisted.get(path);
				if (entry) {
					result.set(path, entry.text);
				}
			}
			return result;
		}),
		refreshHighPerformanceState: jest.fn(async () => {}),
	};
}

function createMockHybridEngine(overrides: Record<string, unknown> = {}) {
	return {
		isEnabled: jest.fn(() => true),
		shouldIndexPath: jest.fn(() => true),
		moveFile: jest.fn(async () => true),
		deleteFile: jest.fn(async () => {}),
		canSearch: jest.fn(() => false),
		migrateBm25StorageFormatIfNeeded: jest.fn(async () => false),
		persistIndicesForBatch: jest.fn(async () => {}),
		...overrides,
	};
}

function createMockDatabase(overrides: Record<string, unknown> = {}) {
	return {
		deleteOldDatabases: jest.fn(async () => {}),
		getLexicalSearchSnapshot: jest.fn(async () => null),
		deleteLexicalSearchSnapshot: jest.fn(async () => {}),
		setLexicalSearchSnapshot: jest.fn(async () => {}),
		getLexicalIndexedFileRefs: jest.fn(async () => []),
		setLexicalIndexedFileRefs: jest.fn(async () => {}),
		estimatePluginStorageUsage: jest.fn(async () => ({
			totalBytes: 0,
			tables: [],
		})),
		db: {},
		...overrides,
	};
}

function createMockLexicalEngine(overrides: Record<string, unknown> = {}) {
	return {
		addDocuments: jest.fn(async () => {}),
		deleteDocuments: jest.fn(() => {}),
		beginBatchReindex: jest.fn(() => {}),
		finishBatchReindex: jest.fn(() => {}),
		abortBatchReindex: jest.fn(() => {}),
		supportsSerializedFileIndex: jest.fn(() => true),
		reIndexAll: jest.fn(async () => true),
		serializeFileIndex: jest.fn(() => null),
		estimateFileIndexBytes: jest.fn(() => 0),
		getFileIndexBreakdown: jest.fn(() => null),
		...overrides,
	};
}

function createMockDataProvider(params: {
	files: Map<string, TFile>;
	texts: Map<string, string>;
}) {
	const { files, texts } = params;
	return {
		files,
		texts,
		isIndexable: jest.fn((fileOrPath: TFile | string) => {
			const path = typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
			return path.endsWith(".md");
		}),
		getFileByPath: jest.fn((path: string) => files.get(path) ?? null),
		readPlainText: jest.fn(async (fileOrPath: TFile | string) => {
			const path = typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
			return texts.get(path) ?? "";
		}),
		generateAllIndexedDocuments: jest.fn(async (inputFiles: TFile[]) => {
			return inputFiles.map((file) => ({
				path: file.path,
				basename: file.basename,
				folder: file.path.includes("/")
					? file.path.slice(0, file.path.lastIndexOf("/"))
					: "",
				content: texts.get(file.path) ?? "",
				aliases: "",
				tags: "",
				headings: "",
			}));
		}),
		allFilesToBeIndexed: jest.fn(() => Array.from(files.values())),
		getHeadingOutlineForText: jest.fn(() => []),
	};
}

function registerDataManagerDeps(params: {
	setting: OuterSettingType;
	pluginFiles: TFile[];
	database: MockDatabase;
	dataProvider: MockDataProvider;
	lexicalEngine: MockLexicalEngine;
	fileSnapshotStore: MockFileSnapshotStore;
	hybridEngine: MockHybridEngine;
}) {
	const plugin = {
		app: {
			vault: {
				getFiles: () => params.pluginFiles,
			},
		},
	};
	const fileWatcher = {
		start: jest.fn(),
		stop: jest.fn(),
	};
	const { OuterSetting } =
		require("src/globals/plugin-setting") as typeof import("src/globals/plugin-setting");

	container.registerInstance(THIS_PLUGIN, plugin as any);
	container.registerInstance(OuterSetting, params.setting as any);
	container.registerInstance(Database, params.database as any);
	container.registerInstance(DataProvider, params.dataProvider as any);
	container.registerInstance(LexicalEngine, params.lexicalEngine as any);
	container.registerInstance(FileSnapshotStore, params.fileSnapshotStore as any);
	container.registerInstance(SearchService, {
		hybridEngine: params.hybridEngine,
	} as any);
	container.registerInstance(FileWatcher, fileWatcher as any);

	return { plugin, fileWatcher };
}

describe("DataManager integration", () => {
	beforeEach(() => {
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
		MyNotice.clear();
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "zh"),
			},
		};
	});

	afterEach(() => {
		delete (global as any).window;
		jest.restoreAllMocks();
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
		MyNotice.clear();
	});

	test("coalesces rename plus modify burst into the final new-path lexical and snapshot state", async () => {
		const setting = cloneSetting();
		setting.hybrid.enabled = true;

		const oldPath = "docs/old.md";
		const newPath = "archive/old.md";
		const newText = "latest moved content";
		const newFile = createFile(newPath, newText, 220);
		const files = new Map([[newPath, newFile]]);
		const texts = new Map([[newPath, newText]]);

		const database = createMockDatabase();
		const dataProvider = createMockDataProvider({ files, texts });
		const lexicalEngine = createMockLexicalEngine();
		const fileSnapshotStore = createMockFileSnapshotStore();
		fileSnapshotStore.persisted.set(oldPath, {
			text: "old content",
			generation: 180,
		});
		const hybridEngine = createMockHybridEngine();

		registerDataManagerDeps({
			setting,
			pluginFiles: [newFile],
			database,
			dataProvider,
			lexicalEngine,
			fileSnapshotStore,
			hybridEngine,
		});

		const manager = container.resolve(DataManager);
		(manager as any).scheduleHybridRepairFlush = jest.fn();
		manager.receiveDocOperation(new DocMoveOperation(oldPath, newPath, 180));
		manager.receiveDocOperation(new DocUpsertOperation(newPath, 220));
		await (manager as any).docOperationsBuffer.forceFlush();

		expect(lexicalEngine.deleteDocuments).toHaveBeenCalledWith([oldPath]);
		expect(lexicalEngine.addDocuments).toHaveBeenCalledWith([
			expect.objectContaining({
				path: newPath,
				content: newText,
			}),
		]);
		expect(fileSnapshotStore.persisted.has(oldPath)).toBe(false);
		expect(fileSnapshotStore.persisted.get(newPath)).toEqual({
			text: newText,
			generation: 220,
		});
		expect(hybridEngine.moveFile).toHaveBeenCalledWith(oldPath, newPath, 220);
		expect(hybridEngine.deleteFile).not.toHaveBeenCalledWith(oldPath);
		const queuedRepair = (manager as any).hybridRepairQueue.get(newPath);
		expect(queuedRepair).toMatchObject({
			path: newPath,
			mode: "incremental",
			reason: "runtime-incremental-edit",
			sourceGeneration: 220,
		});
	});

	test("restores lexical startup state from lexical snapshots and reports persisted versus runtime storage clearly", async () => {
		const setting = cloneSetting();
		setting.fileSearchBackend = "passage-bm25";
		setting.hybrid.enabled = false;
		setting.hybrid.vectorCompression = "int8";

		const file = createFile("docs/a.md", "alpha body", 100);
		const files = new Map([[file.path, file]]);
		const texts = new Map([[file.path, "alpha body"]]);
		const lexicalSnapshot = {
			__backend: "passage-bm25" as const,
			__version: 2 as const,
			__format: "structural-snapshot" as const,
			documents: [],
		};
		const database = createMockDatabase({
			getLexicalSearchSnapshot: jest.fn(async () => lexicalSnapshot),
			estimatePluginStorageUsage: jest.fn(async () => ({
				totalBytes: 126370,
				tables: [
					{ name: "lexicalSearchSnapshots", rows: 1, bytes: 3559 },
					{ name: "fileSnapshots", rows: 14, bytes: 71257 },
					{ name: "hybridChunkVectors", rows: 9, bytes: 36507 },
					{ name: "hybridChunks", rows: 68, bytes: 12211 },
					{ name: "hybridIndexedFileRefs", rows: 9, bytes: 1804 },
					{ name: "lexicalIndexedFileRefs", rows: 14, bytes: 1032 },
					{ name: "pluginSetting", rows: 0, bytes: 0 },
					{ name: "hybridBm25Index", rows: 0, bytes: 0 },
					{ name: "hybridHnswSmall", rows: 0, bytes: 0 },
					{ name: "hybridTokenSavings", rows: 0, bytes: 0 },
				],
			})),
		});
		const dataProvider = createMockDataProvider({ files, texts });
		const lexicalEngine = createMockLexicalEngine({
			reIndexAll: jest.fn(async () => true),
			serializeFileIndex: jest.fn(() => lexicalSnapshot),
			estimateFileIndexBytes: jest.fn(() => 80258),
			getFileIndexBreakdown: jest.fn(() => ({
				estimatedBytes: { total: 80258 },
			})),
		});
		const fileSnapshotStore = createMockFileSnapshotStore();
		const hybridEngine = createMockHybridEngine({
			isEnabled: jest.fn(() => false),
		});

		const { fileWatcher } = registerDataManagerDeps({
			setting,
			pluginFiles: [file],
			database,
			dataProvider,
			lexicalEngine,
			fileSnapshotStore,
			hybridEngine,
		});

		const manager = container.resolve(DataManager);
		(manager as any).isLexicalEngineUpToDate = true;

		await manager.initAsync();
		await (manager as any).searchBootstrapCommitTask;

		expect(database.getLexicalSearchSnapshot).toHaveBeenCalled();
		expect(database.deleteLexicalSearchSnapshot).toHaveBeenCalled();
		expect(lexicalEngine.reIndexAll).toHaveBeenCalledWith(lexicalSnapshot);
		expect(database.setLexicalSearchSnapshot).toHaveBeenCalledWith(lexicalSnapshot);
		expect(fileWatcher.start).toHaveBeenCalled();

		const tableSpy = jest.spyOn(console, "table").mockImplementation(() => {});
		const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
		const groupSpy = jest.spyOn(console, "groupCollapsed").mockImplementation(() => {});
		const endSpy = jest.spyOn(console, "groupEnd").mockImplementation(() => {});

		await (manager as any).noticeDevStorageStats();

		expect(groupSpy).toHaveBeenCalled();
		expect(endSpy).toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalled();
		const latestNotice = MyNotice.messages[MyNotice.messages.length - 1];
		expect(latestNotice).toContain("持久化插件存储");
		expect(latestNotice).toContain("LexicalSnapshot(passage-bm25 persisted)");
		expect(latestNotice).toContain("LexicalRuntimeIndex(passage-bm25 estimated)");
		expect(latestNotice).toContain("不计入上面的持久化总量");

		const tableRows = tableSpy.mock.calls.flatMap((call) =>
			Array.isArray(call[0]) ? call[0] : [],
		);
		expect(tableRows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					scope: "persisted",
					table: "LexicalSnapshot(passage-bm25 persisted)",
					bytes: 3559,
				}),
				expect.objectContaining({
					scope: "persisted",
					table: "SharedFileSnapshot",
					bytes: 71257,
				}),
				expect.objectContaining({
					scope: "runtime-estimate",
					table: "LexicalRuntimeIndex(passage-bm25 estimated)",
					bytes: 80258,
				}),
			]),
		);
	});
});
