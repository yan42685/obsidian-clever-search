import type {
	BaseIndexedFileRef,
	FileSubItem,
	IndexedDocument,
	MatchedFile,
} from "src/globals/search-types";
import { container, singleton } from "tsyringe";
import { Database } from "src/services/database/database";
import { FileSnapshotStore } from "src/services/search/shared/file-snapshot-store";
import { Tokenizer } from "src/services/search/tokenizer";
import {
	buildDirectSubitemsExactFileSubItems,
} from "src/services/search/coverage-lexical/direct-subitems";
import {
	COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN,
	type CoverageLexicalBodyTokenColdDocumentWrite,
	type CoverageLexicalBodyTokenColdStoreApi,
} from "src/services/search/coverage-lexical/coverage-lexical-body-token-cold-types";
import {
	extractHanBigrams,
	extractHanSegments,
	splitCoverageLexicalTagValues,
} from "src/services/search/coverage-lexical/coverage-lexical-cjk";
import type {
	FileSearchEngine,
	FileSearchRequest,
	PersistentFileIndexRecoveryPlan,
	SerializedCoverageLexicalBinarySnapshot,
	SerializedFileSearchIndex,
} from "../../file-search-engine";
import {
	searchCoverageLexicalV2Engine,
} from "../coverage-lexical-v2-engine";
import {
	decodeCoverageLexicalV2IndexStoreSnapshot,
	encodeCoverageLexicalV2IndexStoreSnapshot,
} from "./coverage-lexical-v2-index-store-snapshot";
import {
	COVERAGE_LEXICAL_V2_INDEX_STORE_META_ID,
	type CoverageLexicalV2IndexStoreJournalEntry,
	type CoverageLexicalV2PersistedJournalDocument,
	type CoverageLexicalV2PreparedDocument,
	type CoverageLexicalV2RuntimeMemoryBreakdown,
} from "./coverage-lexical-v2-index-store-types";
import {
	planCoverageLexicalV2PersistentRecovery,
} from "./coverage-lexical-v2-index-store-recovery";
import {
	CoverageLexicalV2IndexStore,
	estimateCoverageLexicalV2BodyTokenIdSequenceBytes,
} from "./coverage-lexical-v2-index-store";

type CoverageLexicalV2PersistentStoreApi = {
	supportsPersistentFileIndex(): boolean;
	restorePersistedFileIndex(): Promise<boolean>;
	persistFileIndexArtifact(): Promise<void>;
	clearPersistedFileIndexArtifact(): Promise<void>;
	beginBatchReindex?(): void;
	finishBatchReindex?(): void | Promise<void>;
	abortBatchReindex?(): void | Promise<void>;
};

