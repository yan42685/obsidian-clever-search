import type { BaseIndexedFileRef } from "src/globals/search-types";
import type {
	CoverageLexicalV2CandidateCascadePostingField,
	CoverageLexicalV2CandidateCascadeStorageReader,
} from "../candidate-cascade";
import {
	getCoverageLexicalV2CandidateCascadeMatchQuality,
	isCoverageLexicalV2LatinCandidateCascadeTerm,
} from "../candidate-cascade/coverage-lexical-candidate-match";
import {
	buildCoverageLexicalV2ResidentSegment,
	decodeCoverageLexicalV2ResidentSegmentPosting,
	estimateCoverageLexicalV2ResidentSegmentBytes,
} from "./coverage-lexical-v2-index-store-codec";
import {
	COVERAGE_LEXICAL_V2_INDEX_STORE_SCHEMA_VERSION,
	type CoverageLexicalV2FieldTermLists,
	type CoverageLexicalV2IndexStoreDocManifest,
	type CoverageLexicalV2IndexStoreDocumentState,
	type CoverageLexicalV2IndexStoreOverlayState,
	type CoverageLexicalV2IndexStoreReaderOptions,
	type CoverageLexicalV2IndexStoreResidentSegment,
	type CoverageLexicalV2IndexStoreSizeBreakdown,
	type CoverageLexicalV2IndexStoreSnapshotDocument,
	type CoverageLexicalV2IndexStoreSnapshotState,
	type CoverageLexicalV2MetadataBigramLists,
	type CoverageLexicalV2MetadataPostingField,
	type CoverageLexicalV2PreparedDocument,
} from "./coverage-lexical-v2-index-store-types";

type CoverageLexicalV2InternalDocumentState = CoverageLexicalV2IndexStoreDocumentState;

type CoverageLexicalV2MutablePostingDelta<Field extends string> = Record<
	Field,
	Map<string, number[]>
>;

type CoverageLexicalV2MutableOverlayState = {
	exactAddsByField: CoverageLexicalV2MutablePostingDelta<
		CoverageLexicalV2CandidateCascadePostingField
	>;
	exactRemovalsByField: CoverageLexicalV2MutablePostingDelta<
		CoverageLexicalV2CandidateCascadePostingField
	>;
	metadataHanAddsByField: CoverageLexicalV2MutablePostingDelta<
		CoverageLexicalV2MetadataPostingField
	>;
	metadataHanRemovalsByField: CoverageLexicalV2MutablePostingDelta<
		CoverageLexicalV2MetadataPostingField
	>;
};

const COVERAGE_LEXICAL_V2_POSTING_FIELDS = [
	"basename",
	"aliases",
	"headings",
	"folder",
	"tag",
	"body",
] as const satisfies readonly CoverageLexicalV2CandidateCascadePostingField[];

const COVERAGE_LEXICAL_V2_METADATA_FIELDS = [
	"basename",
	"aliases",
	"headings",
	"folder",
	"tag",
] as const satisfies readonly CoverageLexicalV2MetadataPostingField[];

const textEncoder = new TextEncoder();
const AUTO_COMPACTION_MUTATION_CAP = 48;

export class CoverageLexicalV2IndexStore {
	private nextDocumentId = 0;
	private readonly documentById: Array<CoverageLexicalV2InternalDocumentState | undefined> =
		[];
	private readonly documentIdByPath = new Map<string, number>();
	private readonly bodyHanSegmentDocIds: number[] = [];
	private readonly exactTermRefCounts = new Map<string, number>();
	private readonly metadataHanBigramRefCounts = new Map<string, number>();
	private readonly residentSegments: CoverageLexicalV2IndexStoreResidentSegment[] = [];
	private readonly overlay: CoverageLexicalV2MutableOverlayState =
		createCoverageLexicalV2MutableOverlayState();
	private latinExpansionTermsCache: string[] = [];
	private latinExpansionTermsDirty = true;
	private overlayMutationCount = 0;
	private bodyTokenSidecarEstimatedBytes = 0;

	clear(): void {
		this.nextDocumentId = 0;
		this.documentById.length = 0;
		this.documentIdByPath.clear();
		this.bodyHanSegmentDocIds.length = 0;
		this.exactTermRefCounts.clear();
		this.metadataHanBigramRefCounts.clear();
		this.residentSegments.length = 0;
		clearCoverageLexicalV2MutableOverlayState(this.overlay);
		this.latinExpansionTermsCache = [];
		this.latinExpansionTermsDirty = true;
		this.overlayMutationCount = 0;
		this.bodyTokenSidecarEstimatedBytes = 0;
	}

	getIndexedDocumentCount(): number {
		return this.documentIdByPath.size;
	}

	hasPath(path: string): boolean {
		return this.documentIdByPath.has(path);
	}

	getDocumentId(path: string): number | undefined {
		return this.documentIdByPath.get(path);
	}

	getDocumentPath(docId: number): string | undefined {
		return this.documentById[docId]?.path;
	}

	getIndexedRefs(): BaseIndexedFileRef[] {
		return this.documentById.flatMap((documentState) =>
			documentState ? [{ ...documentState.indexedRef }] : [],
		);
	}

