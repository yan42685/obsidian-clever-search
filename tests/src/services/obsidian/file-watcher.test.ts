const mockInstanceMap = new Map<any, any>();

jest.mock("obsidian", () => {
	class TAbstractFile {
		path: string;

		constructor(mockPath: string) {
			this.path = mockPath;
		}
	}

	class TFile extends TAbstractFile {
		stat: { mtime: number; size: number };

		constructor(mockPath: string, mtime: number) {
			super(mockPath);
			this.stat = { mtime, size: 1 };
		}
	}

	class TFolder extends TAbstractFile {
		children: Array<TFile | TFolder> = [];
	}

	return {
		App: class App {},
		TAbstractFile,
		TFile,
		TFolder,
	};
});

jest.mock("src/utils/my-lib", () => ({
	getInstance: jest.fn((token: unknown) => {
		if (!mockInstanceMap.has(token)) {
			throw new Error(`Missing test instance for token: ${String(token)}`);
		}
		return mockInstanceMap.get(token);
	}),
}));

jest.mock("src/services/obsidian/user-data/data-manager", () => ({
	DataManager: class DataManager {},
}));

jest.mock("src/services/obsidian/user-data/data-provider", () => ({
	DataProvider: class DataProvider {},
}));

jest.mock("src/services/search/shared/file-snapshot-store", () => ({
	FileSnapshotStore: class FileSnapshotStore {},
}));

import { App, TFile, TFolder } from "obsidian";
import { DataManager } from "src/services/obsidian/user-data/data-manager";
import type { DocMoveOperation } from "src/services/obsidian/user-data/doc-operation-buffer";
import { DataProvider } from "src/services/obsidian/user-data/data-provider";
import { FileWatcher } from "src/services/obsidian/user-data/file-watcher";
import { FileSnapshotStore } from "src/services/search/shared/file-snapshot-store";

describe("FileWatcher", () => {
	test("records folder rename moves synchronously in descendant order", async () => {
		const handlers = new Map<string, (...args: any[]) => unknown>();
		const vault = {
			on: jest.fn((event: string, callback: (...args: any[]) => unknown) => {
				handlers.set(event, callback);
			}),
			off: jest.fn(),
			getAbstractFileByPath: jest.fn(),
		};
		const dataManager = {
			receiveDocOperation: jest.fn(),
		};
		const fileSnapshotStore = {
			readCurrentTexts: jest.fn(async () => new Map()),
		};
		const dataProvider = {
			isIndexable: jest.fn(() => true),
		};
		mockInstanceMap.set(App, { vault });
		mockInstanceMap.set(DataManager, dataManager);
		mockInstanceMap.set(DataProvider, dataProvider);
		mockInstanceMap.set(FileSnapshotStore, fileSnapshotStore);

		const createFolder = (path: string) =>
			Object.assign(Object.create(TFolder.prototype), { path, children: [] }) as TFolder;
		const createFile = (path: string, mtime: number) =>
			Object.assign(Object.create(TFile.prototype), {
				path,
				stat: { mtime, size: 1 },
			}) as TFile;
		const root = createFolder("archive");
		const directFile = createFile("archive/direct.md", 200);
		const nested = createFolder("archive/nested");
		const nestedFile = createFile("archive/nested/deep.md", 300);
		nested.children.push(nestedFile);
		root.children.push(directFile, nested);

		const watcher = new FileWatcher();
		watcher.start();
		watcher.start();
		await handlers.get("rename")?.(root, "notes");

		expect(vault.on).toHaveBeenCalledTimes(4);
		expect(fileSnapshotStore.readCurrentTexts).not.toHaveBeenCalled();
		expect(dataManager.receiveDocOperation).toHaveBeenCalledTimes(2);
		const operations = dataManager.receiveDocOperation.mock.calls.map(
			([operation]) => operation,
		);
		expect(operations).toEqual([
			expect.objectContaining<Partial<DocMoveOperation>>({
				oldPath: "notes/direct.md",
				path: "archive/direct.md",
				sourceGeneration: 200,
			}),
			expect.objectContaining<Partial<DocMoveOperation>>({
				oldPath: "notes/nested/deep.md",
				path: "archive/nested/deep.md",
				sourceGeneration: 300,
			}),
		]);
	});

	test("records rapid consecutive file renames in event order", async () => {
		const handlers = new Map<string, (...args: any[]) => unknown>();
		const vault = {
			on: jest.fn((event: string, callback: (...args: any[]) => unknown) => {
				handlers.set(event, callback);
			}),
			off: jest.fn(),
		};
		const dataManager = { receiveDocOperation: jest.fn() };
		const fileSnapshotStore = { readCurrentTexts: jest.fn() };
		const dataProvider = { isIndexable: jest.fn(() => true) };
		mockInstanceMap.set(App, { vault });
		mockInstanceMap.set(DataManager, dataManager);
		mockInstanceMap.set(DataProvider, dataProvider);
		mockInstanceMap.set(FileSnapshotStore, fileSnapshotStore);

		const file = Object.assign(Object.create(TFile.prototype), {
			path: "notes/a.md",
			stat: { mtime: 500, size: 1 },
		}) as TFile;
		const watcher = new FileWatcher();
		watcher.start();
		const onRename = handlers.get("rename");

		file.path = "notes/b.md";
		void onRename?.(file, "notes/a.md");
		file.path = "notes/c.md";
		void onRename?.(file, "notes/b.md");

		expect(dataManager.receiveDocOperation.mock.calls.map(([operation]) => operation)).toEqual([
			expect.objectContaining({ oldPath: "notes/a.md", path: "notes/b.md" }),
			expect.objectContaining({ oldPath: "notes/b.md", path: "notes/c.md" }),
		]);
		expect(fileSnapshotStore.readCurrentTexts).not.toHaveBeenCalled();
	});

	test("does not read non-indexable files before enqueueing cleanup", async () => {
		const handlers = new Map<string, (...args: any[]) => unknown>();
		const file = Object.assign(Object.create(TFile.prototype), {
			path: "attachments/archive.zip",
			stat: { mtime: 400, size: 16_600_000_000 },
		}) as TFile;
		const vault = {
			on: jest.fn((event: string, callback: (...args: any[]) => unknown) => {
				handlers.set(event, callback);
			}),
			off: jest.fn(),
			getAbstractFileByPath: jest.fn(() => file),
		};
		const dataManager = {
			receiveDocOperation: jest.fn(),
		};
		const dataProvider = {
			isIndexable: jest.fn(() => false),
		};
		const fileSnapshotStore = {
			readCurrentTexts: jest.fn(async () => new Map()),
		};
		mockInstanceMap.set(App, { vault });
		mockInstanceMap.set(DataManager, dataManager);
		mockInstanceMap.set(DataProvider, dataProvider);
		mockInstanceMap.set(FileSnapshotStore, fileSnapshotStore);

		const watcher = new FileWatcher();
		watcher.start();
		handlers.get("create")?.(file);

		expect(fileSnapshotStore.readCurrentTexts).not.toHaveBeenCalled();
		expect(dataManager.receiveDocOperation).toHaveBeenCalledWith(
			expect.objectContaining({ path: file.path }),
		);
	});
});