@singleton()
export class CoverageLexicalV2FileSearchEngine
	implements FileSearchEngine, CoverageLexicalV2PersistentStoreApi {
	readonly backend = "coverage-lexical" as const;
	readonly supportsSerialization = true;

	private readonly tokenizer = container.resolve(Tokenizer);
	private readonly database = container.resolve(Database);
	private readonly fileSnapshotStore = container.resolve(FileSnapshotStore);
	private readonly store = new CoverageLexicalV2IndexStore();
	private readonly bodyTokenCacheByDocId = new Map<number, Uint32Array>();
	private bodyTokenColdStore:
		| CoverageLexicalBodyTokenColdStoreApi
		| null
		| undefined;
	private batchReindexing = false;
	private journalTransactionOrdinal = 0;

	async reIndexAll(
		data: IndexedDocument[] | SerializedFileSearchIndex,
	): Promise<boolean> {
		if (Array.isArray(data)) {
			this.clearIndex();
			await this.addDocuments(data);
			return true;
		}
		if (!isSerializedCoverageLexicalBinarySnapshot(data)) {
			this.clearIndex();
			return false;
		}
		try {
			const snapshot = decodeCoverageLexicalV2IndexStoreSnapshot(data.data);
			this.clearIndex();
			this.store.restoreSnapshot(snapshot);
			return true;
		} catch {
			this.clearIndex();
			return false;
		}
	}

	clearIndex(): void {
		this.store.clear();
		this.bodyTokenCacheByDocId.clear();
	}

	beginBatchReindex(): void {
		this.batchReindexing = true;
	}

	finishBatchReindex(): void {
		this.batchReindexing = false;
		this.store.compactOverlayIntoSegment(true);
	}

	abortBatchReindex(): void {
		this.batchReindexing = false;
	}

	async addDocuments(documents: IndexedDocument[]): Promise<void> {
		const preparedDocuments = documents.map((document) =>
			buildCoverageLexicalV2PreparedDocument(this.tokenizer, document),
		);
		const journalEntries: CoverageLexicalV2IndexStoreJournalEntry[] = [];
		const coldWrites: CoverageLexicalBodyTokenColdDocumentWrite[] = [];
		const hotCacheDocIds: number[] = [];
		for (const preparedDocument of preparedDocuments) {
			const updatedAt = Date.now();
			const docId = this.store.replaceDocument(preparedDocument);
			if (preparedDocument.bodyTokens.length > 0) {
				this.bodyTokenCacheByDocId.set(
					docId,
					this.store.getOrCreateBodyTokenIds(preparedDocument.bodyTokens),
				);
				hotCacheDocIds.push(docId);
			} else {
				this.bodyTokenCacheByDocId.delete(docId);
			}
			coldWrites.push({
				path: preparedDocument.path,
				generation: preparedDocument.generation,
				bodyTokens: preparedDocument.bodyTokens,
			});
			if (!this.batchReindexing) {
				journalEntries.push({
					kind: "replace",
					path: preparedDocument.path,
					updatedAt,
					transaction: this.createJournalTransaction(
						`replace:${preparedDocument.path}`,
						updatedAt,
					),
					document: this.requirePersistedJournalDocument(docId),
				});
			}
		}
		this.store.compactOverlayIntoSegment();
		if (await this.upsertBodyTokenColdDocuments(coldWrites)) {
			this.releaseHotBodyTokenCache(hotCacheDocIds);
		}
		if (!this.batchReindexing) {
			await this.database.appendCoverageLexicalV2IndexStoreJournalEntries(
				journalEntries,
			);
		}
	}

	deleteDocuments(paths: string[]): void {
		if (paths.length === 0) {
			return;
		}
		const journalEntries: CoverageLexicalV2IndexStoreJournalEntry[] = [];
		const deletedPaths: string[] = [];
		for (const path of paths) {
			const docId = this.store.getDocumentId(path);
			if (docId === undefined) {
				continue;
			}
			const updatedAt = Date.now();
			this.store.deleteDocument(path);
			this.bodyTokenCacheByDocId.delete(docId);
			deletedPaths.push(path);
			if (!this.batchReindexing) {
				journalEntries.push({
					kind: "delete",
					path,
					updatedAt,
					transaction: this.createJournalTransaction(`delete:${path}`, updatedAt),
				});
			}
		}
		if (deletedPaths.length === 0) {
			return;
		}
		this.store.compactOverlayIntoSegment();
		void this.deleteBodyTokenColdDocuments(deletedPaths);
		if (!this.batchReindexing) {
			void this.database.appendCoverageLexicalV2IndexStoreJournalEntries(
				journalEntries,
			);
		}
	}

	async moveDocument(oldPath: string, document: IndexedDocument): Promise<boolean> {
		const preparedDocument = buildCoverageLexicalV2PreparedDocument(
			this.tokenizer,
			document,
		);
		const updatedAt = Date.now();
		const docId = this.store.replaceDocument(preparedDocument, oldPath);
		if (preparedDocument.bodyTokens.length > 0) {
			this.bodyTokenCacheByDocId.set(
				docId,
				this.store.getOrCreateBodyTokenIds(preparedDocument.bodyTokens),
			);
		} else {
			this.bodyTokenCacheByDocId.delete(docId);
		}
		const coldBacked = await this.upsertBodyTokenColdDocuments([
			{
				path: preparedDocument.path,
				generation: preparedDocument.generation,
				bodyTokens: preparedDocument.bodyTokens,
			},
		]);
		if (coldBacked && preparedDocument.bodyTokens.length > 0) {
			this.releaseHotBodyTokenCache([docId]);
		}
		if (oldPath !== preparedDocument.path) {
			await this.deleteBodyTokenColdDocuments([oldPath]);
		}
		this.store.compactOverlayIntoSegment();
		if (!this.batchReindexing) {
			await this.database.appendCoverageLexicalV2IndexStoreJournalEntries([
				{
					kind: "move",
					path: preparedDocument.path,
					previousPath: oldPath,
					updatedAt,
					transaction: this.createJournalTransaction(
						`move:${oldPath}->${preparedDocument.path}`,
						updatedAt,
					),
					document: this.requirePersistedJournalDocument(docId),
				},
			]);
		}
		return true;
	}

	async searchFiles(request: FileSearchRequest): Promise<MatchedFile[]> {
		if (this.store.getIndexedDocumentCount() === 0) {
			return [];
		}
		const result = await searchCoverageLexicalV2Engine({
			queryText: request.queryText,
			isPrefixMatch: request.isPrefixMatch,
			isFuzzy: request.isFuzzy,
			maxItemResults: request.maxItemResults,
			fuzzyProportion: 0.2,
			tokenizeQueryText: (queryText) =>
				tokenizeCoverageLexicalV2QueryText(this.tokenizer, queryText),
			storageReader: this.store.createStorageReader({
				getBodyTokenSequence: (docId) => {
					const tokenIds = this.bodyTokenCacheByDocId.get(docId);
					return tokenIds
						? this.store.decodeBodyTokenIds(tokenIds)
						: undefined;
				},
				prefetchBodyTokenSequences: async (docIds) => {
					await this.prefetchBodyTokenSequences(docIds);
				},
				tokenizeText: (text) =>
					tokenizeCoverageLexicalV2DocumentText(this.tokenizer, text),
			}),
		});
		return result.matchedFiles;
	}

	async getDirectSubItems(
		queryText: string,
		path: string,
		maxSubItemCount: number,
	): Promise<FileSubItem[] | null> {
		if (!this.store.hasPath(path)) {
			return null;
		}
		const snapshotText = (
			await this.fileSnapshotStore.readCurrentTexts([path])
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
		}).slice(0, maxSubItemCount);
	}

	getIndexedDocumentCount(): number {
		return this.store.getIndexedDocumentCount();
	}

	serialize(): SerializedFileSearchIndex | null {
		return {
			__backend: "coverage-lexical",
			__version: 2,
			__encoding: "binary-snapshot-v2",
			data: encodeCoverageLexicalV2IndexStoreSnapshot(
				this.store.buildSnapshotState(),
			),
		};
	}

	estimateIndexBytes(): number | null {
		return this.buildRuntimeMemoryBreakdown().estimatedBytes.residentHot.total;
	}

	getIndexBreakdown(): Record<string, unknown> | null {
		return this.buildRuntimeMemoryBreakdown();
	}

	supportsPersistentFileIndex(): boolean {
		return true;
	}

	async restorePersistedFileIndex(): Promise<boolean> {
		try {
			const snapshot = await this.database.readCoverageLexicalV2IndexStoreSnapshot();
			if (!snapshot) {
				return false;
			}
			this.clearIndex();
			this.store.restoreSnapshot(snapshot);
			const journal =
				await this.database.readCoverageLexicalV2IndexStoreJournalEntries();
			for (const entry of journal) {
				if (entry.kind === "replace" || entry.kind === "move") {
					this.store.replacePersistedJournalDocument(
						entry.document,
						entry.previousPath,
					);
					continue;
				}
				const docId = this.store.getDocumentId(entry.path);
				if (docId !== undefined) {
					this.store.deleteDocument(entry.path);
					this.bodyTokenCacheByDocId.delete(docId);
				}
			}
			return true;
		} catch {
			this.clearIndex();
			return false;
		}
	}

	async planPersistentRecovery(
		currentIndexedRefs: readonly BaseIndexedFileRef[],
	): Promise<PersistentFileIndexRecoveryPlan> {
		const persistedIndexedRefs =
			(await this.database.getLexicalIndexedFileRefs()) ?? [];
		const coldConsistency = await this.getBodyTokenColdStore()?.inspectConsistency(
			currentIndexedRefs,
		);
		if (
			this.store.getIndexedDocumentCount() === 0 &&
			persistedIndexedRefs.length > 0
		) {
			return {
				status: "needs_full_rebuild",
				reason: "missing_snapshot",
				docsToDelete: [],
				docsToAdd: [],
				docsToUpdate: [],
				docsToMove: [],
			};
		}
		if (coldConsistency?.requiresReset) {
			return {
				status: currentIndexedRefs.length === 0 ? "up_to_date" : "needs_heal",
				reason:
					currentIndexedRefs.length === 0 ? "up_to_date" : "cold_sidecar_drift",
				docsToDelete: [],
				docsToAdd: [],
				docsToUpdate: currentIndexedRefs.map((ref) => ref.path),
				docsToMove: [],
			};
		}
		return planCoverageLexicalV2PersistentRecovery({
			currentIndexedRefs,
			persistedIndexedRefs,
			storeIndexedRefs: this.store.getIndexedRefs(),
			structuralInvalidityReason: this.store.getStructuralInvalidityReason() ?? undefined,
			coldConsistency,
		});
	}

	async persistFileIndexArtifact(): Promise<void> {
		this.store.compactOverlayIntoSegment(true);
		await this.database.writeCoverageLexicalV2IndexStoreSnapshot(
			this.store.buildSnapshotState(),
			{
				snapshotDocumentCount: this.store.getIndexedDocumentCount(),
				updatedAt: Date.now(),
			},
		);
	}

	async clearPersistedFileIndexArtifact(): Promise<void> {
		await this.database.clearCoverageLexicalV2IndexStorePersistence();
	}

	private async prefetchBodyTokenSequences(docIds: readonly number[]): Promise<void> {
		const coldStore = this.getBodyTokenColdStore();
		if (!coldStore) {
			return;
		}
		const missingDocIds = docIds.filter(
			(docId) => !this.bodyTokenCacheByDocId.has(docId),
		);
		if (missingDocIds.length === 0) {
			return;
		}
		const paths = missingDocIds.flatMap((docId) => {
			const path = this.store.getDocumentPath(docId);
			return path ? [path] : [];
		});
		if (paths.length === 0) {
			return;
		}
		const documents = await coldStore.readDocuments(paths);
		for (const docId of missingDocIds) {
			const path = this.store.getDocumentPath(docId);
			if (!path) {
				continue;
			}
			const stored = documents.get(path);
			if (stored) {
				this.bodyTokenCacheByDocId.set(
					docId,
					this.store.getOrCreateBodyTokenIds(stored.bodyTokens),
				);
			}
		}
	}

	private buildRuntimeMemoryBreakdown(): CoverageLexicalV2RuntimeMemoryBreakdown {
		const hotCacheEstimate = this.estimateBodyTokenHotCacheBytes();
		return this.store.buildIndexBreakdown({
			bodyTokensHotBytes: hotCacheEstimate.bytes,
			bodyTokensHotVsSidecarBytes: hotCacheEstimate.overlapBytes,
		});
	}

	private estimateBodyTokenHotCacheBytes(): {
		bytes: number;
		overlapBytes: number;
	} {
		let bytes = 0;
		for (const bodyTokenIds of this.bodyTokenCacheByDocId.values()) {
			bytes += estimateCoverageLexicalV2BodyTokenIdSequenceBytes(bodyTokenIds);
		}
		return {
			bytes,
			overlapBytes: bytes,
		};
	}

	private releaseHotBodyTokenCache(docIds: readonly number[]): void {
		for (const docId of docIds) {
			this.bodyTokenCacheByDocId.delete(docId);
		}
	}

	private getBodyTokenColdStore(): CoverageLexicalBodyTokenColdStoreApi | null {
		if (this.bodyTokenColdStore !== undefined) {
			return this.bodyTokenColdStore;
		}
		if (!container.isRegistered(COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN, false)) {
			this.bodyTokenColdStore = null;
			return this.bodyTokenColdStore;
		}
		this.bodyTokenColdStore =
			container.resolve<CoverageLexicalBodyTokenColdStoreApi>(
				COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN,
			);
		return this.bodyTokenColdStore;
	}

	private async upsertBodyTokenColdDocuments(
		documents: readonly CoverageLexicalBodyTokenColdDocumentWrite[],
	): Promise<boolean> {
		const coldStore = this.getBodyTokenColdStore();
		if (!coldStore || documents.length === 0) {
			return false;
		}
		await coldStore.upsertDocuments(documents);
		return true;
	}

	private async deleteBodyTokenColdDocuments(paths: readonly string[]): Promise<void> {
		const coldStore = this.getBodyTokenColdStore();
		if (!coldStore || paths.length === 0) {
			return;
		}
		await coldStore.deleteDocuments(paths);
	}

	private createJournalTransaction(seed: string, updatedAt: number) {
		this.journalTransactionOrdinal += 1;
		return {
			transactionId: `${updatedAt}:${this.journalTransactionOrdinal}:${seed}`,
		};
	}

	private requirePersistedJournalDocument(
		docId: number,
	): CoverageLexicalV2PersistedJournalDocument {
		const document = this.store.buildPersistedJournalDocument(docId);
		if (!document) {
			throw new Error(
				`Missing persisted journal document for coverage lexical V2 doc ${docId}`,
			);
		}
		return document;
	}
}

