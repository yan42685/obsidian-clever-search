import Dexie from "dexie";
import type {
  HybridTokenBudgetResetRecord,
  HybridTokenRecord,
  HybridTokenSavingRecord,
  OuterSetting,
} from "src/globals/plugin-setting";
import type { BaseIndexedFileRef, DocRef } from "src/globals/search-types";
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
import type { ResidentBase } from "src/services/search/coverage-lexical-v3/layout/types";
import type { ActiveOverlayJournalEntry } from "src/services/search/coverage-lexical-v3/active-overlay-journal";
import type {
  CompactJobManifest,
  CompactTempArtifact,
} from "src/services/search/coverage-lexical-v3/compact";
import type { CoverageLexicalV3SnapshotManifest } from "src/services/search/coverage-lexical-v3/snapshot";
import { logger } from "src/utils/logger";
import { getInstance, monitorDecorator } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { PrivateApi } from "../obsidian/private-api";

type LexicalIndexedFileRefRow = BaseIndexedFileRef;

type HybridIndexedFileRefRow = HybridIndexedFileRef;

export type LexicalColdEvidenceStorageBreakdown = {
  tables: {
    lexicalBodyEvidence: number;
    lexicalHanDocEvidence: number;
    lexicalHanBodyEvidence: number;
  };
  bodyEvidence: {
    rowMetadataBytes: number;
    exactFamilySlotBytes: number;
    exactPositionBytes: number;
    supportFamilySlotBytes: number;
    supportMaskBytes: number;
  };
  hanDocEvidence: {
    rowMetadataBytes: number;
    witnessMatchKeyBytes: number;
    witnessTextBytes: number;
    sourceMaskBytes: number;
  };
  hanBodyEvidence: {
    rowMetadataBytes: number;
    witnessMatchKeyBytes: number;
    witnessTextBytes: number;
    startOffsetBytes: number;
  };
  witnessTextDedup: {
    totalBytes: number;
    rowLocalUniqueBytes: number;
    docLocalUniqueBytes: number;
  };
};

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
  postingBytes?: number;
  keyBytes?: number;
  entries: ReadonlyArray<{
    fuzzyLookupKey: string;
    shardLocalFamilySlots: Uint32Array;
  }>;
};

export type LexicalBodyEvidenceRow = {
  id: string;
  shardId: string;
  shardGeneration: number;
  docRef: DocRef;
  generation: number;
  blockOrdinal: number;
  bodyEvidencePayload: Uint8Array;
};

export type LexicalHanDocEvidenceRow = {
  id: string;
  shardId: string;
  shardGeneration: number;
  docRef: DocRef;
  generation: number;
  identityWitnessMatchKeys?: Int32Array;
  identityWitnessTexts?: readonly string[];
  identityWitnessSourceMaskByDocEntry: Uint8Array;
  routeWitnessMatchKeys?: Int32Array;
  routeWitnessTexts?: readonly string[];
  routeWitnessSourceMaskByDocEntry: Uint8Array;
  headingWitnessMatchKeys?: Int32Array;
  headingWitnessTexts?: readonly string[];
};

export type LexicalHanBodyEvidenceRow = {
  id: string;
  shardId: string;
  shardGeneration: number;
  docRef: DocRef;
  generation: number;
  blockOrdinal: number;
  bodyWitnessMatchKeys?: Int32Array;
  bodyWitnessTexts?: readonly string[];
  bodyWitnessStartOffsets: Uint32Array;
};

export type DocRegistryRow = {
  docRef: DocRef;
  path: string;
  deleted: boolean;
  liveGeneration: number;
  contentFingerprint?: string;
  updatedAt: number;
};

export type CoverageLexicalV3ShardRegistryRow = {
  shardId: string;
  generation: number;
  state: "active" | "sealing" | "sealed" | "compact_temp" | "garbage";
  sourceBytes: number;
  staleSourceBytes?: number;
  docCount: number;
  staleDocCount?: number;
  createdOrder: number;
  artifactOwner: string;
};

export type CoverageLexicalV3InvalidationRow = {
  id: string;
  shardId: string;
  shardGeneration: number;
  docRef: DocRef;
  docGeneration: number;
  reason: "superseded" | "deleted";
  createdAt: number;
};

