import { Tokenizer } from 'src/services/search/tokenizer';
import { getInstance } from 'src/utils/my-lib';
import {
	BM25_B,
	BM25_K1,
	type BM25Index,
} from './hybrid-types';

type BM25SearchResult = { docId: number; score: number };
type BM25SearchOptions = {
	useProximity?: boolean;
	enableQueryExpansion?: boolean;
};
type BM25MatchedTerm = {
	termId: number;
	boost: number;
	kind: 'exact' | 'prefix' | 'fuzzy';
};
type BM25ResolvedQueryTerm = {
	normalizedTerm: string;
	matchedTerms: BM25MatchedTerm[];
};
export type BM25RuntimeMemoryBreakdown = {
	termTextBytes: number;
	termOffsetBytes: number;
	termDfBytes: number;
	postingStartBytes: number;
	postingLengthBytes: number;
	termFlagBytes: number;
	sortedTermIdsBytes: number;
	termDictBytes: number;
	postingDocIdsBytes: number;
	postingTfNormBytes: number;
	postingContainerBytes: number;
	expansionLexiconBytes: number;
	docLengthsBytes: number;
	termCount: number;
	activeTermCount: number;
	expandableTermCount: number;
	postingCount: number;
	docCount: number;
	totalBytes: number;
};
type PackedPostingList = {
	docIds: Uint32Array;
	tfNorms: Uint8Array;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const HYBRID_QUERY_PREFIX_MIN_LENGTH = 4;
const HYBRID_QUERY_PREFIX_EXPANSION_LIMIT = 6;
const HYBRID_QUERY_FUZZY_MIN_LENGTH = 5;
const HYBRID_QUERY_FUZZY_EXPANSION_LIMIT = 4;
const HYBRID_QUERY_EXPANDABLE_TERM_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
const HYBRID_PREFIX_BOOST_MIN = 0.58;
const HYBRID_PREFIX_BOOST_MAX = 0.88;
const HYBRID_FUZZY_DISTANCE_ONE_BOOST = 0.48;
const HYBRID_FUZZY_DISTANCE_TWO_BOOST = 0.3;
const BM25_MAX_TF_NORM = BM25_K1 + 1;
const TERM_FLAG_ACTIVE = 1;
const TERM_FLAG_EXPANDABLE = 2;

export class BM25Engine {
	private readonly tokenizer = getInstance(Tokenizer);

	private termBytes = new Uint8Array(0);
	private termOffsets = new Uint32Array(1);
	private termDfs = new Uint32Array(0);
	private postingStarts = new Uint32Array(0);
	private postingLengths = new Uint32Array(0);
	private termFlags = new Uint8Array(0);
	private activeTermLookup: Map<string, number> | null = null;
	private dirtyTermTextOverrides = new Map<number, string>();
	private docIdsArena = new Uint32Array(0);
	private tfNormsArena = new Uint8Array(0);
	private dirtyPostingOverrides = new Map<number, PackedPostingList | null>();
	private postingsDirty = false;
	private termsDirty = false;
	private sortedActiveTermIds: Uint32Array | null = null;
	private lexiconDirty = true;
	private _docCount = 0;
	private avgDocLen = 0;
	private docLengths = new Map<number, number>();
	private totalDocLen = 0;
	private activeTermCount = 0;

	get docCount(): number { return this._docCount; }

	clear(): void {
		this.termBytes = new Uint8Array(0);
		this.termOffsets = new Uint32Array(1);
		this.termDfs = new Uint32Array(0);
		this.postingStarts = new Uint32Array(0);
		this.postingLengths = new Uint32Array(0);
		this.termFlags = new Uint8Array(0);
		this.activeTermLookup = null;
		this.dirtyTermTextOverrides.clear();
		this.docIdsArena = new Uint32Array(0);
		this.tfNormsArena = new Uint8Array(0);
		this.dirtyPostingOverrides.clear();
		this.postingsDirty = false;
		this.termsDirty = false;
		this.sortedActiveTermIds = null;
		this.lexiconDirty = true;
		this.docLengths.clear();
		this._docCount = 0;
		this.avgDocLen = 0;
		this.totalDocLen = 0;
		this.activeTermCount = 0;
	}

	addDocument(docId: number, text: string): void {
		if (this.docLengths.has(docId)) {
			this.removeDocument(docId);
		}

		const terms = this.tokenizer
			.tokenizeSequence(text, 'index')
			.map((term) => this.normalizeIndexedTerm(term))
			.filter((term) => term.length > 0);
		const dl = terms.length;

		this.docLengths.set(docId, dl);
		this.totalDocLen += dl;
		this._docCount++;
		this.avgDocLen = this.totalDocLen / this._docCount;

		const tfMap = new Map<string, number>();
		for (const term of terms) {
			tfMap.set(term, (tfMap.get(term) ?? 0) + 1);
		}

		this.ensureMutableTermLookup();
		for (const [term, tf] of tfMap) {
			let termId = this.activeTermLookup?.get(term) ?? null;
			if (termId === null) {
				termId = this.createTerm(term);
			}

			this.termDfs[termId] += 1;
			const tfNorm = this.computeTfNorm(tf, dl);
			this.setPostingList(
				termId,
				insertPosting(this.clonePostingList(this.materializePostingList(termId)), docId, tfNorm),
			);
		}
	}

	removeDocument(docId: number): void {
		const dl = this.docLengths.get(docId);
		if (dl === undefined) return;

		this.docLengths.delete(docId);
		this.totalDocLen -= dl;
		this._docCount--;
		this.avgDocLen = this._docCount > 0 ? this.totalDocLen / this._docCount : 0;

		for (let termId = 0; termId < this.termFlags.length; termId++) {
			if (!this.isActiveTermId(termId)) {
				continue;
			}

			const currentList = this.materializePostingList(termId);
			if (!currentList) {
				this.deleteTerm(termId);
				continue;
			}

			const nextList = removePosting(currentList, docId);
			if (nextList === currentList) {
				continue;
			}

			if (!nextList || nextList.docIds.length === 0) {
				this.setPostingList(termId, null);
				this.deleteTerm(termId);
				continue;
			}

			this.termDfs[termId] = nextList.docIds.length;
			this.setPostingList(termId, nextList);
		}
	}

	search(query: string, topK = 20, options: BM25SearchOptions = {}): BM25SearchResult[] {
		this.flushDirtyState();

		const rawTerms = this.tokenizer
			.tokenize(query, 'search')
			.map((term) => this.normalizeQueryTerm(term))
			.filter((term) => term.length > 0);
		if (topK <= 0 || rawTerms.length === 0 || this._docCount === 0) return [];

		const enableQueryExpansion = options.enableQueryExpansion ?? false;
		const resolvedTerms = rawTerms.map((term) =>
			this.resolveQueryTerms(term, enableQueryExpansion),
		);

		const scores = new Map<number, number>();
		const N = this._docCount;

		for (const queryTerm of resolvedTerms) {
			for (const matchedTerm of queryTerm.matchedTerms) {
				const df = this.termDfs[matchedTerm.termId] ?? 0;
				if (df <= 0) continue;

				const list = this.materializePostingList(matchedTerm.termId);
				if (!list) continue;

				const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
				for (let index = 0; index < list.docIds.length; index++) {
					const docId = list.docIds[index];
					const tfNorm = dequantizeRuntimeTfNorm(list.tfNorms[index]);
					scores.set(
						docId,
						(scores.get(docId) ?? 0) + tfNorm * idf * matchedTerm.boost,
					);
				}
			}
		}

		return selectTopKScoreEntries(scores, topK)
			.map(([docId, score]) => ({ docId, score }));
	}

	serialize(): BM25Index {
		this.flushDirtyState();

		const termDictObj: BM25Index['termDict'] = {};
		const postingsObj: BM25Index['postings'] = {};
		for (let termId = 0; termId < this.termFlags.length; termId++) {
			if (!this.isActiveTermId(termId)) {
				continue;
			}

			const term = this.getCompactTermText(termId);
			termDictObj[term] = { termId, df: this.termDfs[termId] ?? 0 };

			const list = this.materializePostingList(termId);
			postingsObj[termId] = {
				entries: list
					? Array.from(list.docIds, (docId, index) => ({
						docId,
						tfNorm: dequantizeRuntimeTfNorm(list.tfNorms[index]),
					}))
					: [],
			};
		}

		const docLengthsObj: BM25Index['docLengths'] = {};
		for (const [id, len] of this.docLengths) {
			docLengthsObj[id] = len;
		}

		return {
			termDict: termDictObj,
			postings: postingsObj,
			docCount: this._docCount,
			avgDocLen: this.avgDocLen,
			docLengths: docLengthsObj,
		};
	}

	deserialize(data: BM25Index): void {
		this.clear();

		for (const [idStr, len] of Object.entries(data.docLengths)) {
			this.docLengths.set(Number(idStr), len as number);
		}

		this._docCount = data.docCount;
		this.avgDocLen = data.avgDocLen;
		this.totalDocLen = Array.from(this.docLengths.values()).reduce((sum, len) => sum + len, 0);
		if (this.totalDocLen === 0 && data.docCount > 0) {
			this.totalDocLen = data.avgDocLen * data.docCount;
		}

		const mergedEntriesByTerm = new Map<string, Map<number, number>>();
		for (const [term, entry] of Object.entries(data.termDict)) {
			const normalizedTerm = this.normalizeIndexedTerm(term);
			if (normalizedTerm.length === 0) {
				continue;
			}

			const postingEntries = data.postings[entry.termId]?.entries ?? [];
			let docScores = mergedEntriesByTerm.get(normalizedTerm);
			if (!docScores) {
				docScores = new Map<number, number>();
				mergedEntriesByTerm.set(normalizedTerm, docScores);
			}

			for (const posting of postingEntries) {
				docScores.set(
					posting.docId,
					Math.min(
						BM25_MAX_TF_NORM,
						(docScores.get(posting.docId) ?? 0) + posting.tfNorm,
					),
				);
			}
		}

		const mergedTerms = Array.from(mergedEntriesByTerm.keys())
			.sort((left, right) => left.localeCompare(right));
		this.termDfs = new Uint32Array(mergedTerms.length);
		this.postingStarts = new Uint32Array(mergedTerms.length);
		this.postingLengths = new Uint32Array(mergedTerms.length);
		this.termFlags = new Uint8Array(mergedTerms.length);
		this.activeTermCount = mergedTerms.length;

		const encodedTerms = mergedTerms.map((term) => textEncoder.encode(term));
		const totalTermBytes = encodedTerms.reduce((sum, bytes) => sum + bytes.length, 0);
		this.termBytes = new Uint8Array(totalTermBytes);
		this.termOffsets = new Uint32Array(mergedTerms.length + 1);
		let termCursor = 0;
		for (let termId = 0; termId < mergedTerms.length; termId++) {
			this.termOffsets[termId] = termCursor;
			this.termBytes.set(encodedTerms[termId], termCursor);
			termCursor += encodedTerms[termId].length;
			this.termFlags[termId] = TERM_FLAG_ACTIVE;
			if (this.shouldExpandTerm(mergedTerms[termId])) {
				this.termFlags[termId] |= TERM_FLAG_EXPANDABLE;
			}
		}
		this.termOffsets[mergedTerms.length] = termCursor;

		const totalPostings = mergedTerms.reduce((sum, term) => {
			return sum + (mergedEntriesByTerm.get(term)?.size ?? 0);
		}, 0);
		this.docIdsArena = new Uint32Array(totalPostings);
		this.tfNormsArena = new Uint8Array(totalPostings);

		let postingCursor = 0;
		for (let termId = 0; termId < mergedTerms.length; termId++) {
			const docScores = mergedEntriesByTerm.get(mergedTerms[termId]);
			if (!docScores || docScores.size === 0) {
				continue;
			}

			const entries = Array.from(docScores.entries())
				.sort((left, right) => left[0] - right[0]);
			this.termDfs[termId] = entries.length;
			this.postingStarts[termId] = postingCursor;
			this.postingLengths[termId] = entries.length;
			for (let index = 0; index < entries.length; index++) {
				this.docIdsArena[postingCursor + index] = entries[index][0];
				this.tfNormsArena[postingCursor + index] = quantizeRuntimeTfNorm(entries[index][1]);
			}
			postingCursor += entries.length;
		}

		this.activeTermLookup = null;
		this.sortedActiveTermIds = null;
		this.lexiconDirty = true;
	}

	optimizeStorage(): boolean {
		return false;
	}

	estimateRuntimeMemoryBytes(): number {
		return this.estimateRuntimeMemoryBreakdown().totalBytes;
	}

	estimateRuntimeMemoryBreakdown(): BM25RuntimeMemoryBreakdown {
		this.flushDirtyState();
		this.ensureSortedActiveTermIds();

		let docLengthsBytes = 0;
		for (const [docId] of this.docLengths) {
			docLengthsBytes += 8;
			docLengthsBytes += 8;
			void docId;
		}

		let expandableTermCount = 0;
		for (let termId = 0; termId < this.termFlags.length; termId++) {
			if (this.isExpandableTermId(termId)) {
				expandableTermCount += 1;
			}
		}

		const termTextBytes = this.termBytes.byteLength;
		const termOffsetBytes = this.termOffsets.byteLength;
		const termDfBytes = this.termDfs.byteLength;
		const postingStartBytes = this.postingStarts.byteLength;
		const postingLengthBytes = this.postingLengths.byteLength;
		const termFlagBytes = this.termFlags.byteLength;
		const sortedTermIdsBytes = this.sortedActiveTermIds?.byteLength ?? 0;
		const termDictBytes =
			termTextBytes +
			termOffsetBytes +
			termDfBytes +
			postingStartBytes +
			postingLengthBytes +
			termFlagBytes +
			sortedTermIdsBytes;

		const postingContainerBytes = this.dirtyPostingOverrides.size * 24;
		const postingDocIdsBytes = this.docIdsArena.byteLength;
		const postingTfNormBytes = this.tfNormsArena.byteLength;
		const totalBytes =
			termDictBytes +
			postingDocIdsBytes +
			postingTfNormBytes +
			postingContainerBytes +
			docLengthsBytes;

		return {
			termTextBytes,
			termOffsetBytes,
			termDfBytes,
			postingStartBytes,
			postingLengthBytes,
			termFlagBytes,
			sortedTermIdsBytes,
			termDictBytes,
			postingDocIdsBytes,
			postingTfNormBytes,
			postingContainerBytes,
			expansionLexiconBytes: sortedTermIdsBytes,
			docLengthsBytes,
			termCount: this.termFlags.length,
			activeTermCount: this.activeTermCount,
			expandableTermCount,
			postingCount: this.docIdsArena.length,
			docCount: this.docLengths.size,
			totalBytes,
		};
	}

	private computeTfNorm(tf: number, dl: number): number {
		const avgdl = this.avgDocLen || 1;
		return (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgdl)));
	}

	private resolveQueryTerms(
		queryTerm: string,
		enableQueryExpansion: boolean,
	): BM25ResolvedQueryTerm {
		const normalizedTerm = this.normalizeQueryTerm(queryTerm);
		const exactTermId = this.findActiveTermIdInCompactDict(normalizedTerm);
		if (exactTermId !== null) {
			return {
				normalizedTerm,
				matchedTerms: [{
					termId: exactTermId,
					boost: 1,
					kind: 'exact',
				}],
			};
		}

		if (!enableQueryExpansion || !this.shouldExpandTerm(normalizedTerm)) {
			return { normalizedTerm, matchedTerms: [] };
		}

		const prefixMatches = this.expandPrefixTerms(normalizedTerm);
		if (prefixMatches.length > 0) {
			return {
				normalizedTerm,
				matchedTerms: prefixMatches.map((termId) => ({
					termId,
					boost: computePrefixBoost(normalizedTerm, this.getCompactTermText(termId)),
					kind: 'prefix',
				})),
			};
		}

		return {
			normalizedTerm,
			matchedTerms: this.expandFuzzyTerms(normalizedTerm).map(({ termId, distance }) => ({
				termId,
				boost: computeFuzzyBoost(distance),
				kind: 'fuzzy',
			})),
		};
	}

	private shouldExpandTerm(term: string): boolean {
		return (
			term.length >= HYBRID_QUERY_PREFIX_MIN_LENGTH &&
			HYBRID_QUERY_EXPANDABLE_TERM_REGEX.test(term)
		);
	}

	private expandPrefixTerms(prefix: string): number[] {
		this.ensureSortedActiveTermIds();

		const matches: number[] = [];
		const sortedActiveTermIds = this.sortedActiveTermIds ?? new Uint32Array(0);
		let index = lowerBoundTermIds(sortedActiveTermIds, prefix, (termId) => this.getCompactTermText(termId));
		while (index < sortedActiveTermIds.length) {
			const termId = sortedActiveTermIds[index];
			const current = this.getCompactTermText(termId);
			if (!current.startsWith(prefix)) {
				break;
			}
			if (this.isExpandableTermId(termId)) {
				matches.push(termId);
				if (matches.length >= HYBRID_QUERY_PREFIX_EXPANSION_LIMIT) {
					break;
				}
			}
			index++;
		}
		return matches;
	}

	private expandFuzzyTerms(queryTerm: string): Array<{ termId: number; distance: number }> {
		const maxDistance = computeMaxFuzzyDistance(queryTerm);
		if (maxDistance <= 0) {
			return [];
		}

		this.ensureSortedActiveTermIds();
		const matches: Array<{ termId: number; distance: number }> = [];
		for (const termId of this.sortedActiveTermIds ?? new Uint32Array(0)) {
			if (!this.isExpandableTermId(termId)) {
				continue;
			}
			const term = this.getCompactTermText(termId);
			if (Math.abs(term.length - queryTerm.length) > maxDistance) {
				continue;
			}
			if (term[0] !== queryTerm[0]) {
				continue;
			}
			const distance = boundedLevenshtein(term, queryTerm, maxDistance);
			if (distance <= maxDistance) {
				matches.push({ termId, distance });
			}
		}

		matches.sort((left, right) => {
			if (left.distance !== right.distance) {
				return left.distance - right.distance;
			}
			const leftTerm = this.getCompactTermText(left.termId);
			const rightTerm = this.getCompactTermText(right.termId);
			const lengthDeltaLeft = Math.abs(leftTerm.length - queryTerm.length);
			const lengthDeltaRight = Math.abs(rightTerm.length - queryTerm.length);
			if (lengthDeltaLeft !== lengthDeltaRight) {
				return lengthDeltaLeft - lengthDeltaRight;
			}
			const prefixLeft = countSharedPrefix(queryTerm, leftTerm);
			const prefixRight = countSharedPrefix(queryTerm, rightTerm);
			if (prefixLeft !== prefixRight) {
				return prefixRight - prefixLeft;
			}
			return leftTerm.localeCompare(rightTerm);
		});

		return matches.slice(0, HYBRID_QUERY_FUZZY_EXPANSION_LIMIT);
	}

	private ensureMutableTermLookup(): void {
		if (this.activeTermLookup) {
			return;
		}

		this.activeTermLookup = new Map<string, number>();
		for (let termId = 0; termId < this.termFlags.length; termId++) {
			if (!this.isActiveTermId(termId)) {
				continue;
			}
			this.activeTermLookup.set(this.getCurrentTermText(termId), termId);
		}
	}

	private ensureSortedActiveTermIds(): void {
		if (!this.lexiconDirty && this.sortedActiveTermIds !== null) {
			return;
		}

		const activeTermIds: number[] = [];
		for (let termId = 0; termId < this.termFlags.length; termId++) {
			if (this.isActiveTermId(termId)) {
				activeTermIds.push(termId);
			}
		}

		activeTermIds.sort((left, right) =>
			this.getCurrentTermText(left).localeCompare(this.getCurrentTermText(right)),
		);
		this.sortedActiveTermIds = Uint32Array.from(activeTermIds);
		this.lexiconDirty = false;
	}

	private findActiveTermIdInCompactDict(term: string): number | null {
		this.ensureSortedActiveTermIds();
		const sortedActiveTermIds = this.sortedActiveTermIds ?? new Uint32Array(0);
		const index = lowerBoundTermIds(sortedActiveTermIds, term, (termId) => this.getCompactTermText(termId));
		if (
			index < sortedActiveTermIds.length &&
			this.getCompactTermText(sortedActiveTermIds[index]) === term
		) {
			return sortedActiveTermIds[index];
		}
		return null;
	}

	private createTerm(term: string): number {
		const termId = this.termFlags.length;
		this.termDfs = appendUint32(this.termDfs, 0);
		this.postingStarts = appendUint32(this.postingStarts, 0);
		this.postingLengths = appendUint32(this.postingLengths, 0);
		this.termFlags = appendUint8(this.termFlags, this.buildTermFlags(term));
		this.dirtyTermTextOverrides.set(termId, term);
		this.termsDirty = true;
		this.lexiconDirty = true;
		this.activeTermCount++;
		this.activeTermLookup?.set(term, termId);
		return termId;
	}

	private deleteTerm(termId: number): void {
		if (!this.isActiveTermId(termId)) {
			return;
		}

		this.activeTermLookup?.delete(this.getCurrentTermText(termId));
		this.termFlags[termId] = 0;
		this.termDfs[termId] = 0;
		this.postingStarts[termId] = 0;
		this.postingLengths[termId] = 0;
		this.dirtyTermTextOverrides.delete(termId);
		this.termsDirty = true;
		this.lexiconDirty = true;
		this.activeTermCount--;
	}

	private isActiveTermId(termId: number): boolean {
		return (this.termFlags[termId] & TERM_FLAG_ACTIVE) !== 0;
	}

	private isExpandableTermId(termId: number): boolean {
		return (this.termFlags[termId] & TERM_FLAG_EXPANDABLE) !== 0;
	}

	private buildTermFlags(term: string): number {
		return TERM_FLAG_ACTIVE | (this.shouldExpandTerm(term) ? TERM_FLAG_EXPANDABLE : 0);
	}

	private getCurrentTermText(termId: number): string {
		return this.dirtyTermTextOverrides.get(termId) ?? this.getCompactTermText(termId);
	}

	private getCompactTermText(termId: number): string {
		if (termId < 0 || termId + 1 >= this.termOffsets.length) {
			return '';
		}
		const start = this.termOffsets[termId];
		const end = this.termOffsets[termId + 1];
		if (end <= start) {
			return '';
		}
		return textDecoder.decode(this.termBytes.subarray(start, end));
	}

	private materializePostingList(termId: number): PackedPostingList | null {
		if (this.dirtyPostingOverrides.has(termId)) {
			return this.dirtyPostingOverrides.get(termId) ?? null;
		}

		if (!this.isActiveTermId(termId)) {
			return null;
		}

		const length = this.postingLengths[termId] ?? 0;
		if (length === 0) {
			return null;
		}
		const start = this.postingStarts[termId] ?? 0;
		return {
			docIds: this.docIdsArena.subarray(start, start + length),
			tfNorms: this.tfNormsArena.subarray(start, start + length),
		};
	}

	private clonePostingList(list: PackedPostingList | null): PackedPostingList | undefined {
		if (!list) {
			return undefined;
		}
		return {
			docIds: Uint32Array.from(list.docIds),
			tfNorms: Uint8Array.from(list.tfNorms),
		};
	}

	private setPostingList(termId: number, list: PackedPostingList | null): void {
		this.dirtyPostingOverrides.set(termId, list);
		this.postingsDirty = true;
	}

	private flushDirtyState(): void {
		if (this.postingsDirty) {
			this.flushDirtyPostings();
		}
		if (this.termsDirty) {
			this.flushDirtyTerms();
		}
		this.activeTermLookup = null;
	}

	private flushDirtyPostings(): void {
		let totalPostings = 0;
		for (let termId = 0; termId < this.termFlags.length; termId++) {
			if (!this.isActiveTermId(termId)) {
				continue;
			}
			const list = this.materializePostingList(termId);
			if (!list || list.docIds.length === 0) {
				continue;
			}
			totalPostings += list.docIds.length;
		}

		const nextDocIdsArena = new Uint32Array(totalPostings);
		const nextTfNormsArena = new Uint8Array(totalPostings);
		const nextPostingStarts = new Uint32Array(this.postingStarts.length);
		const nextPostingLengths = new Uint32Array(this.postingLengths.length);

		let cursor = 0;
		for (let termId = 0; termId < this.termFlags.length; termId++) {
			if (!this.isActiveTermId(termId)) {
				continue;
			}
			const list = this.materializePostingList(termId);
			if (!list || list.docIds.length === 0) {
				continue;
			}

			nextPostingStarts[termId] = cursor;
			nextPostingLengths[termId] = list.docIds.length;
			nextDocIdsArena.set(list.docIds, cursor);
			nextTfNormsArena.set(list.tfNorms, cursor);
			cursor += list.docIds.length;
		}

		this.docIdsArena = nextDocIdsArena;
		this.tfNormsArena = nextTfNormsArena;
		this.postingStarts = nextPostingStarts;
		this.postingLengths = nextPostingLengths;
		this.dirtyPostingOverrides.clear();
		this.postingsDirty = false;
	}

	private flushDirtyTerms(): void {
		const termCount = this.termFlags.length;
		const encodedTerms: Uint8Array[] = new Array(termCount);
		let totalTermBytes = 0;
		for (let termId = 0; termId < termCount; termId++) {
			const text = this.isActiveTermId(termId) ? this.getCurrentTermText(termId) : '';
			const encoded = textEncoder.encode(text);
			encodedTerms[termId] = encoded;
			totalTermBytes += encoded.length;
			if (this.isActiveTermId(termId)) {
				this.termFlags[termId] = this.buildTermFlags(text);
			}
		}

		const nextTermBytes = new Uint8Array(totalTermBytes);
		const nextTermOffsets = new Uint32Array(termCount + 1);
		let cursor = 0;
		for (let termId = 0; termId < termCount; termId++) {
			nextTermOffsets[termId] = cursor;
			nextTermBytes.set(encodedTerms[termId], cursor);
			cursor += encodedTerms[termId].length;
		}
		nextTermOffsets[termCount] = cursor;

		this.termBytes = nextTermBytes;
		this.termOffsets = nextTermOffsets;
		this.dirtyTermTextOverrides.clear();
		this.termsDirty = false;
		this.lexiconDirty = true;
	}

	private normalizeIndexedTerm(term: string): string {
		return term.toLocaleLowerCase();
	}

	private normalizeQueryTerm(term: string): string {
		return term.toLocaleLowerCase();
	}
}

