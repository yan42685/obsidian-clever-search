import type {
	BaseIndexedFileRef,
	FileSubItem,
	IndexedDocument,
	MatchedFile,
} from "src/globals/search-types";
import type { FileSearchBackend } from "src/globals/plugin-setting";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { CoverageLexicalV2FileSearchEngine } from "./coverage-lexical-v2/index-store/coverage-lexical-v2-file-search-engine";

export type FileSearchRequest = {
	queryText: string;
	isPrefixMatch: boolean;
	isFuzzy: boolean;
	maxItemResults: number;
	maxDirectSubItemResults?: number;
	maxSubItemResults?: number;
};

export type SerializedCoverageLexicalBinarySnapshot = {
	__backend: "coverage-lexical";
	__version: 1 | 2;
	__encoding: "binary-snapshot-v1" | "binary-snapshot-v2";
	data: ArrayBuffer;
};

export type SerializedUnsupportedLegacyFileSearchIndex = Record<string, unknown>;

export type SerializedFileSearchIndex =
	| SerializedCoverageLexicalBinarySnapshot
	| SerializedUnsupportedLegacyFileSearchIndex;

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
	persistFileIndexArtifact?(): Promise<void>;
	clearPersistedFileIndexArtifact?(): Promise<void>;
	beginBatchReindex?(): void;
	finishBatchReindex?(): void | Promise<void>;
	abortBatchReindex?(): void | Promise<void>;
}

@singleton()
export class FileSearchEngineFactory {
	private readonly coverageLexical = getInstance(CoverageLexicalV2FileSearchEngine);

	getActiveEngine(): FileSearchEngine {
		return this.coverageLexical;
	}
}