export type CoverageLexicalV3ResidentShardArtifactRow = {
  id: string;
  shardId: string;
  generation: number;
  artifactOwner: string;
  base: ResidentBase;
  createdAt: number;
};

export type CoverageLexicalV3ActiveOverlayJournalRow = ActiveOverlayJournalEntry;
export type CoverageLexicalV3CompactJobManifestRow = CompactJobManifest;
export type CoverageLexicalV3CompactTempArtifactRow = CompactTempArtifact;
export type CoverageLexicalV3SnapshotManifestRow = CoverageLexicalV3SnapshotManifest;

type DocRegistryMetaRow = {
  key: string;
  value: number;
};

const DOC_REGISTRY_NEXT_REF_KEY = "nextDocRef";
const LEXICAL_QUERY_EVIDENCE_READY_KEY = "lexicalQueryEvidenceReady";
const TARGETED_INDEX_RESET_TABLES = [
  "lexicalSearchSnapshots",
  "lexicalIndexedFileRefs",
  "lexicalIndexedMetadata",
  "lexicalFuzzyRescue",
  "lexicalBodyEvidence",
  "lexicalHanDocEvidence",
  "lexicalHanBodyEvidence",
  "docRegistry",
  "coverageLexicalV3ShardRegistry",
  "coverageLexicalV3Invalidations",
  "coverageLexicalV3ResidentShardArtifacts",
  "coverageLexicalV3ActiveOverlayJournal",
  "coverageLexicalV3CompactJobs",
  "coverageLexicalV3CompactTempArtifacts",
  "coverageLexicalV3SnapshotManifests",
  "indexRecoveryState",
  "indexArtifactState",
  "lexicalMutationJournal",
  "pendingDocOperations",
  "hybridChunks",
  "fileSnapshots",
  "hybridDirtyShadows",
  "hybridChunkVectors",
  "hybridHnswSmall",
  "hybridIndexedFileRefs",
] as const;

export const LEXICAL_QUERY_EVIDENCE_READY_VERSION = 3;

export type DatabaseOpenRecoveryReport = {
  mode: "targeted-reset" | "full-reset";
  dbName: string;
  targetVersion: number;
  initialErrorName: string;
  initialErrorMessage: string;
  preservedTokenStats: boolean;
  preservedSettings?: boolean;
};

type FullResetPreservedUserState = {
  pluginSettingRows: Array<{ id?: number; data: OuterSetting }>;
  hybridTokenStatsRows: HybridTokenRecord[];
  hybridTokenSavingsRows: HybridTokenSavingRecord[];
  hybridTokenBudgetResetRows: HybridTokenBudgetResetRecord[];
};

export type DatabaseOpenReport = {
  schemaUpgradeDetected: boolean;
  recovery: DatabaseOpenRecoveryReport | null;
};

@singleton()
export class Database {
  readonly db = new DexieWrapper(getInstance(PrivateApi));
  private static readonly attemptedUpgradeRecoveryKeys = new Set<string>();

  async openAndConsumeSchemaUpgradeFlag(): Promise<boolean> {
    const report = await this.openAndConsumeSchemaUpgradeReport();
    return report.schemaUpgradeDetected;
  }