	getStructuralInvalidityReason():
		| "snapshot_corrupted"
		| "doc_registry_conflict"
		| "manifest_missing"
		| null {
		const seenPaths = new Set<string>();
		for (let docId = 0; docId < this.documentById.length; docId += 1) {
			const documentState = this.documentById[docId];
			if (!documentState) {
				continue;
			}
			if (documentState.docId !== docId) {
				return "doc_registry_conflict";
			}
			if (seenPaths.has(documentState.path)) {
				return "doc_registry_conflict";
			}
			seenPaths.add(documentState.path);
			if (
				!documentState.manifest ||
				documentState.manifest.bodyTokenSidecar.path !== documentState.path
			) {
				return "manifest_missing";
			}
		}

		try {
			for (const segment of this.residentSegments) {
				for (const fieldSegment of Object.values(segment.exactByField)) {
					for (const term of fieldSegment.termDictionary) {
						void decodeCoverageLexicalV2ResidentSegmentPosting(fieldSegment, term);
					}
				}
				for (const fieldSegment of Object.values(segment.metadataHanByField)) {
					for (const term of fieldSegment.termDictionary) {
						void decodeCoverageLexicalV2ResidentSegmentPosting(fieldSegment, term);
					}
				}
			}
		} catch {
			return "snapshot_corrupted";
		}

		return null;
	}

	replaceDocument(
		document: CoverageLexicalV2PreparedDocument,
		previousPath?: string,
	): number {
		const recycledDocId = previousPath
			? this.documentIdByPath.get(previousPath)
			: undefined;
		const existingDocId = this.documentIdByPath.get(document.path);
		let docId = recycledDocId ?? existingDocId;

		if (
			previousPath &&
			previousPath !== document.path &&
			existingDocId !== undefined &&
			existingDocId !== recycledDocId
		) {
			this.deleteDocumentById(existingDocId);
		}

		if (docId !== undefined) {
			this.removeDocumentStateById(docId);
		} else {
			docId = this.nextDocumentId;
			this.nextDocumentId += 1;
		}

		const stored = buildCoverageLexicalV2InternalDocumentState(docId, document);
		this.documentById[docId] = stored;
		this.documentIdByPath.set(document.path, docId);
		if (previousPath && previousPath !== document.path) {
			this.documentIdByPath.delete(previousPath);
		}
		this.applyDocumentAddition(stored);
		this.syncBodyHanSegmentDocId(docId, stored.manifest.hasBodyHanSegments);
		this.bodyTokenSidecarEstimatedBytes +=
			stored.manifest.bodyTokenSidecar.estimatedBytes;
		this.latinExpansionTermsDirty = true;
		return docId;
	}

	deleteDocument(path: string): void {
		const docId = this.documentIdByPath.get(path);
		if (docId === undefined) {
			return;
		}
		this.deleteDocumentById(docId);
	}

	compactOverlayIntoSegment(force = false): boolean {
		const exactPostings = createCoverageLexicalV2MutablePostingMaps();
		const metadataPostings = createCoverageLexicalV2MutableMetadataPostingMaps();

		for (const field of COVERAGE_LEXICAL_V2_POSTING_FIELDS) {
			for (const [term, docIds] of this.overlay.exactAddsByField[field]) {
				if (docIds.length > 0) {
					exactPostings[field].set(term, [...docIds]);
				}
			}
		}
		for (const field of COVERAGE_LEXICAL_V2_METADATA_FIELDS) {
			for (const [bigram, docIds] of this.overlay.metadataHanAddsByField[field]) {
				if (docIds.length > 0) {
					metadataPostings[field].set(bigram, [...docIds]);
				}
			}
		}

		const docCount = countCoverageLexicalV2PostingMapsDocumentCount(
			exactPostings,
			metadataPostings,
		);
		if (!force && docCount === 0 && this.overlayMutationCount < AUTO_COMPACTION_MUTATION_CAP) {
			return false;
		}

		if (docCount > 0) {
			this.residentSegments.push(
				buildCoverageLexicalV2ResidentSegment({
					id: `segment:${Date.now()}:${this.residentSegments.length}`,
					createdAt: Date.now(),
					docCount,
					exactByField: exactPostings,
					metadataHanByField: metadataPostings,
				}),
			);
		}

		clearCoverageLexicalV2MutableOverlayAdditions(this.overlay);
		this.overlayMutationCount = countCoverageLexicalV2MutableOverlayMutationCount(
			this.overlay,
		);
		return docCount > 0;
	}

	restoreSnapshot(snapshot: CoverageLexicalV2IndexStoreSnapshotState): void {
		if (
			snapshot.schemaVersion !== COVERAGE_LEXICAL_V2_INDEX_STORE_SCHEMA_VERSION
		) {
			throw new Error("Unsupported coverage lexical V2 index-store snapshot");
		}

		this.clear();
		this.nextDocumentId = snapshot.nextDocumentId;
		this.residentSegments.push(
			...snapshot.segments.map(cloneCoverageLexicalV2ResidentSegment),
		);
		restoreCoverageLexicalV2MutableOverlayState(this.overlay, snapshot.overlay);
		this.overlayMutationCount = countCoverageLexicalV2MutableOverlayMutationCount(
			this.overlay,
		);

		const documents = [...snapshot.documents].sort((left, right) => left.docId - right.docId);
		for (const document of documents) {
			if (
				document.docId < 0 ||
				!Number.isInteger(document.docId) ||
				this.documentById[document.docId] ||
				this.documentIdByPath.has(document.path)
			) {
				throw new Error("Invalid coverage lexical V2 document registry");
			}
			const documentState = cloneCoverageLexicalV2SnapshotDocument(document);
			this.documentById[documentState.docId] = documentState;
			this.documentIdByPath.set(documentState.path, documentState.docId);
			this.syncBodyHanSegmentDocId(
				documentState.docId,
				documentState.manifest.hasBodyHanSegments,
			);
			incrementCoverageLexicalV2TermRefCounts(
				this.exactTermRefCounts,
				documentState.manifest.exactTermsByField,
			);
			incrementCoverageLexicalV2BigramRefCounts(
				this.metadataHanBigramRefCounts,
				documentState.manifest.metadataHanBigramsByField,
			);
			this.bodyTokenSidecarEstimatedBytes +=
				documentState.manifest.bodyTokenSidecar.estimatedBytes;
		}

		const minimumNextDocumentId =
			documents.length === 0 ? 0 : documents[documents.length - 1].docId + 1;
		this.nextDocumentId = Math.max(this.nextDocumentId, minimumNextDocumentId);
		this.latinExpansionTermsDirty = true;
	}

