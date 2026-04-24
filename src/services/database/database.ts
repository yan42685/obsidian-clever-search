import Dexie from "dexie";
import type {
  HybridTokenBudgetResetRecord,
  HybridTokenRecord,
  HybridTokenSavingRecord,
  OuterSetting,
} from "src/globals/plugin-setting";
import type { BaseIndexedFileRef, DocRef } from "src/globals/search-types";
import type { ResidentIntegerArray } from "src/services/search/coverage-lexical-v3/layout/integer-arrays";
import {
  buildIndexRecoveryStateId,
  type IndexRecoveryEngine,
  type IndexRecoveryStateRow,
} from "src/services/obsidian/user-data/index-recovery-state";
import type { IndexArtifactStateRow } from "src/services/obsidian/user-data/index-artifact-state";
import type { LexicalMutationJournalRow, PendingDocOperationRow } from "src/services/obsidian/user-data/doc-operation-buffer";
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

export type LexicalIndexedMetadataRow = {
  docRef?: DocRef;
  filePath: string;
  generation?: number;
  aliasesText?: string;
  tagsText?: string;
  headingsText?: string;
};

export type LexicalFuzzyRescueRow = {
  id: string;
  indexedMetadataFamilyCount: number;
  fuzzyLookupKeyCount: number;
  bytes: number;
  entries: ReadonlyArray<{
    fuzzyLookupKey: string;
    shardLocalFamilySlots: Uint32Array;
  }>;
};

export type LexicalBodyFamilySupportRow = {
  id: string;
  entryCount: number;
  bytes: number;
  familySupportStartByBlockId: ResidentIntegerArray;
  familySupportFamilyIds: ResidentIntegerArray;
  familySupportMaskByEntry: Uint8Array;
};

export type LexicalBodyEvidenceRow = {
  id: string;
  docRef: DocRef;
  generation: number;
  blockOrdinal: number;
  exactFamilyIds: readonly number[];
  exactTokenPositions: readonly number[];
  familySupportFamilyIds: readonly number[];
  familySupportMaskByEntry: readonly number[];
};

export type LexicalHanDocEvidenceRow = {
  id: string;
  docRef: DocRef;
  generation: number;
  identityWitnessStringIds: readonly number[];
  identityWitnessSourceMaskByDocEntry: readonly number[];
  routeWitnessStringIds: readonly number[];
  routeWitnessSourceMaskByDocEntry: readonly number[];
  headingWitnessStringIds: readonly number[];
};

export type LexicalHanBodyEvidenceRow = {
  id: string;
  docRef: DocRef;
  generation: number;
  blockOrdinal: number;
  bodyWitnessStringIds: readonly number[];
  bodyWitnessStartOffsets: readonly number[];
};

export type LexicalExactTapeRow = {
  id: string;
  entryCount: number;
  bytes: number;
  familyIds: ResidentIntegerArray;
  positionEncodingByBlockId: Uint8Array;
  positionStartByBlockId: ResidentIntegerArray;
  positionDeltaU8Tape: Uint8Array;
  positionDeltaU16Tape: Uint16Array;
  positionDeltaU32Tape: Uint32Array;
};

export type LexicalHanWitnessRow = {
  id: string;
  metadataWitnessEntryCount: number;
  bodyWitnessEntryCount: number;
  bytes: number;
  identityWitnessStartByDocId: ResidentIntegerArray;
  identityWitnessStringIds: ResidentIntegerArray;
  identityWitnessSourceMaskByDocEntry: Uint8Array;
  routeWitnessStartByDocId: ResidentIntegerArray;
  routeWitnessStringIds: ResidentIntegerArray;
  routeWitnessSourceMaskByDocEntry: Uint8Array;
  headingWitnessStartByDocId: ResidentIntegerArray;
  headingWitnessStringIds: ResidentIntegerArray;
  bodyWitnessOccurrenceStartByBlockId: ResidentIntegerArray;
  bodyWitnessOccurrenceStringIds: ResidentIntegerArray;
  bodyWitnessPositionEncodingByBlockId: Uint8Array;
  bodyWitnessPositionStartByBlockId: ResidentIntegerArray;
  bodyWitnessPositionDeltaU8Tape: Uint8Array;
  bodyWitnessPositionDeltaU16Tape: Uint16Array;
  bodyWitnessPositionDeltaU32Tape: Uint32Array;
};