  async openAndConsumeSchemaUpgradeReport(): Promise<DatabaseOpenReport> {
    const recovery = await this.openWithUpgradeRecovery();
    const schemaUpgradeDetected = this.db.consumeSchemaUpgradeDetected();
    return {
      schemaUpgradeDetected: schemaUpgradeDetected || recovery !== null,
      recovery,
    };
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
    lexicalColdEvidenceBreakdown?: LexicalColdEvidenceStorageBreakdown;
  }> {
    const tableEntries = [
      { name: "pluginSetting", table: this.db.pluginSetting },
      { name: "lexicalSearchSnapshots", table: this.db.lexicalSearchSnapshots },
      { name: "lexicalIndexedFileRefs", table: this.db.lexicalIndexedFileRefs },
      { name: "lexicalIndexedMetadata", table: this.db.lexicalIndexedMetadata },
      { name: "lexicalFuzzyRescue", table: this.db.lexicalFuzzyRescue },
      { name: "lexicalBodyEvidence", table: this.db.lexicalBodyEvidence },
      { name: "lexicalHanDocEvidence", table: this.db.lexicalHanDocEvidence },
      { name: "lexicalHanBodyEvidence", table: this.db.lexicalHanBodyEvidence },
      { name: "docRegistry", table: this.db.docRegistry },
      { name: "coverageLexicalV3ShardRegistry", table: this.db.coverageLexicalV3ShardRegistry },
      { name: "coverageLexicalV3Invalidations", table: this.db.coverageLexicalV3Invalidations },
      {
        name: "coverageLexicalV3ResidentShardArtifacts",
        table: this.db.coverageLexicalV3ResidentShardArtifacts,
      },
      {
        name: "coverageLexicalV3ActiveOverlayJournal",
        table: this.db.coverageLexicalV3ActiveOverlayJournal,
      },
      { name: "coverageLexicalV3CompactJobs", table: this.db.coverageLexicalV3CompactJobs },
      {
        name: "coverageLexicalV3CompactTempArtifacts",
        table: this.db.coverageLexicalV3CompactTempArtifacts,
      },
      {
        name: "coverageLexicalV3SnapshotManifests",
        table: this.db.coverageLexicalV3SnapshotManifests,
      },
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
    const lexicalColdEvidenceBreakdown = this.estimateLexicalColdEvidenceBreakdown(
      await this.db.lexicalBodyEvidence.toArray(),
      await this.db.lexicalHanDocEvidence.toArray(),
      await this.db.lexicalHanBodyEvidence.toArray(),
    );

    return {
      totalBytes: tables.reduce((sum, item) => sum + item.bytes, 0),
      tables,
      hybridChunkBreakdown,
      hybridVectorBreakdown,
      lexicalColdEvidenceBreakdown,
    };
  }

  private estimateLexicalColdEvidenceBreakdown(
    bodyRows: LexicalBodyEvidenceRow[],
    hanDocRows: LexicalHanDocEvidenceRow[],
    hanBodyRows: LexicalHanBodyEvidenceRow[],
  ): LexicalColdEvidenceStorageBreakdown {
    const breakdown: LexicalColdEvidenceStorageBreakdown = {
      tables: {
        lexicalBodyEvidence: estimateValueBytes(bodyRows),
        lexicalHanDocEvidence: estimateValueBytes(hanDocRows),
        lexicalHanBodyEvidence: estimateValueBytes(hanBodyRows),
      },
      bodyEvidence: {
        rowMetadataBytes: 0,
        exactFamilySlotBytes: 0,
        exactPositionBytes: 0,
        supportFamilySlotBytes: 0,
        supportMaskBytes: 0,
      },
      hanDocEvidence: {
        rowMetadataBytes: 0,
        witnessMatchKeyBytes: 0,
        witnessTextBytes: 0,
        sourceMaskBytes: 0,
      },
      hanBodyEvidence: {
        rowMetadataBytes: 0,
        witnessMatchKeyBytes: 0,
        witnessTextBytes: 0,
        startOffsetBytes: 0,
      },
      witnessTextDedup: {
        totalBytes: 0,
        rowLocalUniqueBytes: 0,
        docLocalUniqueBytes: 0,
      },
    };
    const docLocalWitnessTexts = new Map<DocRef, Set<string>>();

    for (const row of bodyRows) {
      breakdown.bodyEvidence.rowMetadataBytes += estimateLexicalEvidenceRowKeyBytes(row);
      const bodyPayloadBreakdown = estimatePackedBodyEvidencePayloadBytes(
        row.bodyEvidencePayload,
      );
      breakdown.bodyEvidence.exactFamilySlotBytes +=
        bodyPayloadBreakdown.exactFamilySlotBytes;
      breakdown.bodyEvidence.exactPositionBytes +=
        bodyPayloadBreakdown.exactPositionBytes;
      breakdown.bodyEvidence.supportFamilySlotBytes +=
        bodyPayloadBreakdown.supportFamilySlotBytes;
      breakdown.bodyEvidence.supportMaskBytes += bodyPayloadBreakdown.supportMaskBytes;
    }

    for (const row of hanDocRows) {
      breakdown.hanDocEvidence.rowMetadataBytes += estimateLexicalEvidenceRowKeyBytes(row);
      breakdown.hanDocEvidence.witnessMatchKeyBytes += estimateValueBytes(
        row.identityWitnessMatchKeys,
      );
      breakdown.hanDocEvidence.witnessMatchKeyBytes += estimateValueBytes(
        row.routeWitnessMatchKeys,
      );
      breakdown.hanDocEvidence.witnessMatchKeyBytes += estimateValueBytes(
        row.headingWitnessMatchKeys,
      );
      breakdown.hanDocEvidence.witnessTextBytes += estimateValueBytes(
        row.identityWitnessTexts,
      );
      breakdown.hanDocEvidence.witnessTextBytes += estimateValueBytes(row.routeWitnessTexts);
      breakdown.hanDocEvidence.witnessTextBytes += estimateValueBytes(
        row.headingWitnessTexts,
      );
      const witnessTexts = [
        ...(row.identityWitnessTexts ?? []),
        ...(row.routeWitnessTexts ?? []),
        ...(row.headingWitnessTexts ?? []),
      ];
      breakdown.witnessTextDedup.totalBytes += estimateStringListBytes(witnessTexts);
      breakdown.witnessTextDedup.rowLocalUniqueBytes += estimateUniqueStringBytes(witnessTexts);
      addDocLocalWitnessTexts(docLocalWitnessTexts, row.docRef, witnessTexts);
      breakdown.hanDocEvidence.sourceMaskBytes += estimateValueBytes(
        row.identityWitnessSourceMaskByDocEntry,
      );
      breakdown.hanDocEvidence.sourceMaskBytes += estimateValueBytes(
        row.routeWitnessSourceMaskByDocEntry,
      );
    }

    for (const row of hanBodyRows) {
      breakdown.hanBodyEvidence.rowMetadataBytes += estimateLexicalEvidenceRowKeyBytes(row);
      breakdown.hanBodyEvidence.witnessMatchKeyBytes += estimateValueBytes(
        row.bodyWitnessMatchKeys,
      );
      breakdown.hanBodyEvidence.witnessTextBytes += estimateValueBytes(row.bodyWitnessTexts);
      breakdown.witnessTextDedup.totalBytes += estimateStringListBytes(
        row.bodyWitnessTexts ?? [],
      );
      breakdown.witnessTextDedup.rowLocalUniqueBytes += estimateUniqueStringBytes(
        row.bodyWitnessTexts ?? [],
      );
      addDocLocalWitnessTexts(
        docLocalWitnessTexts,
        row.docRef,
        row.bodyWitnessTexts ?? [],
      );
      breakdown.hanBodyEvidence.startOffsetBytes += estimateValueBytes(
        row.bodyWitnessStartOffsets,
      );
    }

    for (const texts of docLocalWitnessTexts.values()) {
      breakdown.witnessTextDedup.docLocalUniqueBytes += estimateUniqueStringBytes(texts);
    }

    return breakdown;
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

  private async openWithUpgradeRecovery(): Promise<DatabaseOpenRecoveryReport | null> {
    try {
      await this.db.open();
      return null;
    } catch (error) {
      if (!this.isDexieUpgradeError(error)) {
        throw error;
      }

      const recoveryKey = [
        this.db.dbName,
        this.db.dbVersion,
        error.name,
        error.message,
      ].join("|");
      if (Database.attemptedUpgradeRecoveryKeys.has(recoveryKey)) {
        throw error;
      }
      Database.attemptedUpgradeRecoveryKeys.add(recoveryKey);

      const initialErrorName = error.name;
      const initialErrorMessage = error.message;
      const initialErrorSummary = {
        dbName: this.db.dbName,
        targetVersion: this.db.dbVersion,
        errorName: initialErrorName,
        errorMessage: initialErrorMessage,
      };

      this.db.close();
      console.warn(
        "[clever-search] Dexie startup upgrade failed; attempting targeted index reset.",
        initialErrorSummary,
      );

      try {
        await this.resetTargetedPersistentIndexState();
        await this.db.open();
        console.warn(
          "[clever-search] Dexie startup upgrade recovered by clearing persisted lexical/hybrid indexes. Settings and token stats were preserved.",
          initialErrorSummary,
        );
        return {
          mode: "targeted-reset",
          dbName: this.db.dbName,
          targetVersion: this.db.dbVersion,
          initialErrorName,
          initialErrorMessage,
          preservedTokenStats: true,
        };
      } catch (targetedResetError) {
        console.warn(
          "[clever-search] Targeted Dexie recovery failed; deleting the local Clever Search database as a final fallback.",
          {
            ...initialErrorSummary,
            targetedResetError,
          },
        );
      }

      const preservedUserState = await this.exportUserStateBeforeFullReset();
      this.db.close();
      await this.deleteDatabaseByName(this.db.dbName);

      try {
        await this.db.open();
        const restoreReport = await this.restoreUserStateAfterFullReset(
          preservedUserState,
        );
        console.warn(
          "[clever-search] Dexie startup upgrade recovered by rebuilding the local search database. Settings and token stats were restored best-effort.",
          { ...initialErrorSummary, restoreReport },
        );
        return {
          mode: "full-reset",
          dbName: this.db.dbName,
          targetVersion: this.db.dbVersion,
          initialErrorName,
          initialErrorMessage,
          preservedTokenStats: restoreReport.tokenRowsRestored > 0,
          preservedSettings: restoreReport.settingsRestored,
        };
      } catch (finalError) {
        console.warn(
          "[clever-search] Dexie startup upgrade recovery failed even after deleting the local search database.",
          {
            ...initialErrorSummary,
            finalError,
          },
        );
        throw error;
      }
    }
  }

  private isDexieUpgradeError(
    error: unknown,
  ): error is Error & { name: string; message: string } {
    return (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      "message" in error &&
      (error as { name?: unknown }).name === "UpgradeError"
    );
  }

  private async exportUserStateBeforeFullReset(): Promise<FullResetPreservedUserState | null> {
    try {
      const database = await this.openIndexedDbByName(this.db.dbName);
      try {
        const storeNames = new Set(Array.from(database.objectStoreNames));
        return {
          pluginSettingRows: storeNames.has("pluginSetting")
            ? await this.readAllRowsFromRawStore<{ id?: number; data: OuterSetting }>(
                database,
                "pluginSetting",
              )
            : [],
          hybridTokenStatsRows: storeNames.has("hybridTokenStats")
            ? await this.readAllRowsFromRawStore<HybridTokenRecord>(
                database,
                "hybridTokenStats",
              )
            : [],
          hybridTokenSavingsRows: storeNames.has("hybridTokenSavings")
            ? await this.readAllRowsFromRawStore<HybridTokenSavingRecord>(
                database,
                "hybridTokenSavings",
              )
            : [],
          hybridTokenBudgetResetRows: storeNames.has("hybridTokenBudgetResets")
            ? await this.readAllRowsFromRawStore<HybridTokenBudgetResetRecord>(
                database,
                "hybridTokenBudgetResets",
              )
            : [],
        };
      } finally {
        database.close();
      }
    } catch (error) {
      console.warn(
        "[clever-search] Failed to export settings/token stats before full database reset; continuing recovery.",
        error,
      );
      return null;
    }
  }

  private async restoreUserStateAfterFullReset(
    state: FullResetPreservedUserState | null,
  ): Promise<{ settingsRestored: boolean; tokenRowsRestored: number }> {
    if (state == null) {
      return { settingsRestored: false, tokenRowsRestored: 0 };
    }
    try {
      await this.db.transaction(
        "rw",
        this.db.pluginSetting,
        this.db.hybridTokenStats,
        this.db.hybridTokenSavings,
        this.db.hybridTokenBudgetResets,
        async () => {
          if (state.pluginSettingRows.length > 0) {
            await this.db.pluginSetting.bulkPut(state.pluginSettingRows);
          }
          if (state.hybridTokenStatsRows.length > 0) {
            await this.db.hybridTokenStats.bulkPut(state.hybridTokenStatsRows);
          }
          if (state.hybridTokenSavingsRows.length > 0) {
            await this.db.hybridTokenSavings.bulkPut(state.hybridTokenSavingsRows);
          }
          if (state.hybridTokenBudgetResetRows.length > 0) {
            await this.db.hybridTokenBudgetResets.bulkPut(
              state.hybridTokenBudgetResetRows,
            );
          }
        },
      );
      return {
        settingsRestored: state.pluginSettingRows.length > 0,
        tokenRowsRestored:
          state.hybridTokenStatsRows.length +
          state.hybridTokenSavingsRows.length +
          state.hybridTokenBudgetResetRows.length,
      };
    } catch (error) {
      console.warn(
        "[clever-search] Failed to restore settings/token stats after full database reset; continuing recovery.",
        error,
      );
      return { settingsRestored: false, tokenRowsRestored: 0 };
    }
  }

  private async readAllRowsFromRawStore<Row>(
    database: IDBDatabase,
    storeName: string,
  ): Promise<Row[]> {
    return await new Promise<Row[]>((resolve, reject) => {
      const transaction = database.transaction([storeName], "readonly");
      const request = transaction.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as Row[]);
      request.onerror = () =>
        reject(request.error ?? new Error(`Failed to read ${storeName}.`));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error(`Failed to read ${storeName}.`));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error(`Read ${storeName} aborted.`));
    });
  }

  private async resetTargetedPersistentIndexState(): Promise<void> {
    const database = await this.openIndexedDbByName(this.db.dbName);
    try {
      const availableStoreNames = new Set(Array.from(database.objectStoreNames));
      const storeNames = TARGETED_INDEX_RESET_TABLES.filter((storeName) =>
        availableStoreNames.has(storeName),
      );
      const shouldTouchMeta = availableStoreNames.has("docRegistryMeta");
      if (storeNames.length === 0 && !shouldTouchMeta) {
        return;
      }
      const transactionStores = shouldTouchMeta
        ? [...storeNames, "docRegistryMeta"]
        : [...storeNames];
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(transactionStores, "readwrite");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () =>
          reject(transaction.error ?? new Error("Targeted index reset failed."));
        transaction.onabort = () =>
          reject(transaction.error ?? new Error("Targeted index reset aborted."));
        for (const storeName of storeNames) {
          transaction.objectStore(storeName).clear();
        }
        if (shouldTouchMeta) {
          const metaStore = transaction.objectStore("docRegistryMeta");
          metaStore.delete(DOC_REGISTRY_NEXT_REF_KEY);
          metaStore.delete(LEXICAL_QUERY_EVIDENCE_READY_KEY);
        }
      });
    } finally {
      database.close();
    }
  }

  private async openIndexedDbByName(name: string): Promise<IDBDatabase> {
    return await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onerror = () =>
        reject(request.error ?? new Error(`Failed to open IndexedDB ${name}.`));
      request.onsuccess = () => resolve(request.result);
      request.onblocked = () =>
        reject(new Error(`Opening IndexedDB ${name} was blocked.`));
    });
  }

  private async deleteDatabaseByName(name: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onerror = () =>
        reject(request.error ?? new Error(`Failed to delete IndexedDB ${name}.`));
      request.onsuccess = () => resolve();
      request.onblocked = () =>
        reject(new Error(`Deleting IndexedDB ${name} was blocked.`));
    });
  }

}

