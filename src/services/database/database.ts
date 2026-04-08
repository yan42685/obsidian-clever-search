import Dexie from "dexie";
import type {
  HybridTokenBudgetResetRecord,
  HybridTokenRecord,
  HybridTokenSavingRecord,
  OuterSetting,
} from "src/globals/plugin-setting";
import type { BaseIndexedFileRef } from "src/globals/search-types";
import {
  buildIndexRecoveryStateId,
  type IndexRecoveryEngine,
  type IndexRecoveryStateRow,
} from "src/services/obsidian/user-data/index-recovery-state";
import type { IndexArtifactStateRow } from "src/services/obsidian/user-data/index-artifact-state";
import type {
  CoverageLexicalBodyTokenColdBlockRow,
  CoverageLexicalBodyTokenColdDocRow,
  CoverageLexicalBodyTokenColdMetaRow,
} from "src/services/search/coverage-lexical/coverage-lexical-body-token-cold-types";
import type {
  BlobRecord,
  ChunkRow,
  ChunkVectorShardRow,
  HybridFileSnapshotRow,
  HybridDirtyShadowRow,
  HybridIndexedFileRef,
} from "src/services/search/hybrid/hybrid-store";
import type { SerializedFileSearchIndex } from "src/services/search/file-search-engine";
import { logger } from "src/utils/logger";
import { getInstance, monitorDecorator } from "src/utils/my-lib";
import { inject, singleton } from "tsyringe";
import { PrivateApi } from "../obsidian/private-api";

type LexicalIndexedFileRefRow = BaseIndexedFileRef;

type HybridIndexedFileRefRow = HybridIndexedFileRef;

@singleton()
export class Database {
  readonly db = getInstance(DexieWrapper);

  async openAndConsumeSchemaUpgradeFlag(): Promise<boolean> {
    await this.db.open();
    return this.db.consumeSchemaUpgradeDetected();
  }

  async estimatePluginStorageUsage(): Promise<{
    totalBytes: number;
    tables: Array<{ name: string; rows: number; bytes: number }>;
    hybridChunkBreakdown?: {
      sharedSnapshotTextBytes: number;
      sharedSnapshotPathBytes: number;
      chunkMetadataBytes: number;
    };
    hybridVectorBreakdown?: {
      chunkIdBytes: number;
      vectorBytes: number;
      scaleBytes: number;
      metadataBytes: number;
    };
  }> {
    const tableEntries = [
      { name: "pluginSetting", table: this.db.pluginSetting },
      { name: "lexicalSearchSnapshots", table: this.db.lexicalSearchSnapshots },
      { name: "lexicalIndexedFileRefs", table: this.db.lexicalIndexedFileRefs },
      { name: "lexicalBodyTokenColdMeta", table: this.db.lexicalBodyTokenColdMeta },
      { name: "lexicalBodyTokenColdBlocks", table: this.db.lexicalBodyTokenColdBlocks },
      { name: "lexicalBodyTokenColdDocs", table: this.db.lexicalBodyTokenColdDocs },
      { name: "hybridChunks", table: this.db.hybridChunks },
      { name: "fileSnapshots", table: this.db.fileSnapshots },
      { name: "hybridDirtyShadows", table: this.db.hybridDirtyShadows },
      { name: "hybridChunkVectors", table: this.db.hybridChunkVectors },
      { name: "hybridHnswSmall", table: this.db.hybridHnswSmall },
      { name: "hybridIndexedFileRefs", table: this.db.hybridIndexedFileRefs },
      { name: "indexRecoveryState", table: this.db.indexRecoveryState },
      { name: "indexArtifactState", table: this.db.indexArtifactState },
      { name: "hybridTokenStats", table: this.db.hybridTokenStats },
      { name: "hybridTokenSavings", table: this.db.hybridTokenSavings },
      { name: "hybridTokenBudgetResets", table: this.db.hybridTokenBudgetResets },
    ] as const;

    const tables = await Promise.all(
      tableEntries.map(async ({ name, table }) => {
        const rows = await table.toArray();
        return {
          name,
          rows: rows.length,
          bytes: estimateValueBytes(rows),
        };
      }),
    );
    const hybridChunkRows = await this.db.hybridChunks.toArray();
    const hybridSnapshotRows = await this.db.fileSnapshots.toArray();
    const hybridVectorRows = await this.db.hybridChunkVectors.toArray();
    const hybridChunkBreakdown = this.estimateHybridChunkBreakdown(
      hybridChunkRows,
      hybridSnapshotRows,
    );
    const hybridVectorBreakdown =
      this.estimateHybridVectorBreakdown(hybridVectorRows);

    return {
      totalBytes: tables.reduce((sum, item) => sum + item.bytes, 0),
      tables,
      hybridChunkBreakdown,
      hybridVectorBreakdown,
    };
  }

