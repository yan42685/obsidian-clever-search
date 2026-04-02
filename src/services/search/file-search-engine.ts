import type { AsPlainObject, Options, SearchOptions } from "minisearch";
import MiniSearch from "minisearch";
import type {
	DocumentFields,
	DocumentWeight,
	FileSubItem,
	IndexedDocument,
	LineFields,
	MatchedFile,
} from "src/globals/search-types";
import {
	OuterSetting,
	innerSetting,
	type FileSearchBackend,
} from "src/globals/plugin-setting";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { CoverageLexicalFileSearchEngine } from "./coverage-lexical/coverage-lexical-engine";
import { Tokenizer } from "./tokenizer";

export type FileSearchRequest = {
	queryText: string;
	isPrefixMatch: boolean;
	isFuzzy: boolean;
	maxItemResults: number;
	maxDirectSubItemResults?: number;
	maxSubItemResults?: number;
};

type SerializedUnsupportedTaggedFileSearchIndex = {
	__backend: string;
	__version?: unknown;
	__encoding?: unknown;
	__format?: unknown;
	data?: unknown;
	documents?: unknown;
};

export type SerializedCoverageLexicalBinarySnapshot = {
	__backend: "coverage-lexical";
	__version: 1 | 2;
	__encoding: "binary-snapshot-v1" | "binary-snapshot-v2";
	data: ArrayBuffer;
};

export type SerializedFileSearchIndex =
	| AsPlainObject
	| SerializedCoverageLexicalBinarySnapshot
	| SerializedUnsupportedTaggedFileSearchIndex;

export interface FileSearchEngine {
	readonly backend: FileSearchBackend;
	readonly supportsSerialization: boolean;
	reIndexAll(data: IndexedDocument[] | SerializedFileSearchIndex): Promise<boolean>;
	clearIndex(): void;
	addDocuments(documents: IndexedDocument[]): Promise<void>;
	deleteDocuments(paths: string[]): void;
	searchFiles(request: FileSearchRequest): Promise<MatchedFile[]>;
	getDirectSubItems?(
		queryText: string,
		path: string,
		maxSubItemResults: number,
	): Promise<FileSubItem[] | null>;
	serialize(): SerializedFileSearchIndex | null;
	estimateIndexBytes?(): number | null;
	getIndexBreakdown?(): Record<string, unknown> | null;
	debugTermAvailability?(term: string): Record<string, unknown> | null;
}

@singleton()
export class FileSearchOptions {
	private readonly outerSetting = getInstance(OuterSetting);
	private readonly inSetting = innerSetting.search;
	private readonly tokenizer = getInstance(Tokenizer);
	private readonly tokenizeIndex = (text: string) =>
		this.tokenizer.tokenize(text, "index");
	private readonly tokenizeSearch = (text: string) =>
		this.tokenizer.tokenize(text, "search");

	readonly documentChunkSize = 100;
	readonly lineChunkSize = 500;
	readonly fileIndexOption: Options = {
		tokenize: this.tokenizeIndex,
		idField: "path",
		fields: [
			"basename",
			"aliases",
			"folder",
			"tags",
			"headings",
			"content",
		] as DocumentFields,
		storeFields: ["tags"] as DocumentFields,
		processTerm: (term) =>
			this.outerSetting.isCaseSensitive ? term : term.toLocaleLowerCase(),
	};
	readonly lineIndexOption: Options = {
		tokenize: this.tokenizeIndex,
		idField: "row",
		fields: ["text"] as LineFields,
	};

	buildFileSearchOption(request: FileSearchRequest): SearchOptions {
		return {
			tokenize: this.tokenizeSearch,
			prefix: (term) =>
				request.isPrefixMatch
					? term.length >= this.inSetting.minTermLengthForPrefixSearch
					: false,
			fuzzy: (term) =>
				request.isFuzzy
					? term.length <= 3
						? 0
						: this.inSetting.fuzzyProportion
					: false,
			boost: {
				basename: this.inSetting.weightFilename,
				aliases: this.inSetting.weightFilename,
				folder: this.inSetting.weightFolder,
				tags: this.inSetting.weightTagText,
				headings: this.inSetting.weightHeading,
			} as DocumentWeight,
			combineWith: "and",
		};
	}