	buildSnapshotState(): CoverageLexicalV2IndexStoreSnapshotState {
		return {
			schemaVersion: COVERAGE_LEXICAL_V2_INDEX_STORE_SCHEMA_VERSION,
			nextDocumentId: this.nextDocumentId,
			snapshotCreatedAt: Date.now(),
			documents: this.documentById.flatMap((documentState) =>
				documentState ? [toCoverageLexicalV2SnapshotDocument(documentState)] : [],
			),
			segments: this.residentSegments.map(cloneCoverageLexicalV2ResidentSegment),
			overlay: serializeCoverageLexicalV2MutableOverlayState(this.overlay),
		};
	}

	createStorageReader(
		options: CoverageLexicalV2IndexStoreReaderOptions,
	): CoverageLexicalV2CandidateCascadeStorageReader {
		return {
			getDocumentRecord: (docId) => this.documentById[docId]?.record ?? null,
			getBodyHanSegmentDocIds: () => this.bodyHanSegmentDocIds,
			getPostingMatches: (field, term) => this.getExactPostingMatches(field, term),
			getMetadataHanBigramPostingMatches: (field, bigram) =>
				field === "body"
					? undefined
					: this.getMetadataHanBigramPostingMatches(field, bigram),
			getBodyHanSegments: (docId) =>
				this.documentById[docId]?.manifest.bodyHanSegments,
			collectLatinPrefixTerms: (queryTerm, cap) =>
				this.collectLatinPrefixTerms(queryTerm, cap),
			collectLatinFuzzyTerms: (queryTerm, cap, fuzzyProportion) =>
				this.collectLatinFuzzyTerms(queryTerm, cap, fuzzyProportion),
			getBodyTokenSequence: options.getBodyTokenSequence,
			prefetchBodyTokenSequences: options.prefetchBodyTokenSequences,
			tokenizeText: options.tokenizeText,
		};
	}

	estimateIndexBytes(): number {
		return this.buildIndexBreakdown().estimatedBytes.total;
	}

	buildIndexBreakdown(): CoverageLexicalV2IndexStoreSizeBreakdown {
		let exactIncidence = 0;
		let metadataHanGate = 0;
		let documentView = 0;
		let bodyHanVerificationView = this.bodyHanSegmentDocIds.length * 4;

		for (const segment of this.residentSegments) {
			const estimated = estimateCoverageLexicalV2ResidentSegmentBytes(segment);
			exactIncidence += estimated.exactIncidence;
			metadataHanGate += estimated.metadataHanGate;
		}

		exactIncidence += estimateCoverageLexicalV2MutablePostingDeltaBytes(
			this.overlay.exactAddsByField,
		);
		exactIncidence += estimateCoverageLexicalV2MutablePostingDeltaBytes(
			this.overlay.exactRemovalsByField,
		);
		metadataHanGate += estimateCoverageLexicalV2MutablePostingDeltaBytes(
			this.overlay.metadataHanAddsByField,
		);
		metadataHanGate += estimateCoverageLexicalV2MutablePostingDeltaBytes(
			this.overlay.metadataHanRemovalsByField,
		);

		for (const documentState of this.documentById) {
			if (!documentState) {
				continue;
			}
			documentView += estimateCoverageLexicalV2DocumentViewBytes(documentState);
			bodyHanVerificationView += estimateCoverageLexicalV2BodyHanVerificationBytes(
				documentState.manifest.bodyHanSegments,
			);
		}

		const latinExpansionTerms = this.getLatinExpansionTerms();
		const latinExpansionLexicon = estimateCoverageLexicalV2LatinExpansionBytes(
			latinExpansionTerms,
		);

		return {
			documentCount: this.getIndexedDocumentCount(),
			nextDocumentId: this.nextDocumentId,
			exactTermCount: countCoverageLexicalV2PositiveRefCounts(
				this.exactTermRefCounts,
			),
			metadataHanBigramCount: countCoverageLexicalV2PositiveRefCounts(
				this.metadataHanBigramRefCounts,
			),
			latinExpansionTermCount: latinExpansionTerms.length,
			segmentCount: this.residentSegments.length,
			estimatedBytes: {
				exactIncidence,
				latinExpansionLexicon,
				metadataHanGate,
				documentView,
				bodyHanVerificationView,
				bodyTokenSidecar: this.bodyTokenSidecarEstimatedBytes,
				total:
					exactIncidence +
					latinExpansionLexicon +
					metadataHanGate +
					documentView +
					bodyHanVerificationView +
					this.bodyTokenSidecarEstimatedBytes,
			},
		};
	}

	private getExactPostingMatches(
		field: CoverageLexicalV2CandidateCascadePostingField,
		term: string,
	): readonly number[] | undefined {
		if ((this.exactTermRefCounts.get(term) ?? 0) <= 0) {
			return undefined;
		}
		return this.collectPostingMatches(
			this.residentSegments.map((segment) =>
				decodeCoverageLexicalV2ResidentSegmentPosting(segment.exactByField[field], term),
			),
			this.overlay.exactAddsByField[field].get(term),
			this.overlay.exactRemovalsByField[field].get(term),
		);
	}