  private estimateHybridChunkBreakdown(
    rows: ChunkRow[],
    snapshots: HybridFileSnapshotRow[],
  ) {
    const breakdown = {
      sharedSnapshotTextBytes: 0,
      sharedSnapshotPathBytes: 0,
      chunkMetadataBytes: 0,
    };

    for (const snapshot of snapshots) {
      breakdown.sharedSnapshotTextBytes += estimateValueBytes(
        snapshot.plainText,
      );
      breakdown.sharedSnapshotPathBytes += estimateValueBytes(
        snapshot.filePath,
      );
    }

    for (const row of rows) {
      breakdown.chunkMetadataBytes +=
        estimateValueBytes(row.id) +
        estimateValueBytes(row.filePath) +
        estimateValueBytes(row.chunkIndex) +
        estimateValueBytes(row.startOffset) +
        estimateValueBytes(row.endOffset) +
        estimateValueBytes(row.startLine) +
        estimateValueBytes(row.startCol) +
        estimateValueBytes(row.endLine) +
        estimateValueBytes(row.embedKey);
    }

    return breakdown;
  }

  private estimateHybridVectorBreakdown(rows: ChunkVectorShardRow[]) {
    const breakdown = {
      chunkIdBytes: 0,
      vectorBytes: 0,
      scaleBytes: 0,
      metadataBytes: 0,
    };

    for (const row of rows) {
      breakdown.chunkIdBytes += row.chunkIds?.size ?? 0;
      breakdown.vectorBytes += row.vectorData?.size ?? 0;
      breakdown.scaleBytes += row.scaleData?.size ?? 0;
      breakdown.metadataBytes +=
        estimateValueBytes(row.filePath) +
        estimateValueBytes(row.precision) +
        estimateValueBytes(row.dim) +
        estimateValueBytes(row.chunkCount);
    }

    return breakdown;
  }

  async deleteLexicalSearchSnapshot() {
    await this.db.lexicalSearchSnapshots.clear();
  }

  // it may finished some time later even if using await
  async setLexicalSearchSnapshot(data: SerializedFileSearchIndex) {
    await this.db.transaction(
      "rw",
      this.db.lexicalSearchSnapshots,
      async () => {
        // Warning: The clear() here is just a marker for caution to avoid data duplication.
        // Ideally, clear() should be executed at an earlier stage.
        // Placing clear() and add() together, especially with large data sets,
        // may lead to conflicts and cause Obsidian to crash. It is an issue related to Dexie or IndexedDB
        await this.db.lexicalSearchSnapshots.clear();
        await this.db.lexicalSearchSnapshots.add({ data: data });
        logger.trace("lexical search snapshot saved");
      },
    );
  }

  @monitorDecorator
  async getLexicalSearchSnapshot(): Promise<SerializedFileSearchIndex | null> {
    return (await this.db.lexicalSearchSnapshots.toArray())[0]?.data || null;
  }

  async setLexicalIndexedFileRefs(refs: BaseIndexedFileRef[]) {
    await this.db.transaction(
      "rw",
      this.db.lexicalIndexedFileRefs,
      async () => {
        await this.db.lexicalIndexedFileRefs.clear();
        await this.db.lexicalIndexedFileRefs.bulkPut(
          refs.map((ref) => this.toLexicalIndexedFileRefRow(ref)),
        );
      },
    );
  }

  @monitorDecorator
  async getLexicalIndexedFileRefs(): Promise<BaseIndexedFileRef[] | null> {
    return (await this.db.lexicalIndexedFileRefs.toArray()).map((row) =>
      this.fromLexicalIndexedFileRefRow(row),
    );
  }