function insertPosting(
	list: PackedPostingList | undefined,
	docId: number,
	tfNorm: number,
): PackedPostingList {
	const tfNormByte = quantizeRuntimeTfNorm(tfNorm);
	if (!list) {
		return {
			docIds: Uint32Array.of(docId),
			tfNorms: Uint8Array.of(tfNormByte),
		};
	}

	const index = lowerBoundUint32(list.docIds, docId);
	const nextDocIds = new Uint32Array(list.docIds.length + 1);
	const nextTfNorms = new Uint8Array(list.tfNorms.length + 1);
	nextDocIds.set(list.docIds.subarray(0, index), 0);
	nextTfNorms.set(list.tfNorms.subarray(0, index), 0);
	nextDocIds[index] = docId;
	nextTfNorms[index] = tfNormByte;
	nextDocIds.set(list.docIds.subarray(index), index + 1);
	nextTfNorms.set(list.tfNorms.subarray(index), index + 1);
	return {
		docIds: nextDocIds,
		tfNorms: nextTfNorms,
	};
}

function removePosting(
	list: PackedPostingList,
	docId: number,
): PackedPostingList | null {
	const index = lowerBoundUint32(list.docIds, docId);
	if (index >= list.docIds.length || list.docIds[index] !== docId) {
		return list;
	}
	if (list.docIds.length === 1) {
		return null;
	}

	const nextDocIds = new Uint32Array(list.docIds.length - 1);
	const nextTfNorms = new Uint8Array(list.tfNorms.length - 1);
	nextDocIds.set(list.docIds.subarray(0, index), 0);
	nextTfNorms.set(list.tfNorms.subarray(0, index), 0);
	nextDocIds.set(list.docIds.subarray(index + 1), index);
	nextTfNorms.set(list.tfNorms.subarray(index + 1), index);
	return {
		docIds: nextDocIds,
		tfNorms: nextTfNorms,
	};
}