export type DocRegistryRow = {
  docRef: DocRef;
  path: string;
  deleted: boolean;
  liveGeneration: number;
  contentFingerprint?: string;
  updatedAt: number;
};

type DocRegistryMetaRow = {
  key: string;
  value: number;
};

export const LEXICAL_QUERY_EVIDENCE_READY_VERSION = 2;

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
      { name: "lexicalIndexedMetadata", table: this.db.lexicalIndexedMetadata },
      { name: "lexicalFuzzyRescue", table: this.db.lexicalFuzzyRescue },
      { name: "lexicalBodyFamilySupport", table: this.db.lexicalBodyFamilySupport },
      { name: "lexicalBodyEvidence", table: this.db.lexicalBodyEvidence },
      { name: "lexicalHanDocEvidence", table: this.db.lexicalHanDocEvidence },
      { name: "lexicalHanBodyEvidence", table: this.db.lexicalHanBodyEvidence },
      { name: "lexicalExactTapes", table: this.db.lexicalExactTapes },
      { name: "lexicalHanWitness", table: this.db.lexicalHanWitness },
      { name: "docRegistry", table: this.db.docRegistry },
      { name: "docRegistryMeta", table: this.db.docRegistryMeta },
      { name: "hybridChunks", table: this.db.hybridChunks },
      { name: "fileSnapshots", table: this.db.fileSnapshots },
      { name: "hybridDirtyShadows", table: this.db.hybridDirtyShadows },
      { name: "hybridChunkVectors", table: this.db.hybridChunkVectors },
      { name: "hybridHnswSmall", table: this.db.hybridHnswSmall },
      { name: "hybridIndexedFileRefs", table: this.db.hybridIndexedFileRefs },
      { name: "indexRecoveryState", table: this.db.indexRecoveryState },
      { name: "indexArtifactState", table: this.db.indexArtifactState },
      { name: "lexicalMutationJournal", table: this.db.lexicalMutationJournal },
      { name: "pendingDocOperations", table: this.db.pendingDocOperations },
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
    await this.db.transaction(
      "rw",
      this.db.lexicalSearchSnapshots,
      this.db.docRegistryMeta,
      async () => {
        await this.db.lexicalSearchSnapshots.clear();
        await this.db.docRegistryMeta.delete(
          DexieWrapper.lexicalQueryEvidenceReadyKey,
        );
      },
    );
  }

  async getLexicalQueryEvidenceReadyMarkerVersion(): Promise<number | null> {
    const row = await this.db.docRegistryMeta.get(
      DexieWrapper.lexicalQueryEvidenceReadyKey,
    );
    return row?.value ?? null;
  }

  async hasLexicalQueryEvidenceReadyMarker(
    expectedVersion = LEXICAL_QUERY_EVIDENCE_READY_VERSION,
  ): Promise<boolean> {
    const version = await this.getLexicalQueryEvidenceReadyMarkerVersion();
    return version === expectedVersion;
  }

  async setLexicalQueryEvidenceReadyMarker(
    version = LEXICAL_QUERY_EVIDENCE_READY_VERSION,
  ): Promise<void> {
    await this.db.docRegistryMeta.put({
      key: DexieWrapper.lexicalQueryEvidenceReadyKey,
      value: version,
    });
  }

  async clearLexicalQueryEvidenceReadyMarker(): Promise<void> {
    await this.db.docRegistryMeta.delete(
      DexieWrapper.lexicalQueryEvidenceReadyKey,
    );
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

  async putLexicalMutationJournalEntry(
    row: LexicalMutationJournalRow,
  ): Promise<void> {
    await this.db.lexicalMutationJournal.put(row);
  }

  async getLexicalMutationJournalEntries(
    engine?: LexicalMutationJournalRow["engine"],
  ): Promise<LexicalMutationJournalRow[]> {
    if (!engine) {
      return await this.db.lexicalMutationJournal.toArray();
    }
    return await this.db.lexicalMutationJournal
      .where("engine")
      .equals(engine)
      .toArray();
  }

  async deleteLexicalMutationJournalEntries(
    ids: readonly string[],
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.db.lexicalMutationJournal.bulkDelete(Array.from(ids));
  }

  async clearLexicalMutationJournalEntries(
    engine?: LexicalMutationJournalRow["engine"],
  ): Promise<void> {
    if (!engine) {
      await this.db.lexicalMutationJournal.clear();
      return;
    }
    const ids = (
      await this.db.lexicalMutationJournal
        .where("engine")
        .equals(engine)
        .primaryKeys()
    ) as string[];
    if (ids.length === 0) {
      return;
    }
    await this.db.lexicalMutationJournal.bulkDelete(ids);
  }

  async putPendingDocOperation(row: PendingDocOperationRow): Promise<void> {
    await this.db.pendingDocOperations.put(row);
  }

  async getPendingDocOperations(
    engine?: PendingDocOperationRow["engine"],
  ): Promise<PendingDocOperationRow[]> {
    if (!engine) {
      return await this.db.pendingDocOperations.toArray();
    }
    return await this.db.pendingDocOperations.where("engine").equals(engine).toArray();
  }

  async deletePendingDocOperations(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.db.pendingDocOperations.bulkDelete(Array.from(ids));
  }

  async clearPendingDocOperations(
    engine?: PendingDocOperationRow["engine"],
  ): Promise<void> {
    if (!engine) {
      await this.db.pendingDocOperations.clear();
      return;
    }
    const ids = (
      await this.db.pendingDocOperations.where("engine").equals(engine).primaryKeys()
    ) as string[];
    if (ids.length === 0) {
      return;
    }
    await this.db.pendingDocOperations.bulkDelete(ids);
  }

  async getDocRegistryEntry(path: string): Promise<DocRegistryRow | undefined> {
    return await this.db.docRegistry.where("path").equals(path).first();
  }

  async getDocRegistryEntries(
    paths: readonly string[],
  ): Promise<Map<string, DocRegistryRow>> {
    const uniquePaths = Array.from(new Set(paths));
    if (uniquePaths.length === 0) {
      return new Map<string, DocRegistryRow>();
    }
    const rows = await this.db.docRegistry.where("path").anyOf(uniquePaths).toArray();
    return new Map(rows.map((row) => [row.path, row]));
  }

  async listDocRegistryEntries(): Promise<DocRegistryRow[]> {
    return await this.db.docRegistry.toArray();
  }

  async ensureDocRegistryEntries(
    entries: ReadonlyArray<{
      docRef?: DocRef;
      path: string;
      generation?: number;
      deleted?: boolean;
      contentFingerprint?: string;
    }>,
  ): Promise<Map<string, DocRegistryRow>> {
    const normalizedEntries = new Map<
      string,
      {
        docRef?: DocRef;
        path: string;
        generation?: number;
        deleted?: boolean;
        contentFingerprint?: string;
      }
    >();
    for (const entry of entries) {
      normalizedEntries.set(entry.path, entry);
    }
    if (normalizedEntries.size === 0) {
      return new Map<string, DocRegistryRow>();
    }

    return await this.db.transaction(
      "rw",
      this.db.docRegistry,
      this.db.docRegistryMeta,
      async () => {
        const paths = Array.from(normalizedEntries.keys());
        const existingRows = await this.db.docRegistry.where("path").anyOf(paths).toArray();
        const existingByPath = new Map(existingRows.map((row) => [row.path, row]));
        let nextDocRef = await this.readNextDocRef();
        let nextDocRefChanged = false;
        const updatedRows: DocRegistryRow[] = [];

        for (const [path, entry] of normalizedEntries) {
          const existing = existingByPath.get(path);
          const liveGeneration =
            entry.generation ?? existing?.liveGeneration ?? 0;
          const deleted = entry.deleted ?? existing?.deleted ?? false;
          const contentFingerprint =
            entry.contentFingerprint ?? existing?.contentFingerprint;
          const updatedAt = Date.now();
          if (existing) {
            const nextRow: DocRegistryRow = {
              ...existing,
              path,
              deleted,
              liveGeneration,
              contentFingerprint,
              updatedAt,
            };
            updatedRows.push(nextRow);
            continue;
          }

          const nextRow: DocRegistryRow = {
            docRef: entry.docRef ?? nextDocRef,
            path,
            deleted,
            liveGeneration,
            contentFingerprint,
            updatedAt,
          };
          if (entry.docRef === undefined) {
            nextDocRef += 1;
            nextDocRefChanged = true;
          } else if (entry.docRef >= nextDocRef) {
            nextDocRef = entry.docRef + 1;
            nextDocRefChanged = true;
          }
          updatedRows.push(nextRow);
        }

        await this.db.docRegistry.bulkPut(updatedRows);
        if (nextDocRefChanged) {
          await this.writeNextDocRef(nextDocRef);
        }
        return new Map(updatedRows.map((row) => [row.path, row]));
      },
    );
  }

  async ensureDocRegistryEntry(entry: {
    docRef?: DocRef;
    path: string;
    generation?: number;
    deleted?: boolean;
    contentFingerprint?: string;
  }): Promise<DocRegistryRow> {
    const rows = await this.ensureDocRegistryEntries([entry]);
    const row = rows.get(entry.path);
    if (!row) {
      throw new Error(`Failed to ensure doc registry entry for ${entry.path}`);
    }
    return row;
  }

  async moveDocRegistryPath(
    oldPath: string,
    newPath: string,
    options?: {
      generation?: number;
      contentFingerprint?: string;
    },
  ): Promise<DocRegistryRow | undefined> {
    return await this.db.transaction(
      "rw",
      this.db.docRegistry,
      async () => {
        const existing = await this.db.docRegistry.where("path").equals(oldPath).first();
        if (!existing) {
          return undefined;
        }
        const conflicting = await this.db.docRegistry.where("path").equals(newPath).first();
        if (conflicting && conflicting.docRef !== existing.docRef) {
          await this.db.docRegistry.delete(conflicting.docRef);
        }
        const nextRow: DocRegistryRow = {
          ...existing,
          path: newPath,
          deleted: false,
          liveGeneration: options?.generation ?? existing.liveGeneration,
          contentFingerprint:
            options?.contentFingerprint ?? existing.contentFingerprint,
          updatedAt: Date.now(),
        };
        await this.db.docRegistry.put(nextRow);
        return nextRow;
      },
    );
  }

  async markDocRegistryDeleted(
    path: string,
    generation?: number,
  ): Promise<void> {
    await this.db.transaction("rw", this.db.docRegistry, async () => {
      const existing = await this.db.docRegistry.where("path").equals(path).first();
      if (!existing) {
        return;
      }
      await this.db.docRegistry.put({
        ...existing,
        deleted: true,
        liveGeneration: generation ?? existing.liveGeneration,
        updatedAt: Date.now(),
      });
    });
  }

  private async readNextDocRef(): Promise<number> {
    const row = await this.db.docRegistryMeta.get(DexieWrapper.docRegistryNextRefKey);
    return row?.value ?? 1;
  }

  private async writeNextDocRef(nextDocRef: number): Promise<void> {
    await this.db.docRegistryMeta.put({
      key: DexieWrapper.docRegistryNextRefKey,
      value: nextDocRef,
    });
  }

  private toLexicalIndexedFileRefRow(
    ref: BaseIndexedFileRef,
  ): LexicalIndexedFileRefRow {
    return {
      docRef: ref.docRef,
      path: ref.path,
      generation: ref.generation,
      size: ref.size,
    };
  }

  private fromLexicalIndexedFileRefRow(
    row: LexicalIndexedFileRefRow,
  ): BaseIndexedFileRef {
    return {
      docRef: row.docRef,
      path: row.path,
      generation: row.generation,
      size: row.size,
    };
  }

}

