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
	term: string;
	boost: number;
	kind: 'exact' | 'prefix' | 'fuzzy';
};
type BM25ResolvedQueryTerm = {
	normalizedTerm: string;
	matchedTerms: BM25MatchedTerm[];
};
type PackedPostingList = {
	docIds: Uint32Array;
	tfNorms: Float32Array;
};

const textEncoder = new TextEncoder();

const HYBRID_QUERY_PREFIX_MIN_LENGTH = 4;
const HYBRID_QUERY_PREFIX_EXPANSION_LIMIT = 6;
const HYBRID_QUERY_FUZZY_MIN_LENGTH = 5;
const HYBRID_QUERY_FUZZY_EXPANSION_LIMIT = 4;
const HYBRID_QUERY_EXPANDABLE_TERM_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
const BM25_MAX_TF_NORM = BM25_K1 + 1;

export class BM25Engine {
	private readonly tokenizer = getInstance(Tokenizer);

	private termDict = new Map<string, { termId: number; df: number }>();
	private postings = new Map<number, PackedPostingList>();
	private sortedNormalizedTerms: string[] | null = null;
	private expansionLexiconDirty = true;
	private nextTermId = 0;
	private _docCount = 0;
	private avgDocLen = 0;
	private docLengths = new Map<number, number>();
	private totalDocLen = 0;

	get docCount(): number { return this._docCount; }