export function buildCoverageLexicalV2PreparedDocument(
	tokenizer: Tokenizer,
	document: IndexedDocument,
): CoverageLexicalV2PreparedDocument {
	const basenameText = document.basename ?? "";
	const folderText = document.folder ?? "";
	const aliasesText = document.aliases ?? "";
	const tagsText = document.tags ?? "";
	const headingsText = document.headings ?? "";
	const bodyText = document.content ?? "";
	const bodyTokens = tokenizeCoverageLexicalV2DocumentText(tokenizer, bodyText);
	return {
		path: document.path,
		generation: document.generation,
		indexedRef: {
			path: document.path,
			generation: document.generation ?? 0,
			size: document.size,
		},
		record: {
			path: document.path,
			stableDeterministicKey: document.path,
			basenameText,
			aliasesText,
			headingsText,
			folderText,
			tagsText,
		},
		exactTermsByField: {
			basename: dedupeCoverageLexicalV2Terms(
				tokenizeCoverageLexicalV2DocumentText(tokenizer, basenameText),
			),
			aliases: dedupeCoverageLexicalV2Terms(
				tokenizeCoverageLexicalV2DocumentText(tokenizer, aliasesText),
			),
			headings: dedupeCoverageLexicalV2Terms(
				tokenizeCoverageLexicalV2DocumentText(tokenizer, headingsText),
			),
			folder: dedupeCoverageLexicalV2Terms(
				tokenizeCoverageLexicalV2DocumentText(tokenizer, folderText),
			),
			tag: dedupeCoverageLexicalV2Terms(
				tokenizeCoverageLexicalV2DocumentText(tokenizer, tagsText),
			),
			body: dedupeCoverageLexicalV2Terms(bodyTokens),
		},
		metadataHanBigramsByField: {
			basename: dedupeCoverageLexicalV2Terms(extractHanBigrams(basenameText)),
			aliases: dedupeCoverageLexicalV2Terms(extractHanBigrams(aliasesText)),
			headings: dedupeCoverageLexicalV2Terms(extractHanBigrams(headingsText)),
			folder: dedupeCoverageLexicalV2Terms(extractHanBigrams(folderText)),
			tag: dedupeCoverageLexicalV2Terms(
				splitCoverageLexicalTagValues(tagsText).flatMap((tagValue) =>
					extractHanBigrams(tagValue),
				),
			),
		},
		bodyHanSegments: extractHanSegments(bodyText),
		bodyTokens,
	};
}