@singleton()
class DexieWrapper extends Dexie {
  // Dexie keeps one decimal place for version() and multiplies by 10 when opening IndexedDB.
  // Use 0.1 increments here so app-level schema bumps stay readable while mapping to IDB integers.
  private static readonly _dbVersion = 28.4;
  private static readonly dbNamePrefix = "clever-search/";
  static readonly docRegistryNextRefKey = "nextDocRef";
  static readonly lexicalQueryEvidenceReadyKey = "lexicalQueryEvidenceReady";
  private privateApi: PrivateApi;
  private schemaUpgradeDetected = false;
  pluginSetting!: Dexie.Table<{ id?: number; data: OuterSetting }, number>;
  lexicalSearchSnapshots!: Dexie.Table<
    { id?: number; data: SerializedFileSearchIndex },
    number
  >;
  lexicalIndexedFileRefs!: Dexie.Table<LexicalIndexedFileRefRow, string>;
  lexicalIndexedMetadata!: Dexie.Table<LexicalIndexedMetadataRow, string>;
  lexicalFuzzyRescue!: Dexie.Table<LexicalFuzzyRescueRow, string>;
  lexicalBodyFamilySupport!: Dexie.Table<LexicalBodyFamilySupportRow, string>;
  lexicalBodyEvidence!: Dexie.Table<LexicalBodyEvidenceRow, string>;
  lexicalHanDocEvidence!: Dexie.Table<LexicalHanDocEvidenceRow, string>;
  lexicalHanBodyEvidence!: Dexie.Table<LexicalHanBodyEvidenceRow, string>;
  lexicalExactTapes!: Dexie.Table<LexicalExactTapeRow, string>;
  lexicalHanWitness!: Dexie.Table<LexicalHanWitnessRow, string>;
  docRegistry!: Dexie.Table<DocRegistryRow, number>;
  docRegistryMeta!: Dexie.Table<DocRegistryMetaRow, string>;