	clear(): void {
		this.termDict.clear();
		this.postings.clear();
		this.sortedNormalizedTerms = null;
		this.expansionLexiconDirty = true;
		this.docLengths.clear();
		this.nextTermId = 0;
		this._docCount = 0;
		this.avgDocLen = 0;
		this.totalDocLen = 0;
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

		for (const [term, tf] of tfMap) {
			let termEntry = this.termDict.get(term);
			if (!termEntry) {
				termEntry = { termId: this.nextTermId++, df: 0 };
				this.termDict.set(term, termEntry);
				this.expansionLexiconDirty = true;
			}
			termEntry.df++;

			const tfNorm = this.computeTfNorm(tf, dl);
			this.postings.set(
				termEntry.termId,
				insertPosting(this.postings.get(termEntry.termId), docId, tfNorm),
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

		for (const [term, termEntry] of Array.from(this.termDict.entries())) {
			const currentList = this.postings.get(termEntry.termId);
			if (!currentList) {
				this.termDict.delete(term);
				this.expansionLexiconDirty = true;
				continue;
			}

			const nextList = removePosting(currentList, docId);
			if (!nextList || nextList.docIds.length === 0) {
				this.postings.delete(termEntry.termId);
				this.termDict.delete(term);
				this.expansionLexiconDirty = true;
				continue;
			}

			this.postings.set(termEntry.termId, nextList);
			termEntry.df = nextList.docIds.length;
		}
	}

	search(query: string, topK = 20, options: BM25SearchOptions = {}): BM25SearchResult[] {
		const rawTerms = this.tokenizer
			.tokenize(query, 'search')
			.map((term) => this.normalizeQueryTerm(term))
			.filter((term) => term.length > 0);
		if (rawTerms.length === 0 || this._docCount === 0) return [];

		const enableQueryExpansion = options.enableQueryExpansion ?? false;
		const resolvedTerms = rawTerms.map((term) =>
			this.resolveQueryTerms(term, enableQueryExpansion),
		);

		const scores = new Map<number, number>();
		const N = this._docCount;

		for (const queryTerm of resolvedTerms) {
			for (const matchedTerm of queryTerm.matchedTerms) {
				const termEntry = this.termDict.get(matchedTerm.term);
				if (!termEntry) continue;

				const list = this.postings.get(termEntry.termId);
				if (!list) continue;

				const idf = Math.log((N - termEntry.df + 0.5) / (termEntry.df + 0.5) + 1);
				for (let index = 0; index < list.docIds.length; index++) {
					const docId = list.docIds[index];
					const tfNorm = list.tfNorms[index];
					scores.set(
						docId,
						(scores.get(docId) ?? 0) + tfNorm * idf * matchedTerm.boost,
					);
				}
			}
		}

		return Array.from(scores.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, topK)
			.map(([docId, score]) => ({ docId, score }));
	}

	serialize(): BM25Index {
		const termDictObj: BM25Index['termDict'] = {};
		for (const [term, entry] of this.termDict) {
			termDictObj[term] = { termId: entry.termId, df: entry.df };
		}

		const postingsObj: BM25Index['postings'] = {};
		for (const [termId, list] of this.postings) {
			postingsObj[termId] = {
				entries: Array.from(list.docIds, (docId, index) => ({
					docId,
					tfNorm: list.tfNorms[index],
				})),
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
		for (const term of mergedTerms) {
			const docScores = mergedEntriesByTerm.get(term);
			if (!docScores || docScores.size === 0) {
				continue;
			}

			const entries = Array.from(docScores.entries())
				.sort((left, right) => left[0] - right[0]);
			const termId = this.nextTermId++;
			this.termDict.set(term, { termId, df: entries.length });
			this.postings.set(termId, {
				docIds: Uint32Array.from(entries.map(([docId]) => docId)),
				tfNorms: Float32Array.from(entries.map(([, tfNorm]) => tfNorm)),
			});
		}

		this.expansionLexiconDirty = true;
	}

	optimizeStorage(): boolean {
		return false;
	}

	estimateRuntimeMemoryBytes(): number {
		let total = 0;

		for (const [term, entry] of this.termDict) {
			total += textEncoder.encode(term).length + 16;
			total += 16;
			const postingList = this.postings.get(entry.termId);
			if (!postingList) {
				continue;
			}
			total += postingList.docIds.byteLength;
			total += postingList.tfNorms.byteLength;
			total += 24;
		}

		for (const [docId] of this.docLengths) {
			total += 8;
			total += 8;
			void docId;
		}

		if (this.sortedNormalizedTerms !== null) {
			for (const normalizedTerm of this.sortedNormalizedTerms) {
				total += textEncoder.encode(normalizedTerm).length;
			}
		}

		return total;
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
		if (this.termDict.has(normalizedTerm)) {
			return {
				normalizedTerm,
				matchedTerms: [{
					term: normalizedTerm,
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
				matchedTerms: prefixMatches.map((term) => ({
					term,
					boost: computePrefixBoost(normalizedTerm, term),
					kind: 'prefix',
				})),
			};
		}

		return {
			normalizedTerm,
			matchedTerms: this.expandFuzzyTerms(normalizedTerm).map(({ term, distance }) => ({
				term,
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

	private expandPrefixTerms(prefix: string): string[] {
		const sortedNormalizedTerms = this.getSortedNormalizedTerms();
		const matches: string[] = [];
		let index = lowerBoundString(sortedNormalizedTerms, prefix);
		while (index < sortedNormalizedTerms.length) {
			const current = sortedNormalizedTerms[index];
			if (!current.startsWith(prefix)) {
				break;
			}
			matches.push(current);
			if (matches.length >= HYBRID_QUERY_PREFIX_EXPANSION_LIMIT) {
				break;
			}
			index++;
		}
		return matches;
	}

	private expandFuzzyTerms(queryTerm: string): Array<{ term: string; distance: number }> {
		const maxDistance = computeMaxFuzzyDistance(queryTerm);
		if (maxDistance <= 0) {
			return [];
		}

		const matches: Array<{ term: string; distance: number }> = [];
		for (const term of this.getSortedNormalizedTerms()) {
			if (Math.abs(term.length - queryTerm.length) > maxDistance) {
				continue;
			}
			if (term[0] !== queryTerm[0]) {
				continue;
			}
			const distance = boundedLevenshtein(term, queryTerm, maxDistance);
			if (distance <= maxDistance) {
				matches.push({ term, distance });
			}
		}

		matches.sort((left, right) => {
			if (left.distance !== right.distance) {
				return left.distance - right.distance;
			}
			const lengthDeltaLeft = Math.abs(left.term.length - queryTerm.length);
			const lengthDeltaRight = Math.abs(right.term.length - queryTerm.length);
			if (lengthDeltaLeft !== lengthDeltaRight) {
				return lengthDeltaLeft - lengthDeltaRight;
			}
			const prefixLeft = countSharedPrefix(queryTerm, left.term);
			const prefixRight = countSharedPrefix(queryTerm, right.term);
			if (prefixLeft !== prefixRight) {
				return prefixRight - prefixLeft;
			}
			return left.term.localeCompare(right.term);
		});

		return matches.slice(0, HYBRID_QUERY_FUZZY_EXPANSION_LIMIT);
	}

	private getSortedNormalizedTerms(): string[] {
		if (!this.expansionLexiconDirty && this.sortedNormalizedTerms !== null) {
			return this.sortedNormalizedTerms;
		}

		this.sortedNormalizedTerms = Array.from(this.termDict.keys())
			.sort((left, right) => left.localeCompare(right));
		this.expansionLexiconDirty = false;
		return this.sortedNormalizedTerms;
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
	if (!list) {
		return {
			docIds: Uint32Array.of(docId),
			tfNorms: Float32Array.of(tfNorm),
		};
	}

	const index = lowerBoundUint32(list.docIds, docId);
	const nextDocIds = new Uint32Array(list.docIds.length + 1);
	const nextTfNorms = new Float32Array(list.tfNorms.length + 1);
	nextDocIds.set(list.docIds.subarray(0, index), 0);
	nextTfNorms.set(list.tfNorms.subarray(0, index), 0);
	nextDocIds[index] = docId;
	nextTfNorms[index] = tfNorm;
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
	const nextTfNorms = new Float32Array(list.tfNorms.length - 1);
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

function lowerBoundString(values: string[], target: string): number {
	let lo = 0;
	let hi = values.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (values[mid].localeCompare(target) < 0) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

function computeMaxFuzzyDistance(queryTerm: string): number {
	if (queryTerm.length < HYBRID_QUERY_FUZZY_MIN_LENGTH) {
		return 0;
	}
	return queryTerm.length >= 8 ? 2 : 1;
}

function computePrefixBoost(queryTerm: string, matchedTerm: string): number {
	return Math.max(
		0.72,
		Math.min(0.96, queryTerm.length / Math.max(queryTerm.length, matchedTerm.length)),
	);
}

function computeFuzzyBoost(distance: number): number {
	return Math.max(0.64, 1 - distance * 0.18);
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