function dedupeCoverageLexicalV2Terms(terms: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const term of terms) {
		if (term.length === 0 || seen.has(term)) {
			continue;
		}
		seen.add(term);
		out.push(term);
	}
	return out;
}

function tokenizeCoverageLexicalV2DocumentText(
	tokenizer: Tokenizer,
	text: string,
): string[] {
	return tokenizer
		.tokenizeSequence(text, "index")
		.map((term) => term.toLowerCase());
}

function tokenizeCoverageLexicalV2QueryText(
	tokenizer: Tokenizer,
	text: string,
): string[] {
	return tokenizer
		.tokenizeSequence(text, "search")
		.map((term) => term.toLowerCase());
}

function isSerializedCoverageLexicalBinarySnapshot(
	data: unknown,
): data is SerializedCoverageLexicalBinarySnapshot {
	if (!data || typeof data !== "object") {
		return false;
	}
	return (
		(data as Record<string, unknown>).__backend === "coverage-lexical" &&
		(data as Record<string, unknown>).__version === 2 &&
		(data as Record<string, unknown>).__encoding === "binary-snapshot-v2" &&
		(data as Record<string, unknown>).data instanceof ArrayBuffer
	);
}

export const COVERAGE_LEXICAL_V2_PERSISTENT_ENGINE_METHODS = {
	supportsPersistentFileIndex: true,
	metaId: COVERAGE_LEXICAL_V2_INDEX_STORE_META_ID,
} as const;