function lowerBoundUint32(values: Uint32Array, target: number): number {
	let lo = 0;
	let hi = values.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (values[mid] < target) {
			lo = mid + 1;
		} else {
			hi = mid;
		}
	}
	return lo;
}

function lowerBoundTermIds(
	values: Uint32Array,
	target: string,
	getTermText: (termId: number) => string,
): number {
	let lo = 0;
	let hi = values.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (getTermText(values[mid]).localeCompare(target) < 0) {
			lo = mid + 1;
		} else {
			hi = mid;
		}
	}
	return lo;
}

function appendUint32(values: Uint32Array, value: number): Uint32Array {
	const next = new Uint32Array(values.length + 1);
	next.set(values, 0);
	next[values.length] = value;
	return next;
}

function appendUint8(values: Uint8Array, value: number): Uint8Array {
	const next = new Uint8Array(values.length + 1);
	next.set(values, 0);
	next[values.length] = value;
	return next;
}

function computeMaxFuzzyDistance(queryTerm: string): number {
	if (queryTerm.length < HYBRID_QUERY_FUZZY_MIN_LENGTH) {
		return 0;
	}
	return queryTerm.length >= 8 ? 2 : 1;
}

function computePrefixBoost(queryTerm: string, matchedTerm: string): number {
	return Math.max(
		HYBRID_PREFIX_BOOST_MIN,
		Math.min(
			HYBRID_PREFIX_BOOST_MAX,
			queryTerm.length / Math.max(queryTerm.length, matchedTerm.length),
		),
	);
}