	private getMetadataHanBigramPostingMatches(
		field: CoverageLexicalV2MetadataPostingField,
		bigram: string,
	): readonly number[] | undefined {
		if ((this.metadataHanBigramRefCounts.get(bigram) ?? 0) <= 0) {
			return undefined;
		}
		return this.collectPostingMatches(
			this.residentSegments.map((segment) =>
				decodeCoverageLexicalV2ResidentSegmentPosting(
					segment.metadataHanByField[field],
					bigram,
				),
			),
			this.overlay.metadataHanAddsByField[field].get(bigram),
			this.overlay.metadataHanRemovalsByField[field].get(bigram),
		);
	}

	private collectPostingMatches(
		segmentMatches: readonly (readonly number[] | undefined)[],
		additions: readonly number[] | undefined,
		removals: readonly number[] | undefined,
	): readonly number[] | undefined {
		const docIds = new Set<number>();
		for (const matches of segmentMatches) {
			for (const docId of matches ?? []) {
				docIds.add(docId);
			}
		}
		for (const docId of additions ?? []) {
			docIds.add(docId);
		}
		for (const docId of removals ?? []) {
			docIds.delete(docId);
		}
		if (docIds.size === 0) {
			return undefined;
		}
		return [...docIds].sort((left, right) => left - right);
	}

	private collectLatinPrefixTerms(
		queryTerm: string,
		cap: number,
	): readonly string[] {
		if (cap <= 0 || !isCoverageLexicalV2LatinCandidateCascadeTerm(queryTerm)) {
			return [];
		}
		const terms = this.getLatinExpansionTerms();
		const matches: string[] = [];
		let index = lowerBoundCoverageLexicalV2IndexStoreString(terms, queryTerm);
		while (index < terms.length && matches.length < cap) {
			const candidateTerm = terms[index];
			if (!candidateTerm.startsWith(queryTerm)) {
				break;
			}
			if (
				getCoverageLexicalV2CandidateCascadeMatchQuality(queryTerm, candidateTerm, {
					includePrefix: true,
				}) === "prefix"
			) {
				matches.push(candidateTerm);
			}
			index += 1;
		}
		return matches;
	}

	private collectLatinFuzzyTerms(
		queryTerm: string,
		cap: number,
		fuzzyProportion: number,
	): readonly string[] {
		if (cap <= 0 || !isCoverageLexicalV2LatinCandidateCascadeTerm(queryTerm)) {
			return [];
		}
		const matches: string[] = [];
		for (const candidateTerm of this.getLatinExpansionTerms()) {
			if (matches.length >= cap) {
				break;
			}
			if (
				getCoverageLexicalV2CandidateCascadeMatchQuality(queryTerm, candidateTerm, {
					includeFuzzy: true,
					fuzzyProportion,
				}) === "fuzzy"
			) {
				matches.push(candidateTerm);
			}
		}
		return matches;
	}

	private getLatinExpansionTerms(): readonly string[] {
		if (!this.latinExpansionTermsDirty) {
			return this.latinExpansionTermsCache;
		}
		const nextTerms = [...this.exactTermRefCounts.entries()]
			.filter(
				([term, refCount]) =>
					refCount > 0 && isCoverageLexicalV2LatinCandidateCascadeTerm(term),
			)
			.map(([term]) => term)
			.sort(compareCoverageLexicalV2IndexStoreStrings);
		this.latinExpansionTermsCache = nextTerms;
		this.latinExpansionTermsDirty = false;
		return this.latinExpansionTermsCache;
	}

	private deleteDocumentById(docId: number): void {
		this.removeDocumentStateById(docId);
		this.documentById[docId] = undefined;
	}

	private removeDocumentStateById(docId: number): void {
		const existing = this.documentById[docId];
		if (!existing) {
			return;
		}
		this.applyDocumentRemoval(existing);
		this.syncBodyHanSegmentDocId(docId, false);
		this.bodyTokenSidecarEstimatedBytes = Math.max(
			0,
			this.bodyTokenSidecarEstimatedBytes -
				existing.manifest.bodyTokenSidecar.estimatedBytes,
		);
		this.documentIdByPath.delete(existing.path);
		this.documentById[docId] = undefined;
		this.latinExpansionTermsDirty = true;
	}

	private applyDocumentAddition(documentState: CoverageLexicalV2InternalDocumentState): void {
		incrementCoverageLexicalV2TermRefCounts(
			this.exactTermRefCounts,
			documentState.manifest.exactTermsByField,
		);
		incrementCoverageLexicalV2BigramRefCounts(
			this.metadataHanBigramRefCounts,
			documentState.manifest.metadataHanBigramsByField,
		);
		for (const field of COVERAGE_LEXICAL_V2_POSTING_FIELDS) {
			for (const term of documentState.manifest.exactTermsByField[field]) {
				applyCoverageLexicalV2OverlayPostingDelta(
					this.overlay.exactAddsByField[field],
					this.overlay.exactRemovalsByField[field],
					term,
					documentState.docId,
				);
				this.overlayMutationCount += 1;
			}
		}
		for (const field of COVERAGE_LEXICAL_V2_METADATA_FIELDS) {
			for (const bigram of documentState.manifest.metadataHanBigramsByField[field]) {
				applyCoverageLexicalV2OverlayPostingDelta(
					this.overlay.metadataHanAddsByField[field],
					this.overlay.metadataHanRemovalsByField[field],
					bigram,
					documentState.docId,
				);
				this.overlayMutationCount += 1;
			}
		}
	}