  hybridChunks!: Dexie.Table<ChunkRow, number>;
  fileSnapshots!: Dexie.Table<HybridFileSnapshotRow, string>;
  hybridDirtyShadows!: Dexie.Table<HybridDirtyShadowRow, string>;
  hybridChunkVectors!: Dexie.Table<ChunkVectorShardRow, string>;
  hybridHnswSmall!: Dexie.Table<BlobRecord, number>;
  hybridIndexedFileRefs!: Dexie.Table<HybridIndexedFileRefRow, string>;
  indexRecoveryState!: Dexie.Table<IndexRecoveryStateRow, string>;
  indexArtifactState!: Dexie.Table<IndexArtifactStateRow, string>;
  lexicalMutationJournal!: Dexie.Table<LexicalMutationJournalRow, string>;
  pendingDocOperations!: Dexie.Table<PendingDocOperationRow, string>;
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
        lexicalMutationJournal: "id, engine, kind, path, createdAt, [engine+path]",
        pendingDocOperations: "id, engine, type, path, createdAt, [engine+path]",
        hybridTokenStats: "++id, filePath, dateKey, [filePath+dateKey]",
        hybridTokenSavings: "++id, scope, periodKey, [scope+periodKey]",
      })
      .upgrade(async (tx) => {
        this.schemaUpgradeDetected = true;
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
    this.version(27.3)
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
        hybridTokenBudgetResets: "++id, periodKey",
      })
      .upgrade(async (tx) => {
        this.schemaUpgradeDetected = true;
        await Promise.all([
          tx.table("lexicalSearchSnapshots").clear(),
          tx.table("lexicalIndexedFileRefs").clear(),
          tx.table("hybridChunks").clear(),
          tx.table("fileSnapshots").clear(),
          tx.table("hybridDirtyShadows").clear(),
          tx.table("hybridChunkVectors").clear(),
          tx.table("hybridHnswSmall").clear(),
          tx.table("hybridIndexedFileRefs").clear(),
          tx.table("indexRecoveryState").clear(),
          tx.table("indexArtifactState").clear(),
          tx.table("hybridTokenStats").clear(),
          tx.table("hybridTokenSavings").clear(),
          tx.table("hybridTokenBudgetResets").clear(),
        ]);
      });
    this.version(DexieWrapper._dbVersion)
      .stores({
        pluginSetting: "++id",
        lexicalSearchSnapshots: "++id",
        lexicalIndexedFileRefs: "path",
        lexicalIndexedMetadata: "filePath",
        lexicalFuzzyRescue: "id",
        lexicalBodyFamilySupport: "id",
        lexicalBodyEvidence: "id, docRef, generation, blockOrdinal, [docRef+generation+blockOrdinal]",
        lexicalHanDocEvidence: "id, docRef, generation, [docRef+generation]",
        lexicalHanBodyEvidence: "id, docRef, generation, blockOrdinal, [docRef+generation+blockOrdinal]",
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
      })
      .upgrade(async (tx) => {
        this.schemaUpgradeDetected = true;
        await Promise.all([
          tx.table("lexicalBodyEvidence").clear(),
          tx.table("lexicalHanDocEvidence").clear(),
          tx.table("lexicalHanBodyEvidence").clear(),
        ]);
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