  async putLexicalIndexedFileRef(ref: BaseIndexedFileRef): Promise<void> {
    await this.db.transaction(
      "rw",
      this.db.lexicalIndexedFileRefs,
      async () => {
        await this.db.lexicalIndexedFileRefs.put(
          this.toLexicalIndexedFileRefRow(ref),
        );
      },
    );
  }

  async deleteLexicalIndexedFileRefs(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }
    await this.db.transaction(
      "rw",
      this.db.lexicalIndexedFileRefs,
      async () => {
        for (const path of paths) {
          await this.db.lexicalIndexedFileRefs.delete(path);
        }
      },
    );
  }

  async setPluginSetting(setting: OuterSetting): Promise<boolean> {
    try {
      await this.db.transaction("rw", this.db.pluginSetting, () => {
        this.db.pluginSetting.clear();
        this.db.pluginSetting.add({ data: setting });
      });
      logger.trace("settings have been saved to database");
      return true;
    } catch (e) {
      logger.trace(`settings failed to be saved: ${e}`);
      return false;
    }
  }

  async getIndexRecoveryStates(
    engine?: IndexRecoveryEngine,
  ): Promise<IndexRecoveryStateRow[]> {
    if (!engine) {
      return await this.db.indexRecoveryState.toArray();
    }
    return await this.db.indexRecoveryState.where("engine").equals(engine).toArray();
  }

  async putIndexRecoveryState(row: IndexRecoveryStateRow): Promise<void> {
    await this.db.indexRecoveryState.put(row);
  }

  async bulkPutIndexRecoveryStates(rows: IndexRecoveryStateRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.db.indexRecoveryState.bulkPut(rows);
  }

  async deleteIndexRecoveryState(
    engine: IndexRecoveryEngine,
    path: string,
  ): Promise<void> {
    await this.db.indexRecoveryState.delete(buildIndexRecoveryStateId(engine, path));
  }

  async moveIndexRecoveryState(
    engine: IndexRecoveryEngine,
    oldPath: string,
    newPath: string,
  ): Promise<void> {
    const oldId = buildIndexRecoveryStateId(engine, oldPath);
    const existing = await this.db.indexRecoveryState.get(oldId);
    if (!existing) {
      return;
    }
    await this.db.indexRecoveryState.put({
      ...existing,
      id: buildIndexRecoveryStateId(engine, newPath),
      path: newPath,
    });
    await this.db.indexRecoveryState.delete(oldId);
  }

  private toLexicalIndexedFileRefRow(
    ref: BaseIndexedFileRef,
  ): LexicalIndexedFileRefRow {
    return {
      path: ref.path,
      generation: ref.generation,
      size: ref.size,
    };
  }

  private fromLexicalIndexedFileRefRow(
    row: LexicalIndexedFileRefRow,
  ): BaseIndexedFileRef {
    return {
      path: row.path,
      generation: row.generation,
      size: row.size,
    };
  }

}

@singleton()
class DexieWrapper extends Dexie {
  private static readonly _dbVersion = 23;
  private static readonly dbNamePrefix = "clever-search/";
  private privateApi: PrivateApi;
  private schemaUpgradeDetected = false;
  pluginSetting!: Dexie.Table<{ id?: number; data: OuterSetting }, number>;
  lexicalSearchSnapshots!: Dexie.Table<
    { id?: number; data: SerializedFileSearchIndex },
    number
  >;
  // TODO: put data together because it takes lots of time for a database connection  (70ms) in my machine
  lexicalIndexedFileRefs!: Dexie.Table<LexicalIndexedFileRefRow, string>;
  lexicalBodyTokenColdMeta!: Dexie.Table<
    CoverageLexicalBodyTokenColdMetaRow,
    string
  >;
  lexicalBodyTokenColdBlocks!: Dexie.Table<
    CoverageLexicalBodyTokenColdBlockRow,
    string
  >;
  lexicalBodyTokenColdDocs!: Dexie.Table<
    CoverageLexicalBodyTokenColdDocRow,
    string
  >;
  // Hybrid search tables
  hybridChunks!: Dexie.Table<ChunkRow, number>;
  fileSnapshots!: Dexie.Table<HybridFileSnapshotRow, string>;
  hybridDirtyShadows!: Dexie.Table<HybridDirtyShadowRow, string>;
  hybridChunkVectors!: Dexie.Table<ChunkVectorShardRow, string>;
  hybridHnswSmall!: Dexie.Table<BlobRecord, number>;
  hybridIndexedFileRefs!: Dexie.Table<HybridIndexedFileRefRow, string>;
  indexRecoveryState!: Dexie.Table<IndexRecoveryStateRow, string>;
  indexArtifactState!: Dexie.Table<IndexArtifactStateRow, string>;
  hybridTokenStats!: Dexie.Table<HybridTokenRecord, number>;
  hybridTokenSavings!: Dexie.Table<HybridTokenSavingRecord, number>;
  hybridTokenBudgetResets!: Dexie.Table<HybridTokenBudgetResetRecord, number>;