	private applyDocumentRemoval(documentState: CoverageLexicalV2InternalDocumentState): void {
		decrementCoverageLexicalV2TermRefCounts(
			this.exactTermRefCounts,
			documentState.manifest.exactTermsByField,
		);
		decrementCoverageLexicalV2BigramRefCounts(
			this.metadataHanBigramRefCounts,
			documentState.manifest.metadataHanBigramsByField,
		);
		for (const field of COVERAGE_LEXICAL_V2_POSTING_FIELDS) {
			for (const term of documentState.manifest.exactTermsByField[field]) {
				applyCoverageLexicalV2OverlayPostingTombstone(
					this.overlay.exactAddsByField[field],
					this.overlay.exactRemovalsByField[field],
					term,
					documentState.docId,
				);
				this.overlayMutationCount += 1;
			}
		}
		for (const field of COVERAGE_LEXICAL_V2_METADATA_FIELDS) {
			for (const bigram of documentState.manifest.metadataHanBigramsByField[field]) {
				applyCoverageLexicalV2OverlayPostingTombstone(
					this.overlay.metadataHanAddsByField[field],
					this.overlay.metadataHanRemovalsByField[field],
					bigram,
					documentState.docId,
				);
				this.overlayMutationCount += 1;
			}
		}
	}

	private syncBodyHanSegmentDocId(docId: number, shouldExist: boolean): void {
		const currentIndex = this.bodyHanSegmentDocIds.indexOf(docId);
		if (shouldExist) {
			if (currentIndex >= 0) {
				return;
			}
			insertCoverageLexicalV2SortedNumber(this.bodyHanSegmentDocIds, docId);
			return;
		}
		if (currentIndex >= 0) {
			this.bodyHanSegmentDocIds.splice(currentIndex, 1);
		}
	}
}

export function toCoverageLexicalV2PreparedDocument(
	document: CoverageLexicalV2IndexStoreSnapshotDocument,
): CoverageLexicalV2PreparedDocument {
	return {
		path: document.path,
		generation: document.generation,
		indexedRef: { ...document.indexedRef },
		record: { ...document.record },
		exactTermsByField: cloneCoverageLexicalV2FieldTermLists(
			document.manifest.exactTermsByField,
		),
		metadataHanBigramsByField: cloneCoverageLexicalV2MetadataBigramLists(
			document.manifest.metadataHanBigramsByField,
		),
		bodyHanSegments: [...document.manifest.bodyHanSegments],
		bodyTokens: [],
	};
}

function buildCoverageLexicalV2InternalDocumentState(
	docId: number,
	document: CoverageLexicalV2PreparedDocument,
): CoverageLexicalV2InternalDocumentState {
	const stableDeterministicKey =
		document.record.stableDeterministicKey ?? document.path;
	const indexedRef: BaseIndexedFileRef = {
		...document.indexedRef,
		path: document.path,
		generation: document.indexedRef.generation ?? document.generation,
	};
	const record = {
		...document.record,
		path: document.path,
		stableDeterministicKey,
	};
	return {
		docId,
		path: document.path,
		generation: document.generation,
		indexedRef,
		record,
		manifest: {
			stableDeterministicKey,
			normalizedMetadataTexts: {
				basenameText: record.basenameText,
				aliasesText: record.aliasesText,
				headingsText: record.headingsText,
				folderText: record.folderText,
				tagsText: record.tagsText,
			},
			exactTermsByField: cloneCoverageLexicalV2FieldTermLists(
				document.exactTermsByField,
			),
			metadataHanBigramsByField: cloneCoverageLexicalV2MetadataBigramLists(
				document.metadataHanBigramsByField,
			),
			bodyHanSegments: [...document.bodyHanSegments],
			hasBodyHanSegments: document.bodyHanSegments.length > 0,
			bodyTokenSidecar: {
				path: document.path,
				generation: document.generation ?? indexedRef.generation,
				size: indexedRef.size,
				tokenCount: document.bodyTokens.length,
				estimatedBytes: estimateCoverageLexicalV2BodyTokenSidecarBytes(
					document.bodyTokens,
				),
			},
		},
	};
}

function cloneCoverageLexicalV2SnapshotDocument(
	document: CoverageLexicalV2IndexStoreSnapshotDocument,
): CoverageLexicalV2InternalDocumentState {
	return {
		docId: document.docId,
		path: document.path,
		generation: document.generation,
		indexedRef: { ...document.indexedRef },
		record: { ...document.record },
		manifest: cloneCoverageLexicalV2DocManifest(document.manifest),
	};
}

function toCoverageLexicalV2SnapshotDocument(
	document: CoverageLexicalV2InternalDocumentState,
): CoverageLexicalV2IndexStoreSnapshotDocument {
	return {
		docId: document.docId,
		path: document.path,
		generation: document.generation,
		indexedRef: { ...document.indexedRef },
		record: { ...document.record },
		manifest: cloneCoverageLexicalV2DocManifest(document.manifest),
	};
}

function cloneCoverageLexicalV2DocManifest(
	manifest: CoverageLexicalV2IndexStoreDocManifest,
): CoverageLexicalV2IndexStoreDocManifest {
	return {
		stableDeterministicKey: manifest.stableDeterministicKey,
		normalizedMetadataTexts: { ...manifest.normalizedMetadataTexts },
		exactTermsByField: cloneCoverageLexicalV2FieldTermLists(
			manifest.exactTermsByField,
		),
		metadataHanBigramsByField: cloneCoverageLexicalV2MetadataBigramLists(
			manifest.metadataHanBigramsByField,
		),
		bodyHanSegments: [...manifest.bodyHanSegments],
		hasBodyHanSegments: manifest.hasBodyHanSegments,
		bodyTokenSidecar: { ...manifest.bodyTokenSidecar },
	};
}

function cloneCoverageLexicalV2FieldTermLists(
	fieldTerms: CoverageLexicalV2FieldTermLists,
): CoverageLexicalV2FieldTermLists {
	return {
		basename: [...fieldTerms.basename],
		aliases: [...fieldTerms.aliases],
		headings: [...fieldTerms.headings],
		folder: [...fieldTerms.folder],
		tag: [...fieldTerms.tag],
		body: [...fieldTerms.body],
	};
}

