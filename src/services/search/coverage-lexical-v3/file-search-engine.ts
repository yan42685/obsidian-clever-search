import type {
	FileSubItem,
	IndexedDocument,
	MatchedFile,
} from "src/globals/search-types";
import { buildDirectSubitemsExactFileSubItems } from "src/services/search/coverage-lexical/direct-subitems";
import { Tokenizer } from "src/services/search/tokenizer";
import { FileSnapshotStore } from "src/services/search/shared/file-snapshot-store";
import { getInstance } from "src/utils/my-lib";
import { container, singleton } from "tsyringe";
import type {
	FileSearchEngine,
	FileSearchRequest,
	SerializedFileSearchIndex,
} from "../file-search-engine";
import {
	CoverageLexicalV3Engine,
	type CoverageLexicalV3SearchResult,
} from "./engine";
import type {
	ResidentBaseMetrics,
	ResidentBaseSummary,
} from "./layout/types";

export type CoverageLexicalV3RuntimeMemoryBreakdown = Readonly<{
	__backend: "coverage-lexical-v3";
	metrics: ResidentBaseMetrics;
	summary: ResidentBaseSummary;
}>;

@singleton()
export class CoverageLexicalV3FileSearchEngine implements FileSearchEngine {
	readonly backend = "coverage-lexical" as const;
	readonly supportsSerialization = false;

	private engine = new CoverageLexicalV3Engine();
	private readonly documentsByPath = new Map<string, IndexedDocument>();
	private batchReindexing = false;

	async reIndexAll(
		data: IndexedDocument[] | SerializedFileSearchIndex,
	): Promise<boolean> {
		if (!Array.isArray(data)) {
			this.clearIndex();
			return false;
		}
		this.documentsByPath.clear();
		for (const document of data) {
			this.documentsByPath.set(document.path, cloneIndexedDocument(document));
		}
		this.rebuildResidentBase();
		return true;
	}

	clearIndex(): void {
		this.documentsByPath.clear();
		this.rebuildResidentBase();
	}

	async addDocuments(documents: IndexedDocument[]): Promise<void> {
		for (const document of documents) {
			this.documentsByPath.set(document.path, cloneIndexedDocument(document));
		}
		if (!this.batchReindexing) {
			this.rebuildResidentBase();
		}
	}

	deleteDocuments(paths: string[]): void {
		let changed = false;
		for (const path of paths) {
			changed = this.documentsByPath.delete(path) || changed;
		}
		if (changed && !this.batchReindexing) {
			this.rebuildResidentBase();
		}
	}

	async moveDocument(
		oldPath: string,
		document: IndexedDocument,
	): Promise<boolean> {
		if (oldPath !== document.path) {
			this.documentsByPath.delete(oldPath);
		}
		this.documentsByPath.set(document.path, cloneIndexedDocument(document));
		if (!this.batchReindexing) {
			this.rebuildResidentBase();
		}
		return true;
	}

	async searchFiles(request: FileSearchRequest): Promise<MatchedFile[]> {
		if (this.documentsByPath.size === 0) {
			return [];
		}
		const queryText = request.queryText.trim();
		if (queryText.length === 0) {
			return [];
		}
		const searchTerms = this.getQueryTerms(queryText);
		const result = this.engine.search(queryText, searchTerms);
		const queryTerms = result.recallState.queryAnalysis.primaryUnits.map((unit) => unit.text);
		return result.rankedCandidates.slice(0, request.maxItemResults).map((candidate) => ({
			path: candidate.path,
			queryTerms,
			matchedTerms: buildMatchedTerms(candidate, result),
			score: candidate.realizedCoverageCount,
			directSubItems: [],
			nativeSubItemsReady: false,
		}));
	}

	getIndexedDocumentCount(): number {
		return this.documentsByPath.size;
	}

	async getDirectSubItems(
		queryText: string,
		path: string,
		maxSubItemResults: number,
	): Promise<FileSubItem[] | null> {
		if (!this.documentsByPath.has(path)) {
			return null;
		}
		const snapshotText = (
			await this.getFileSnapshotStore().readCurrentTexts([path])
		).get(path);
		if (!snapshotText) {
			return null;
		}
		return buildDirectSubitemsExactFileSubItems({
			queryText,
			snapshotText,
			options: {
				maxChars: 220,
				mergeGap: 32,
				contextLeft: 24,
				contextRight: 40,
				boundaryLookaround: 24,
			},
		}).slice(0, maxSubItemResults);
	}

	serialize(): SerializedFileSearchIndex | null {
		return null;
	}

	estimateIndexBytes(): number {
		return this.engine.getResidentBaseMetrics()?.residentBytes ?? 0;
	}

	getIndexBreakdown(): CoverageLexicalV3RuntimeMemoryBreakdown | null {
		const metrics = this.engine.getResidentBaseMetrics();
		const summary = this.engine.describeResidentBase();
		if (!metrics || !summary) {
			return null;
		}
		return {
			__backend: "coverage-lexical-v3",
			metrics,
			summary,
		};
	}

	supportsPersistentFileIndex(): boolean {
		return false;
	}

	beginBatchReindex(): void {
		this.batchReindexing = true;
	}

	finishBatchReindex(): void {
		this.batchReindexing = false;
		this.rebuildResidentBase();
	}

	abortBatchReindex(): void {
		this.batchReindexing = false;
	}

	private rebuildResidentBase(): void {
		this.engine = new CoverageLexicalV3Engine();
		this.engine.buildResidentBase(
			[...this.documentsByPath.values()],
			(text) => this.getDocumentTerms(text),
		);
	}

	private getFileSnapshotStore(): FileSnapshotStore {
		return container.resolve(FileSnapshotStore);
	}

	private getQueryTerms(queryText: string): string[] {
		return getInstance(Tokenizer).tokenizeSequence(queryText, "search");
	}

	private getDocumentTerms(text: string): string[] {
		return getInstance(Tokenizer).tokenizeSequence(text, "index");
	}
}

function cloneIndexedDocument(document: IndexedDocument): IndexedDocument {
	return {
		path: document.path,
		generation: document.generation,
		size: document.size,
		basename: document.basename,
		folder: document.folder,
		content: document.content,
		aliases: document.aliases,
		tags: document.tags,
		headings: document.headings,
	};
}

function buildMatchedTerms(
	candidate: CoverageLexicalV3SearchResult["rankedCandidates"][number],
	result: CoverageLexicalV3SearchResult,
): string[] {
	const realizedFamilies = candidate.realizedFamilies.map((family) => family.familyText);
	if (realizedFamilies.length > 0) {
		return dedupePreservingOrder(realizedFamilies);
	}
	return dedupePreservingOrder(
		result.recallState.queryAnalysis.primaryUnits.map((unit) => unit.text),
	);
}

function dedupePreservingOrder(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const output: string[] = [];
	for (const value of values) {
		if (value.length === 0 || seen.has(value)) {
			continue;
		}
		seen.add(value);
		output.push(value);
	}
	return output;
}