  constructor(@inject(PrivateApi) privateApi: PrivateApi) {
    super(DexieWrapper.dbNamePrefix + privateApi.getAppId());
    this.privateApi = privateApi;
    this.version(21)
      .stores({
        pluginSetting: "++id",
        lexicalSearchSnapshots: "++id",
        lexicalIndexedFileRefs: "path",
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
      })
      .upgrade(async (tx) => {
        this.schemaUpgradeDetected = true;
        // Schema upgrades should preserve user-owned data and lexical rebuild
        // artifacts where possible, but hard-reset hybrid runtime tables whose
        // payload shape or ownership contract changed across versions.
        // This upgrade intentionally drops existing hybrid runtime state rather than
        // carrying forward removed BM25-era compatibility paths.
        await Promise.all([
          tx.table("hybridChunks").clear(),
          tx.table("fileSnapshots").clear(),
          tx.table("hybridDirtyShadows").clear(),
          tx.table("hybridChunkVectors").clear(),
          tx.table("hybridHnswSmall").clear(),
          tx.table("hybridIndexedFileRefs").clear(),
          tx.table("indexRecoveryState").clear(),
          tx.table("indexArtifactState").clear(),
        ]);
      });
    this.version(DexieWrapper._dbVersion).stores({
      pluginSetting: "++id",
      lexicalSearchSnapshots: "++id",
      lexicalIndexedFileRefs: "path",
      lexicalBodyTokenColdMeta: "id",
      lexicalBodyTokenColdBlocks: "id, epoch, updatedAt",
      lexicalBodyTokenColdDocs: "path, epoch, blockId, updatedAt",
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
  }
  get dbVersion() {
    return DexieWrapper._dbVersion;
  }

  consumeSchemaUpgradeDetected(): boolean {
    const detected = this.schemaUpgradeDetected;
    this.schemaUpgradeDetected = false;
    return detected;
  }
  get dbName() {
    return DexieWrapper.dbNamePrefix + this.privateApi.getAppId();
  }
}

const textEncoder = new TextEncoder();

function estimateValueBytes(
  value: unknown,
  visited = new WeakSet<object>(),
): number {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "string") {
    return textEncoder.encode(value).length;
  }

  if (typeof value === "number") {
    return 8;
  }

  if (typeof value === "boolean") {
    return 4;
  }

  if (typeof value === "bigint") {
    return textEncoder.encode(value.toString()).length;
  }

  if (value instanceof Blob) {
    return value.size;
  }

  if (value instanceof Date) {
    return textEncoder.encode(value.toISOString()).length;
  }

  if (value instanceof ArrayBuffer) {
    return value.byteLength;
  }

  if (ArrayBuffer.isView(value)) {
    return value.byteLength;
  }

  if (Array.isArray(value)) {
    return value.reduce(
      (sum, item) => sum + estimateValueBytes(item, visited),
      0,
    );
  }

  if (typeof value === "object") {
    if (visited.has(value)) {
      return 0;
    }
    visited.add(value);

    return Object.entries(value).reduce((sum, [key, childValue]) => {
      return (
        sum +
        textEncoder.encode(key).length +
        estimateValueBytes(childValue, visited)
      );
    }, 0);
  }

  return textEncoder.encode(String(value)).length;
}