	getLineSearchOption(): SearchOptions {
		return {
			prefix: (term) =>
				term.length >= this.inSetting.minTermLengthForPrefixSearch,
			fuzzy: (term) =>
				term.length <= 3 ? 0 : this.inSetting.fuzzyProportion,
			combineWith: "or",
		};
	}
}

@singleton()
export class MiniSearchFileEngine implements FileSearchEngine {
	readonly backend: FileSearchBackend = "minisearch";
	readonly supportsSerialization = true;
	private readonly option = getInstance(FileSearchOptions);
	private filesIndex = new MiniSearch(this.option.fileIndexOption);

	async reIndexAll(
		data: IndexedDocument[] | SerializedFileSearchIndex,
	): Promise<boolean> {
		this.clearIndex();

		if (Array.isArray(data)) {
			logger.trace("Indexing all documents...");
			await this.addDocuments(data);
			return true;
		}

		logger.trace("Loading indexed data...");
		try {
			if (!isSerializedMiniSearchFileIndex(data)) {
				return false;
			}
			this.filesIndex = MiniSearch.loadJS(
				data,
				this.option.fileIndexOption,
			);
			return true;
		} catch (error) {
			logger.error(error);
			return false;
		}
	}

	async addDocuments(documents: IndexedDocument[]) {
		const paths = documents.map((doc) => doc.path);
		const existingPaths = paths.filter((path) => this.filesIndex.has(path));
		if (existingPaths.length > 0) {
			this.filesIndex.discardAll(existingPaths);
		}
		await this.filesIndex.addAllAsync(documents, {
			chunkSize: this.option.documentChunkSize,
		});
		logger.debug(`updated/added ${documents.length} docs`);
	}

	clearIndex(): void {
		this.filesIndex.removeAll();
	}

	deleteDocuments(paths: string[]) {
		const docsToDiscard = paths.filter((path) => this.filesIndex.has(path));
		this.filesIndex.discardAll(docsToDiscard);
		logger.debug(`deleted ${docsToDiscard.length}`);
	}

	async searchFiles(request: FileSearchRequest): Promise<MatchedFile[]> {
		const minisearchResult = this.filesIndex.search(
			request.queryText,
			this.option.buildFileSearchOption(request),
		);
		return minisearchResult
			.slice(0, request.maxItemResults)
			.map((item) => ({
				path: String(item.id),
				queryTerms: item.queryTerms,
				matchedTerms: item.terms,
				score: item.score,
			}));
	}

	serialize(): SerializedFileSearchIndex | null {
		return this.filesIndex.toJSON();
	}
}

@singleton()
export class FileSearchEngineFactory {
	private readonly miniSearch = getInstance(MiniSearchFileEngine);
	private readonly coverageLexical = getInstance(CoverageLexicalFileSearchEngine);

	getActiveEngine(): FileSearchEngine {
		return this.coverageLexical;
	}

	getEngineForBenchmark(backend: FileSearchBackend): FileSearchEngine {
		return backend === "minisearch" ? this.miniSearch : this.coverageLexical;
	}
}

function isSerializedUnsupportedTaggedFileSearchIndex(
	data: SerializedFileSearchIndex,
): data is SerializedUnsupportedTaggedFileSearchIndex {
	return (
		typeof data === "object" &&
		data !== null &&
		"__backend" in data &&
		(data as Record<string, unknown>).__backend !== "coverage-lexical"
	);
}

function isSerializedCoverageLexicalBinarySnapshot(
	data: SerializedFileSearchIndex,
): data is SerializedCoverageLexicalBinarySnapshot {
	return (
		typeof data === "object" &&
		data !== null &&
		((((data as Record<string, unknown>).__version === 1 &&
			(data as Record<string, unknown>).__encoding === "binary-snapshot-v1") ||
			((data as Record<string, unknown>).__version === 2 &&
				(data as Record<string, unknown>).__encoding === "binary-snapshot-v2"))) &&
		(data as Record<string, unknown>).data instanceof ArrayBuffer &&
		(data as Record<string, unknown>).__backend === "coverage-lexical"
	);
}

function isSerializedMiniSearchFileIndex(
	data: SerializedFileSearchIndex,
): data is AsPlainObject {
	return (
		typeof data === "object" &&
		data !== null &&
		!isSerializedUnsupportedTaggedFileSearchIndex(data) &&
		!isSerializedCoverageLexicalBinarySnapshot(data)
	);
}