function computeFuzzyBoost(distance: number): number {
	if (distance <= 1) {
		return HYBRID_FUZZY_DISTANCE_ONE_BOOST;
	}
	return HYBRID_FUZZY_DISTANCE_TWO_BOOST;
}

function selectTopKScoreEntries(
	scores: Map<number, number>,
	topK: number,
): Array<[number, number]> {
	const entries = Array.from(scores.entries());
	if (entries.length <= topK) {
		return entries.sort((a, b) => b[1] - a[1]);
	}

	const heap: Array<[number, number]> = [];
	for (const entry of entries) {
		if (heap.length < topK) {
			pushMinScoreHeap(heap, entry);
			continue;
		}

		if (entry[1] <= heap[0][1]) {
			continue;
		}

		heap[0] = entry;
		siftDownMinScoreHeap(heap, 0);
	}

	return heap.sort((a, b) => b[1] - a[1]);
}

function pushMinScoreHeap(
	heap: Array<[number, number]>,
	entry: [number, number],
): void {
	heap.push(entry);
	siftUpMinScoreHeap(heap, heap.length - 1);
}

function siftUpMinScoreHeap(heap: Array<[number, number]>, index: number): void {
	let current = index;
	while (current > 0) {
		const parent = (current - 1) >> 1;
		if (heap[parent][1] <= heap[current][1]) {
			return;
		}
		[heap[parent], heap[current]] = [heap[current], heap[parent]];
		current = parent;
	}
}