function cloneCoverageLexicalV2MetadataBigramLists(
	bigramsByField: CoverageLexicalV2MetadataBigramLists,
): CoverageLexicalV2MetadataBigramLists {
	return {
		basename: [...bigramsByField.basename],
		aliases: [...bigramsByField.aliases],
		headings: [...bigramsByField.headings],
		folder: [...bigramsByField.folder],
		tag: [...bigramsByField.tag],
	};
}

function createCoverageLexicalV2MutablePostingMaps(): CoverageLexicalV2MutablePostingDelta<
	CoverageLexicalV2CandidateCascadePostingField
> {
	return {
		basename: new Map(),
		aliases: new Map(),
		headings: new Map(),
		folder: new Map(),
		tag: new Map(),
		body: new Map(),
	};
}

function createCoverageLexicalV2MutableMetadataPostingMaps(): CoverageLexicalV2MutablePostingDelta<
	CoverageLexicalV2MetadataPostingField
> {
	return {
		basename: new Map(),
		aliases: new Map(),
		headings: new Map(),
		folder: new Map(),
		tag: new Map(),
	};
}

function createCoverageLexicalV2MutableOverlayState(): CoverageLexicalV2MutableOverlayState {
	return {
		exactAddsByField: createCoverageLexicalV2MutablePostingMaps(),
		exactRemovalsByField: createCoverageLexicalV2MutablePostingMaps(),
		metadataHanAddsByField: createCoverageLexicalV2MutableMetadataPostingMaps(),
		metadataHanRemovalsByField: createCoverageLexicalV2MutableMetadataPostingMaps(),
	};
}

function clearCoverageLexicalV2MutableOverlayState(
	overlay: CoverageLexicalV2MutableOverlayState,
): void {
	for (const field of COVERAGE_LEXICAL_V2_POSTING_FIELDS) {
		overlay.exactAddsByField[field].clear();
		overlay.exactRemovalsByField[field].clear();
	}
	for (const field of COVERAGE_LEXICAL_V2_METADATA_FIELDS) {
		overlay.metadataHanAddsByField[field].clear();
		overlay.metadataHanRemovalsByField[field].clear();
	}
}

function clearCoverageLexicalV2MutableOverlayAdditions(
	overlay: CoverageLexicalV2MutableOverlayState,
): void {
	for (const field of COVERAGE_LEXICAL_V2_POSTING_FIELDS) {
		overlay.exactAddsByField[field].clear();
	}
	for (const field of COVERAGE_LEXICAL_V2_METADATA_FIELDS) {
		overlay.metadataHanAddsByField[field].clear();
	}
}

function serializeCoverageLexicalV2MutableOverlayState(
	overlay: CoverageLexicalV2MutableOverlayState,
): CoverageLexicalV2IndexStoreOverlayState {
	return {
		exactAddsByField: serializeCoverageLexicalV2MutablePostingDelta(
			overlay.exactAddsByField,
			COVERAGE_LEXICAL_V2_POSTING_FIELDS,
		),
		exactRemovalsByField: serializeCoverageLexicalV2MutablePostingDelta(
			overlay.exactRemovalsByField,
			COVERAGE_LEXICAL_V2_POSTING_FIELDS,
		),
		metadataHanAddsByField: serializeCoverageLexicalV2MutablePostingDelta(
			overlay.metadataHanAddsByField,
			COVERAGE_LEXICAL_V2_METADATA_FIELDS,
		),
		metadataHanRemovalsByField: serializeCoverageLexicalV2MutablePostingDelta(
			overlay.metadataHanRemovalsByField,
			COVERAGE_LEXICAL_V2_METADATA_FIELDS,
		),
	};
}

function restoreCoverageLexicalV2MutableOverlayState(
	target: CoverageLexicalV2MutableOverlayState,
	overlay: CoverageLexicalV2IndexStoreOverlayState,
): void {
	clearCoverageLexicalV2MutableOverlayState(target);
	restoreCoverageLexicalV2MutablePostingDelta(
		target.exactAddsByField,
		overlay.exactAddsByField,
		COVERAGE_LEXICAL_V2_POSTING_FIELDS,
	);
	restoreCoverageLexicalV2MutablePostingDelta(
		target.exactRemovalsByField,
		overlay.exactRemovalsByField,
		COVERAGE_LEXICAL_V2_POSTING_FIELDS,
	);
	restoreCoverageLexicalV2MutablePostingDelta(
		target.metadataHanAddsByField,
		overlay.metadataHanAddsByField,
		COVERAGE_LEXICAL_V2_METADATA_FIELDS,
	);
	restoreCoverageLexicalV2MutablePostingDelta(
		target.metadataHanRemovalsByField,
		overlay.metadataHanRemovalsByField,
		COVERAGE_LEXICAL_V2_METADATA_FIELDS,
	);
}

function serializeCoverageLexicalV2MutablePostingDelta<Field extends string>(
	postingsByField: CoverageLexicalV2MutablePostingDelta<Field>,
	fields: readonly Field[],
): Record<Field, Readonly<Record<string, readonly number[]>>> {
	const serialized = {} as Record<Field, Readonly<Record<string, readonly number[]>>>;
	for (const field of fields) {
		const out: Record<string, readonly number[]> = {};
		for (const [term, docIds] of postingsByField[field]) {
			if (docIds.length > 0) {
				out[term] = [...docIds];
			}
		}
		serialized[field] = out;
	}
	return serialized;
}

