import type {
	BaseIndexedFileRef,
	FileSubItem,
	IndexedDocument,
	MatchedFile,
} from "src/globals/search-types";
import type {
	FileSearchBackend,
	WeakFilePruneMode,
} from "src/globals/plugin-setting";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { CoverageLexicalV3FileSearchEngine } from "./coverage-lexical-v3";

export type FileSearchRequest = {
	queryText: string;
	isPrefixMatch: boolean;
	isFuzzy: boolean;
	hideWeaklyRelatedResults?: boolean;
	weakFilePruneMode?: WeakFilePruneMode;
	maxItemResults: number;
	maxDirectSubItemResults?: number;
	maxSubItemResults?: number;
};

export type SerializedFileSearchIndex = Record<string, unknown>;

export type PersistentFileIndexRecoveryMove = {
	oldPath: string;
	newPath: string;
};

export type PersistentFileIndexRecoveryPlan = {
	status: "up_to_date" | "needs_heal" | "needs_full_rebuild";
	reason:
		| "up_to_date"
		| "missing_snapshot"
		| "snapshot_corrupted"
		| "snapshot_version_mismatch"
		| "doc_registry_conflict"
		| "manifest_missing"
		| "persisted_ref_mismatch"
		| "journal_corruption"
		| "vault_drift"
		| "cold_sidecar_drift";
	docsToDelete: string[];
	docsToAdd: string[];
	docsToUpdate: string[];
	docsToMove: PersistentFileIndexRecoveryMove[];
};

export type PersistentFileIndexRecoveryChanges = {
	deletePaths: string[];
	upsertDocuments: IndexedDocument[];
};

export type FileSearchIndexTimingPhaseSummary = {
	phase: string;
	totalMs: number;
	maxMs: number;
	count: number;
	unitCount: number;
	avgMsPerCall: number;
	avgMsPerUnit: number;
	shareOfMeasuredMs: number;
};

export type FileSearchIndexTimingSummary = {
	batchCount: number;
	documentCount: number;
	bodyTokenCount: number;
	exactTermCount: number;
	metadataHanBigramCount: number;
	bodyHanSegmentCount: number;
	bodyHanLogicalBlockCount: number;
	totalMeasuredMs: number;
	phases: FileSearchIndexTimingPhaseSummary[];
};

export interface FileSearchEngine {
	readonly backend: FileSearchBackend;
	readonly supportsSerialization: boolean;
	reIndexAll(data: IndexedDocument[] | SerializedFileSearchIndex): Promise<boolean>;
	clearIndex(): void;
	addDocuments(documents: IndexedDocument[]): Promise<void>;
	deleteDocuments(paths: string[]): void;
	moveDocument?(
		oldPath: string,
		document: IndexedDocument,
	): Promise<boolean>;
	searchFiles(request: FileSearchRequest): Promise<MatchedFile[]>;
	getIndexedDocumentCount?(): number | null;
	getDirectSubItems?(
		queryText: string,
		path: string,
		maxSubItemResults: number,
	): Promise<FileSubItem[] | null>;
	serialize(): SerializedFileSearchIndex | null;
	estimateIndexBytes?(): number | null;
	getIndexBreakdown?(): Record<string, unknown> | null;
	supportsPersistentFileIndex?(): boolean;
	restorePersistedFileIndex?(): Promise<boolean>;
	planPersistentRecovery?(
		currentIndexedRefs: readonly BaseIndexedFileRef[],
	): Promise<PersistentFileIndexRecoveryPlan>;
	applyPersistentRecoveryChanges?(
		changes: PersistentFileIndexRecoveryChanges,
	): Promise<boolean>;
	persistFileIndexArtifact?(): Promise<void>;
	clearPersistedFileIndexArtifact?(): Promise<void>;
	notifyIndexedTextsCommitted?(
		files: ReadonlyArray<{
			path: string;
			generation?: number;
		}>,
	): void;
	resetBenchmarkIndexTiming?(): void;
	getBenchmarkIndexTimingSummary?(): FileSearchIndexTimingSummary | null;
	beginBatchReindex?(): void;
	finishBatchReindex?(): void | Promise<void>;
	abortBatchReindex?(): void | Promise<void>;
}

@singleton()
export class FileSearchEngineFactory {
	private readonly coverageLexical = getInstance(CoverageLexicalV3FileSearchEngine);

	getActiveEngine(): FileSearchEngine {
		return this.coverageLexical;
	}
}