export class DexieWrapper extends Dexie {
  // Dexie keeps one decimal place for version() and multiplies by 10 when opening IndexedDB.
  // Use 0.1 increments here so app-level schema bumps stay readable while mapping to IDB integers.
  private static readonly _dbVersion = 29.5;
  private static readonly dbNamePrefix = "clever-search/";
  static readonly docRegistryNextRefKey = DOC_REGISTRY_NEXT_REF_KEY;
  static readonly lexicalQueryEvidenceReadyKey = LEXICAL_QUERY_EVIDENCE_READY_KEY;
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
  lexicalBodyEvidence!: Dexie.Table<LexicalBodyEvidenceRow, string>;
  lexicalHanDocEvidence!: Dexie.Table<LexicalHanDocEvidenceRow, string>;
  lexicalHanBodyEvidence!: Dexie.Table<LexicalHanBodyEvidenceRow, string>;
  docRegistry!: Dexie.Table<DocRegistryRow, number>;
  coverageLexicalV3ShardRegistry!: Dexie.Table<CoverageLexicalV3ShardRegistryRow, string>;
  coverageLexicalV3Invalidations!: Dexie.Table<CoverageLexicalV3InvalidationRow, string>;
  coverageLexicalV3ResidentShardArtifacts!: Dexie.Table<CoverageLexicalV3ResidentShardArtifactRow, string>;
  coverageLexicalV3ActiveOverlayJournal!: Dexie.Table<CoverageLexicalV3ActiveOverlayJournalRow, string>;
  coverageLexicalV3CompactJobs!: Dexie.Table<CoverageLexicalV3CompactJobManifestRow, string>;
  coverageLexicalV3CompactTempArtifacts!: Dexie.Table<CoverageLexicalV3CompactTempArtifactRow, string>;
  coverageLexicalV3SnapshotManifests!: Dexie.Table<CoverageLexicalV3SnapshotManifestRow, string>;
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

