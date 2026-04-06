import type {
	FileSubItem,
	IndexedDocument,
	MatchedFile,
} from "src/globals/search-types";
import type { FileSearchBackend } from "src/globals/plugin-setting";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { CoverageLexicalFileSearchEngine } from "./coverage-lexical/coverage-lexical-engine";

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

export interface FileSearchEngine {
	readonly backend: FileSearchBackend;
	readonly supportsSerialization: boolean;
	reIndexAll(data: IndexedDocument[] | SerializedFileSearchIndex): Promise<boolean>;
	clearIndex(): void;
	addDocuments(documents: IndexedDocument[]): Promise<void>;
	deleteDocuments(paths: string[]): void;
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
}

@singleton()
export class FileSearchEngineFactory {
	private readonly coverageLexical = getInstance(CoverageLexicalFileSearchEngine);

	getActiveEngine(): FileSearchEngine {
		return this.coverageLexical;
	}
}
