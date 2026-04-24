import "fake-indexeddb/auto";

import Dexie from "dexie";
import { Database, DexieWrapper } from "src/services/database/database";

function createUpgradeError(message = "Not yet support for changing primary key") {
  const error = new Error(message) as Error & { name: string };
  error.name = "UpgradeError";
  return error;
}

describe("Database Dexie upgrade recovery", () => {
  const createdDbNames: string[] = [];
  let consoleWarnSpy: jest.SpyInstance;
  const createDatabaseHarness = (appId: string) => {
    const database = Object.create(Database.prototype) as Database & {
      db: DexieWrapper;
    };
    database.db = new DexieWrapper({
      getAppId: () => appId,
    } as any);
    return database;
  };

  beforeEach(() => {
    (Database as unknown as { attemptedUpgradeRecoveryKeys: Set<string> })
      .attemptedUpgradeRecoveryKeys.clear();
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleWarnSpy.mockRestore();
    while (createdDbNames.length > 0) {
      const name = createdDbNames.pop();
      if (!name) {
        continue;
      }
      await Dexie.delete(name);
    }
  });

  test("upgrades the old lexical evidence primary keys through the 28.3 bridge", async () => {
    const appId = `db-upgrade-${Date.now()}`;
    const dbName = `clever-search/${appId}`;
    createdDbNames.push(dbName);

    const legacyDb = new Dexie(dbName);
    legacyDb.version(28.2).stores({
      pluginSetting: "++id",
      lexicalSearchSnapshots: "++id",
      lexicalIndexedFileRefs: "path",
      lexicalIndexedMetadata: "filePath",
      lexicalFuzzyRescue: "id",
      lexicalBodyFamilySupport: "id",
      lexicalBodyEvidence: "blockId",
      lexicalHanDocEvidence: "docId",
      lexicalHanBodyEvidence: "blockId",
      lexicalExactTapes: "id",
      lexicalHanWitness: "id",
      docRegistry: "docRef, path, deleted, liveGeneration, updatedAt",
      docRegistryMeta: "key",
      hybridChunks: "++id, filePath",
      fileSnapshots: "filePath",
      hybridDirtyShadows: "filePath",
      hybridChunkVectors: "filePath",
      hybridHnswSmall: "id",
      hybridIndexedFileRefs: "path",
      indexRecoveryState: "id, engine, path, state, nextRetryAt, [engine+path]",
      indexArtifactState: "id, engine, artifact, dirtyAt, [engine+artifact]",
      hybridTokenStats: "++id, filePath, dateKey, [filePath+dateKey]",
      hybridTokenSavings: "++id, scope, periodKey, [scope+periodKey]",
      hybridTokenBudgetResets: "++id, periodKey",
    });
    await legacyDb.open();
    await legacyDb.table("lexicalBodyEvidence").put({
      blockId: "block-1",
      docRef: 1,
      generation: 1,
    });
    await legacyDb.table("lexicalHanDocEvidence").put({
      docId: "doc-1",
      docRef: 1,
      generation: 1,
    });
    await legacyDb.table("lexicalHanBodyEvidence").put({
      blockId: "block-1",
      docRef: 1,
      generation: 1,
    });
    await legacyDb.table("hybridTokenStats").add({
      filePath: "notes/alpha.md",
      dateKey: "2026-04-24",
      inputTokens: 42,
      outputTokens: 7,
      totalTokens: 49,
      model: "test-model",
    } as any);
    legacyDb.close();

    const database = createDatabaseHarness(appId);

    const report = await database.openAndConsumeSchemaUpgradeReport();

    expect(report).toEqual({
      schemaUpgradeDetected: true,
      recovery: null,
    });
    await expect(database.db.lexicalBodyEvidence.count()).resolves.toBe(0);
    await expect(database.db.lexicalHanDocEvidence.count()).resolves.toBe(0);
    await expect(database.db.lexicalHanBodyEvidence.count()).resolves.toBe(0);
    await expect(database.db.hybridTokenStats.count()).resolves.toBe(1);

    database.db.close();
  });

  test("targeted index reset clears lexical and hybrid index state while preserving settings and token stats", async () => {
    const appId = `db-targeted-${Date.now()}`;
    const dbName = `clever-search/${appId}`;
    createdDbNames.push(dbName);
    const database = createDatabaseHarness(appId);
    await database.openAndConsumeSchemaUpgradeReport();

    await database.db.pluginSetting.add({
      data: { keep: true } as any,
    });
    await database.db.hybridTokenStats.add({
      filePath: "notes/alpha.md",
      dateKey: "2026-04-24",
      inputTokens: 42,
      outputTokens: 7,
      totalTokens: 49,
      model: "test-model",
    } as any);
    await database.db.lexicalSearchSnapshots.add({
      data: { documentCount: 1 } as any,
    });
    await database.db.docRegistry.put({
      docRef: 1,
      path: "notes/alpha.md",
      deleted: false,
      liveGeneration: 1,
      updatedAt: Date.now(),
    });
    await database.db.docRegistryMeta.put({
      key: "nextDocRef",
      value: 2,
    });
    await database.db.docRegistryMeta.put({
      key: "lexicalQueryEvidenceReady",
      value: 2,
    });
    await database.db.hybridChunks.add({
      filePath: "notes/alpha.md",
      chunkIndex: 0,
      startOffset: 0,
      endOffset: 10,
      startLine: 1,
      startCol: 1,
      endLine: 1,
      endCol: 10,
      embedKey: "chunk-1",
      text: "alpha beta",
    } as any);

    await (database as any).resetTargetedPersistentIndexState();

    await expect(database.db.lexicalSearchSnapshots.count()).resolves.toBe(0);
    await expect(database.db.docRegistry.count()).resolves.toBe(0);
    await expect(database.db.hybridChunks.count()).resolves.toBe(0);
    await expect(database.db.pluginSetting.count()).resolves.toBe(1);
    await expect(database.db.hybridTokenStats.count()).resolves.toBe(1);
    await expect(database.db.docRegistryMeta.get("nextDocRef")).resolves.toBeUndefined();
    await expect(
      database.db.docRegistryMeta.get("lexicalQueryEvidenceReady"),
    ).resolves.toBeUndefined();

    database.db.close();
  });

  test("returns a targeted-reset recovery report when the retry succeeds after clearing index state", async () => {
    const open = jest
      .fn()
      .mockRejectedValueOnce(createUpgradeError())
      .mockResolvedValueOnce(undefined);
    const consumeSchemaUpgradeDetected = jest.fn(() => false);
    const database = Object.create(Database.prototype) as Database & {
      db: {
        open: jest.Mock;
        close: jest.Mock;
        dbName: string;
        dbVersion: number;
        consumeSchemaUpgradeDetected: jest.Mock;
      };
      resetTargetedPersistentIndexState: jest.Mock;
      deleteDatabaseByName: jest.Mock;
    };
    database.db = {
      open,
      close: jest.fn(),
      dbName: "clever-search/stub-targeted",
      dbVersion: 28.4,
      consumeSchemaUpgradeDetected,
    };
    database.resetTargetedPersistentIndexState = jest.fn(async () => {});
    database.deleteDatabaseByName = jest.fn(async () => {});

    const report = await database.openAndConsumeSchemaUpgradeReport();

    expect(report).toEqual({
      schemaUpgradeDetected: true,
      recovery: {
        mode: "targeted-reset",
        dbName: "clever-search/stub-targeted",
        targetVersion: 28.4,
        initialErrorName: "UpgradeError",
        initialErrorMessage: "Not yet support for changing primary key",
        preservedTokenStats: true,
      },
    });
    expect(database.resetTargetedPersistentIndexState).toHaveBeenCalledTimes(1);
    expect(database.deleteDatabaseByName).not.toHaveBeenCalled();
  });

  test("falls back to a full reset after targeted recovery fails", async () => {
    const open = jest
      .fn()
      .mockRejectedValueOnce(createUpgradeError())
      .mockResolvedValueOnce(undefined);
    const database = Object.create(Database.prototype) as Database & {
      db: {
        open: jest.Mock;
        close: jest.Mock;
        dbName: string;
        dbVersion: number;
        consumeSchemaUpgradeDetected: jest.Mock;
      };
      resetTargetedPersistentIndexState: jest.Mock;
      deleteDatabaseByName: jest.Mock;
    };
    database.db = {
      open,
      close: jest.fn(),
      dbName: "clever-search/stub-full",
      dbVersion: 28.4,
      consumeSchemaUpgradeDetected: jest.fn(() => false),
    };
    database.resetTargetedPersistentIndexState = jest.fn(async () => {
      throw new Error("reset failed");
    });
    database.deleteDatabaseByName = jest.fn(async () => {});

    const report = await database.openAndConsumeSchemaUpgradeReport();

    expect(report).toEqual({
      schemaUpgradeDetected: true,
      recovery: {
        mode: "full-reset",
        dbName: "clever-search/stub-full",
        targetVersion: 28.4,
        initialErrorName: "UpgradeError",
        initialErrorMessage: "Not yet support for changing primary key",
        preservedTokenStats: false,
      },
    });
    expect(database.resetTargetedPersistentIndexState).toHaveBeenCalledTimes(1);
    expect(database.deleteDatabaseByName).toHaveBeenCalledWith(
      "clever-search/stub-full",
    );
  });

  test("auto-heals a given upgrade signature only once per startup", async () => {
    const upgradeError = createUpgradeError();
    const database = Object.create(Database.prototype) as Database & {
      db: {
        open: jest.Mock;
        close: jest.Mock;
        dbName: string;
        dbVersion: number;
        consumeSchemaUpgradeDetected: jest.Mock;
      };
      resetTargetedPersistentIndexState: jest.Mock;
      deleteDatabaseByName: jest.Mock;
    };
    database.db = {
      open: jest.fn(async () => {
        throw upgradeError;
      }),
      close: jest.fn(),
      dbName: "clever-search/stub-once",
      dbVersion: 28.4,
      consumeSchemaUpgradeDetected: jest.fn(() => false),
    };
    database.resetTargetedPersistentIndexState = jest.fn(async () => {
      throw new Error("reset failed");
    });
    database.deleteDatabaseByName = jest.fn(async () => {});

    await expect(database.openAndConsumeSchemaUpgradeReport()).rejects.toThrow(
      "Not yet support for changing primary key",
    );
    expect(database.resetTargetedPersistentIndexState).toHaveBeenCalledTimes(1);
    expect(database.deleteDatabaseByName).toHaveBeenCalledTimes(1);

    await expect(database.openAndConsumeSchemaUpgradeReport()).rejects.toThrow(
      "Not yet support for changing primary key",
    );
    expect(database.resetTargetedPersistentIndexState).toHaveBeenCalledTimes(1);
    expect(database.deleteDatabaseByName).toHaveBeenCalledTimes(1);
  });
});