function restoreCoverageLexicalV2MutablePostingDelta<Field extends string>(
	target: CoverageLexicalV2MutablePostingDelta<Field>,
	source: Record<Field, Readonly<Record<string, readonly number[]>>>,
	fields: readonly Field[],
): void {
	for (const field of fields) {
		const targetMap = target[field];
		for (const [term, docIds] of Object.entries(source[field] ?? {})) {
			targetMap.set(
				term,
				[...docIds].sort((left, right) => left - right),
			);
		}
	}
}

function cloneCoverageLexicalV2ResidentSegment(
	segment: CoverageLexicalV2IndexStoreResidentSegment,
): CoverageLexicalV2IndexStoreResidentSegment {
	return {
		id: segment.id,
		createdAt: segment.createdAt,
		docCount: segment.docCount,
		exactByField: {
			basename: cloneCoverageLexicalV2SerializedPostingFieldSegment(
				segment.exactByField.basename,
			),
			aliases: cloneCoverageLexicalV2SerializedPostingFieldSegment(
				segment.exactByField.aliases,
			),
			headings: cloneCoverageLexicalV2SerializedPostingFieldSegment(
				segment.exactByField.headings,
			),
			folder: cloneCoverageLexicalV2SerializedPostingFieldSegment(
				segment.exactByField.folder,
			),
			tag: cloneCoverageLexicalV2SerializedPostingFieldSegment(
				segment.exactByField.tag,
			),
			body: cloneCoverageLexicalV2SerializedPostingFieldSegment(
				segment.exactByField.body,
			),
		},
		metadataHanByField: {
			basename: cloneCoverageLexicalV2SerializedPostingFieldSegment(
				segment.metadataHanByField.basename,
			),
			aliases: cloneCoverageLexicalV2SerializedPostingFieldSegment(
				segment.metadataHanByField.aliases,
			),
			headings: cloneCoverageLexicalV2SerializedPostingFieldSegment(
				segment.metadataHanByField.headings,
			),
			folder: cloneCoverageLexicalV2SerializedPostingFieldSegment(
				segment.metadataHanByField.folder,
			),
			tag: cloneCoverageLexicalV2SerializedPostingFieldSegment(
				segment.metadataHanByField.tag,
			),
		},
	};
}

function cloneCoverageLexicalV2SerializedPostingFieldSegment(segment: {
	termDictionary: readonly string[];
	postingDirectory: readonly {
		termIndex: number;
		encoding: "tiny_inline" | "delta_varint";
		docCount: number;
		tapeStart: number;
		tapeLength: number;
		inlineDocIds?: readonly number[];
	}[];
	postingTape: readonly number[];
}) {
	return {
		termDictionary: [...segment.termDictionary],
		postingDirectory: segment.postingDirectory.map((entry) => ({
			...entry,
			inlineDocIds: entry.inlineDocIds ? [...entry.inlineDocIds] : undefined,
		})),
		postingTape: [...segment.postingTape],
	};
}

function applyCoverageLexicalV2OverlayPostingDelta(
	additions: Map<string, number[]>,
	removals: Map<string, number[]>,
	term: string,
	docId: number,
): void {
	const removalDocIds = removals.get(term);
	if (removalDocIds) {
		removeCoverageLexicalV2Number(removalDocIds, docId);
		if (removalDocIds.length === 0) {
			removals.delete(term);
		}
	}

	const additionDocIds = additions.get(term) ?? [];
	insertCoverageLexicalV2SortedNumber(additionDocIds, docId);
	if (additionDocIds.length > 0) {
		additions.set(term, additionDocIds);
	}
}

function applyCoverageLexicalV2OverlayPostingTombstone(
	additions: Map<string, number[]>,
	removals: Map<string, number[]>,
	term: string,
	docId: number,
): void {
	const additionDocIds = additions.get(term);
	if (additionDocIds) {
		removeCoverageLexicalV2Number(additionDocIds, docId);
		if (additionDocIds.length === 0) {
			additions.delete(term);
		}
	}

	const removalDocIds = removals.get(term) ?? [];
	insertCoverageLexicalV2SortedNumber(removalDocIds, docId);
	if (removalDocIds.length > 0) {
		removals.set(term, removalDocIds);
	}
}

function incrementCoverageLexicalV2TermRefCounts(
	refCounts: Map<string, number>,
	fieldTerms: CoverageLexicalV2FieldTermLists,
): void {
	for (const field of COVERAGE_LEXICAL_V2_POSTING_FIELDS) {
		for (const term of fieldTerms[field]) {
			refCounts.set(term, (refCounts.get(term) ?? 0) + 1);
		}
	}
}

function decrementCoverageLexicalV2TermRefCounts(
	refCounts: Map<string, number>,
	fieldTerms: CoverageLexicalV2FieldTermLists,
): void {
	for (const field of COVERAGE_LEXICAL_V2_POSTING_FIELDS) {
		for (const term of fieldTerms[field]) {
			const next = (refCounts.get(term) ?? 0) - 1;
			if (next > 0) {
				refCounts.set(term, next);
			} else {
				refCounts.delete(term);
			}
		}
	}
}

function incrementCoverageLexicalV2BigramRefCounts(
	refCounts: Map<string, number>,
	bigramsByField: CoverageLexicalV2MetadataBigramLists,
): void {
	for (const field of COVERAGE_LEXICAL_V2_METADATA_FIELDS) {
		for (const bigram of bigramsByField[field]) {
			refCounts.set(bigram, (refCounts.get(bigram) ?? 0) + 1);
		}
	}
}