  constructor(privateApi: PrivateApi) {
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
    // Primary-key changes must always go through a bridge version that drops
    // the old stores first. Dexie cannot rewrite an existing object store's
    // primary key in place.
    // Bridge the 28.2 -> 28.4 lexical evidence key migration.
    // Dexie cannot rewrite an existing object store's primary key in place, so
    // we drop the pre-shard-aware legacy evidence stores one version earlier
    // and recreate the canonical evidence stores at 28.4.
    this.version(28.3)
      .stores({
        pluginSetting: "++id",
        lexicalSearchSnapshots: "++id",
        lexicalIndexedFileRefs: "path",
        lexicalIndexedMetadata: "filePath",
        lexicalFuzzyRescue: "id",
        lexicalBodyFamilySupport: "id",
        lexicalExactTapes: "id",
        lexicalHanWitness: "id",
        docRegistry: "docRef, path, deleted, liveGeneration, updatedAt",
        coverageLexicalV3ShardRegistry: "shardId, state, createdOrder",
        coverageLexicalV3Invalidations:
          "id, shardId, docRef, docGeneration, [shardId+shardGeneration+docRef+docGeneration]",
        coverageLexicalV3ResidentShardArtifacts:
          "id, shardId, generation, artifactOwner, [artifactOwner+generation]",
        coverageLexicalV3ActiveOverlayJournal:
          "id, sequence, activeShardId, activeShardGeneration, [activeShardId+activeShardGeneration+sequence]",
          coverageLexicalV3CompactJobs: "jobId, status, createdAt, updatedAt",
          coverageLexicalV3CompactTempArtifacts: "jobId, outputShardId, createdAt",
          coverageLexicalV3SnapshotManifests: "snapshotId, status, createdAt",
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
          tx.table("lexicalSearchSnapshots").clear(),
          tx.table("lexicalIndexedFileRefs").clear(),
          tx
            .table("docRegistryMeta")
            .delete(DexieWrapper.lexicalQueryEvidenceReadyKey),
        ]);
      });
    this.version(28.4)
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
        coverageLexicalV3ShardRegistry: "shardId, state, createdOrder",
        coverageLexicalV3Invalidations:
          "id, shardId, docRef, docGeneration, [shardId+shardGeneration+docRef+docGeneration]",
        coverageLexicalV3ResidentShardArtifacts:
          "id, shardId, generation, artifactOwner, [artifactOwner+generation]",
        coverageLexicalV3ActiveOverlayJournal:
          "id, sequence, activeShardId, activeShardGeneration, [activeShardId+activeShardGeneration+sequence]",
          coverageLexicalV3CompactJobs: "jobId, status, createdAt, updatedAt",
          coverageLexicalV3CompactTempArtifacts: "jobId, outputShardId, createdAt",
          coverageLexicalV3SnapshotManifests: "snapshotId, status, createdAt",
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
    this.version(DexieWrapper._dbVersion)
      .stores({
        pluginSetting: "++id",
        lexicalSearchSnapshots: "++id",
        lexicalIndexedFileRefs: "path",
        lexicalIndexedMetadata: "filePath",
        lexicalFuzzyRescue: "id",
        lexicalBodyEvidence:
          "id, shardId, shardGeneration, docRef, generation, blockOrdinal, [shardId+shardGeneration+docRef+generation+blockOrdinal]",
        lexicalHanDocEvidence:
          "id, shardId, shardGeneration, docRef, generation, [shardId+shardGeneration+docRef+generation]",
        lexicalHanBodyEvidence:
          "id, shardId, shardGeneration, docRef, generation, blockOrdinal, [shardId+shardGeneration+docRef+generation+blockOrdinal]",
          docRegistry: "docRef, path, deleted, liveGeneration, updatedAt",
          coverageLexicalV3ShardRegistry: "shardId, state, createdOrder",
          coverageLexicalV3Invalidations:
            "id, shardId, docRef, docGeneration, [shardId+shardGeneration+docRef+docGeneration]",
          coverageLexicalV3ResidentShardArtifacts:
            "id, shardId, generation, artifactOwner, [artifactOwner+generation]",
          coverageLexicalV3ActiveOverlayJournal:
            "id, sequence, activeShardId, activeShardGeneration, [activeShardId+activeShardGeneration+sequence]",
          coverageLexicalV3CompactJobs: "jobId, status, createdAt, updatedAt",
          coverageLexicalV3CompactTempArtifacts: "jobId, outputShardId, createdAt",
          coverageLexicalV3SnapshotManifests: "snapshotId, status, createdAt",
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
          tx
            .table("docRegistryMeta")
            .delete(DexieWrapper.lexicalQueryEvidenceReadyKey),
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

function estimateLexicalEvidenceRowKeyBytes(row: {
  id: string;
  docRef: DocRef;
  generation: number;
  blockOrdinal?: number;
}): number {
  return (
    estimateValueBytes(row.id) +
    estimateValueBytes(row.docRef) +
    estimateValueBytes(row.generation) +
    estimateValueBytes(row.blockOrdinal)
  );
}

function estimatePackedBodyEvidencePayloadBytes(payload: Uint8Array): {
  exactFamilySlotBytes: number;
  exactPositionBytes: number;
  supportFamilySlotBytes: number;
  supportMaskBytes: number;
} {
  const breakdown = {
    exactFamilySlotBytes: 0,
    exactPositionBytes: 0,
    supportFamilySlotBytes: 0,
    supportMaskBytes: 0,
  };
  if (payload.length < 2 || payload[0] !== 1) {
    return breakdown;
  }
  const laneCount = payload[1] ?? 0;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  for (let laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
    const headerOffset = 2 + laneIndex * 5;
    const kind = payload[headerOffset] ?? 0;
    const length = view.getUint32(headerOffset + 1, true);
    const bytes = length * estimatePackedUnsignedLaneBytesPerElement(kind);
    if (laneIndex === 0) {
      breakdown.exactFamilySlotBytes += bytes;
    } else if (laneIndex === 1) {
      breakdown.exactPositionBytes += bytes;
    } else if (laneIndex === 2) {
      breakdown.supportFamilySlotBytes += bytes;
    } else if (laneIndex === 3) {
      breakdown.supportMaskBytes += bytes;
    }
  }
  return breakdown;
}

function estimatePackedUnsignedLaneBytesPerElement(kind: number): 0 | 1 | 2 | 4 {
  switch (kind) {
    case 1:
      return 1;
    case 2:
      return 2;
    case 3:
      return 4;
    default:
      return 0;
  }
}

function estimateStringListBytes(values: Iterable<string>): number {
  let bytes = 0;
  for (const value of values) {
    bytes += estimateValueBytes(value);
  }
  return bytes;
}

function estimateUniqueStringBytes(values: Iterable<string>): number {
  return estimateStringListBytes(new Set(values));
}

function addDocLocalWitnessTexts(
  textsByDocRef: Map<DocRef, Set<string>>,
  docRef: DocRef,
  values: Iterable<string>,
): void {
  let texts = textsByDocRef.get(docRef);
  if (texts === undefined) {
    texts = new Set<string>();
    textsByDocRef.set(docRef, texts);
  }
  for (const value of values) {
    texts.add(value);
  }
}