function siftDownMinScoreHeap(heap: Array<[number, number]>, index: number): void {
	let current = index;
	while (true) {
		const left = current * 2 + 1;
		const right = left + 1;
		let smallest = current;

		if (left < heap.length && heap[left][1] < heap[smallest][1]) {
			smallest = left;
		}
		if (right < heap.length && heap[right][1] < heap[smallest][1]) {
			smallest = right;
		}
		if (smallest === current) {
			return;
		}

		[heap[current], heap[smallest]] = [heap[smallest], heap[current]];
		current = smallest;
	}
}

function quantizeRuntimeTfNorm(value: number): number {
	const clamped = Math.max(0, Math.min(BM25_MAX_TF_NORM, value));
	return Math.round((clamped / BM25_MAX_TF_NORM) * 255);
}

function dequantizeRuntimeTfNorm(value: number): number {
	return (value / 255) * BM25_MAX_TF_NORM;
}

function boundedLevenshtein(a: string, b: string, maxDistance: number): number {
	if (a === b) {
		return 0;
	}
	if (Math.abs(a.length - b.length) > maxDistance) {
		return maxDistance + 1;
	}

	const previous = new Array<number>(b.length + 1);
	const current = new Array<number>(b.length + 1);
	for (let j = 0; j <= b.length; j++) {
		previous[j] = j;
	}

	for (let i = 1; i <= a.length; i++) {
		current[0] = i;
		let rowMin = current[0];
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			current[j] = Math.min(
				previous[j] + 1,
				current[j - 1] + 1,
				previous[j - 1] + cost,
			);
			rowMin = Math.min(rowMin, current[j]);
		}
		if (rowMin > maxDistance) {
			return maxDistance + 1;
		}
		for (let j = 0; j <= b.length; j++) {
			previous[j] = current[j];
		}
	}

	return previous[b.length];
}

function countSharedPrefix(left: string, right: string): number {
	const limit = Math.min(left.length, right.length);
	let index = 0;
	while (index < limit && left[index] === right[index]) {
		index++;
	}
	return index;
}