function decrementCoverageLexicalV2BigramRefCounts(
	refCounts: Map<string, number>,
	bigramsByField: CoverageLexicalV2MetadataBigramLists,
): void {
	for (const field of COVERAGE_LEXICAL_V2_METADATA_FIELDS) {
		for (const bigram of bigramsByField[field]) {
			const next = (refCounts.get(bigram) ?? 0) - 1;
			if (next > 0) {
				refCounts.set(bigram, next);
			} else {
				refCounts.delete(bigram);
			}
		}
	}
}

function countCoverageLexicalV2PostingMapsDocumentCount(
	exactPostings: CoverageLexicalV2MutablePostingDelta<
		CoverageLexicalV2CandidateCascadePostingField
	>,
	metadataPostings: CoverageLexicalV2MutablePostingDelta<
		CoverageLexicalV2MetadataPostingField
	>,
): number {
	const docIds = new Set<number>();
	for (const field of COVERAGE_LEXICAL_V2_POSTING_FIELDS) {
		for (const posting of exactPostings[field].values()) {
			for (const docId of posting) {
				docIds.add(docId);
			}
		}
	}
	for (const field of COVERAGE_LEXICAL_V2_METADATA_FIELDS) {
		for (const posting of metadataPostings[field].values()) {
			for (const docId of posting) {
				docIds.add(docId);
			}
		}
	}
	return docIds.size;
}

function countCoverageLexicalV2MutableOverlayMutationCount(
	overlay: CoverageLexicalV2MutableOverlayState,
): number {
	return (
		countCoverageLexicalV2MutablePostingDeltaEntries(overlay.exactAddsByField) +
		countCoverageLexicalV2MutablePostingDeltaEntries(overlay.exactRemovalsByField) +
		countCoverageLexicalV2MutablePostingDeltaEntries(
			overlay.metadataHanAddsByField,
		) +
		countCoverageLexicalV2MutablePostingDeltaEntries(
			overlay.metadataHanRemovalsByField,
		)
	);
}

function countCoverageLexicalV2MutablePostingDeltaEntries<Field extends string>(
	postingsByField: CoverageLexicalV2MutablePostingDelta<Field>,
): number {
	let total = 0;
	for (const map of Object.values(postingsByField) as Array<Map<string, number[]>>) {
		for (const docIds of map.values()) {
			total += docIds.length;
		}
	}
	return total;
}

function estimateCoverageLexicalV2MutablePostingDeltaBytes<Field extends string>(
	postingsByField: CoverageLexicalV2MutablePostingDelta<Field>,
): number {
	let total = 0;
	for (const map of Object.values(postingsByField) as Array<Map<string, number[]>>) {
		for (const [term, docIds] of map) {
			total += estimateCoverageLexicalV2StringBytes(term);
			total += 16;
			total += docIds.length * 4;
		}
	}
	return total;
}

function estimateCoverageLexicalV2DocumentViewBytes(
	documentState: CoverageLexicalV2InternalDocumentState,
): number {
	return (
		estimateCoverageLexicalV2StringBytes(documentState.path) +
		estimateCoverageLexicalV2StringBytes(
			documentState.manifest.stableDeterministicKey,
		) +
		estimateCoverageLexicalV2StringBytes(
			documentState.manifest.normalizedMetadataTexts.basenameText,
		) +
		estimateCoverageLexicalV2StringBytes(
			documentState.manifest.normalizedMetadataTexts.aliasesText,
		) +
		estimateCoverageLexicalV2StringBytes(
			documentState.manifest.normalizedMetadataTexts.headingsText,
		) +
		estimateCoverageLexicalV2StringBytes(
			documentState.manifest.normalizedMetadataTexts.folderText,
		) +
		estimateCoverageLexicalV2StringBytes(
			documentState.manifest.normalizedMetadataTexts.tagsText,
		) +
		48
	);
}

function estimateCoverageLexicalV2BodyHanVerificationBytes(
	bodyHanSegments: readonly string[],
): number {
	let total = 0;
	for (const segment of bodyHanSegments) {
		total += estimateCoverageLexicalV2StringBytes(segment) + 8;
	}
	return total;
}

function estimateCoverageLexicalV2LatinExpansionBytes(
	terms: readonly string[],
): number {
	let total = 0;
	for (const term of terms) {
		total += estimateCoverageLexicalV2StringBytes(term) + 8;
	}
	return total;
}

function estimateCoverageLexicalV2BodyTokenSidecarBytes(
	bodyTokens: readonly string[],
): number {
	let total = 0;
	for (const token of bodyTokens) {
		total += estimateCoverageLexicalV2StringBytes(token) + 4;
	}
	return total;
}

function countCoverageLexicalV2PositiveRefCounts(
	refCounts: ReadonlyMap<string, number>,
): number {
	let total = 0;
	for (const count of refCounts.values()) {
		if (count > 0) {
			total += 1;
		}
	}
	return total;
}

function insertCoverageLexicalV2SortedNumber(values: number[], target: number): void {
	const index = lowerBoundCoverageLexicalV2IndexStoreNumber(values, target);
	if (values[index] === target) {
		return;
	}
	values.splice(index, 0, target);
}

function removeCoverageLexicalV2Number(values: number[], target: number): void {
	const index = lowerBoundCoverageLexicalV2IndexStoreNumber(values, target);
	if (values[index] === target) {
		values.splice(index, 1);
	}
}

function lowerBoundCoverageLexicalV2IndexStoreNumber(
	values: readonly number[],
	target: number,
): number {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (values[middle] < target) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return low;
}

function lowerBoundCoverageLexicalV2IndexStoreString(
	values: readonly string[],
	target: string,
): number {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (values[middle] < target) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return low;
}

function compareCoverageLexicalV2IndexStoreStrings(
	left: string,
	right: string,
): number {
	return left.localeCompare(right);
}

function estimateCoverageLexicalV2StringBytes(value: string): number {
	return textEncoder.encode(value).length;
}
