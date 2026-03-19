import { Tokenizer } from 'src/services/search/tokenizer';
import { getInstance } from 'src/utils/my-lib';
import {
	BM25_B,
	BM25_K1,
	type BM25Index,
	type BM25PostingEntry,
	type PostingList,
} from './hybrid-types';

type BM25SearchResult = { bigChunkId: number; score: number };

export class BM25Engine {
	private readonly tokenizer = getInstance(Tokenizer);

	private termDict = new Map<string, { termId: number; df: number }>();
	private postings = new Map<number, PostingList>();
	private nextTermId = 0;
	private _docCount = 0;
	private avgBigChunkLen = 0;
	private docLengths = new Map<number, number>(); // bigChunkId → token count
	// sum of all doc lengths, used to recompute avg incrementally
	private totalDocLen = 0;

	get docCount(): number { return this._docCount; }

	clear(): void {
		this.termDict.clear();
		this.postings.clear();
		this.docLengths.clear();
		this.nextTermId = 0;
		this._docCount = 0;
		this.avgBigChunkLen = 0;
		this.totalDocLen = 0;
	}

	// ─── Indexing ─────────────────────────────────────────────────────────────

	addDocument(bigChunkId: number, text: string): void {
		const terms = this.tokenizer.tokenize(text, 'index');
		const dl = terms.length;

		// Remove existing doc if re-indexing
		if (this.docLengths.has(bigChunkId)) {
			this.removeDocument(bigChunkId);
		}

		this.docLengths.set(bigChunkId, dl);
		this.totalDocLen += dl;
		this._docCount++;
		this.avgBigChunkLen = this.totalDocLen / this._docCount;

		// Count term frequencies and collect positions
		const tfMap = new Map<string, { tf: number; positions: number[] }>();
		for (let pos = 0; pos < terms.length; pos++) {
			const t = terms[pos];
			const entry = tfMap.get(t);
			if (entry) {
				entry.tf++;
				entry.positions.push(pos);
			} else {
				tfMap.set(t, { tf: 1, positions: [pos] });
			}
		}

		for (const [term, { tf, positions }] of tfMap) {
			let termEntry = this.termDict.get(term);
			if (!termEntry) {
				termEntry = { termId: this.nextTermId++, df: 0 };
				this.termDict.set(term, termEntry);
			}
			termEntry.df++;

			const tfNorm = this.computeTfNorm(tf, dl);
			const deltaPositions = encodeDelta(positions);

			const posting: BM25PostingEntry = { docId: bigChunkId, tfNorm, positions: deltaPositions };
			let list = this.postings.get(termEntry.termId);
			if (!list) {
				list = { entries: [] };
				this.postings.set(termEntry.termId, list);
			}
			// Insert sorted by docId
			const idx = lowerBound(list.entries, bigChunkId);
			list.entries.splice(idx, 0, posting);
		}
	}

	removeDocument(bigChunkId: number): void {
		const dl = this.docLengths.get(bigChunkId);
		if (dl === undefined) return;

		this.docLengths.delete(bigChunkId);
		this.totalDocLen -= dl;
		this._docCount--;
		if (this._docCount > 0) this.avgBigChunkLen = this.totalDocLen / this._docCount;

		// Remove from all posting lists
		for (const [, list] of this.postings) {
			const idx = list.entries.findIndex(e => e.docId === bigChunkId);
			if (idx !== -1) list.entries.splice(idx, 1);
		}

		// Decrement df for affected terms
		for (const [term, termEntry] of this.termDict) {
			const list = this.postings.get(termEntry.termId);
			if (!list || list.entries.length === 0) {
				this.termDict.delete(term);
				this.postings.delete(termEntry.termId);
			} else {
				// df was already decremented by the splice above — recount
				termEntry.df = list.entries.length;
			}
		}
	}

	// ─── Search ───────────────────────────────────────────────────────────────

	search(query: string, topK = 20): BM25SearchResult[] {
		const terms = this.tokenizer.tokenize(query, 'search');
		if (terms.length === 0 || this._docCount === 0) return [];

		const scores = new Map<number, number>();
		const N = this._docCount;

		// Collect per-doc positions for proximity scoring
		const docPositions = new Map<number, Map<string, number[]>>(); // docId → term → positions

		for (const term of terms) {
			const termEntry = this.termDict.get(term);
			if (!termEntry) continue;

			const list = this.postings.get(termEntry.termId);
			if (!list) continue;

			const { df } = termEntry;
			const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

			for (const entry of list.entries) {
				const prev = scores.get(entry.docId) ?? 0;
				scores.set(entry.docId, prev + entry.tfNorm * idf);

				// Collect positions for proximity
				if (terms.length > 1) {
					let termPos = docPositions.get(entry.docId);
					if (!termPos) { termPos = new Map(); docPositions.set(entry.docId, termPos); }
					termPos.set(term, decodeDelta(entry.positions));
				}
			}
		}

		// Proximity bonus: minimum span covering all query terms
		if (terms.length > 1) {
			for (const [docId, termPos] of docPositions) {
				if (termPos.size < 2) continue;
				const span = minSpan(termPos, terms);
				if (span < Infinity) {
					const bonus = 200 / (span + 1);
					scores.set(docId, (scores.get(docId) ?? 0) + bonus);
				}
			}
		}

		// Sort and return top-K
		const sorted = Array.from(scores.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, topK);

		return sorted.map(([bigChunkId, score]) => ({ bigChunkId, score }));
	}

	// ─── Serialization ────────────────────────────────────────────────────────

	serialize(): BM25Index {
		const termDictObj: BM25Index['termDict'] = {};
		for (const [term, entry] of this.termDict) {
			termDictObj[term] = { termId: entry.termId, df: entry.df };
		}
		const postingsObj: BM25Index['postings'] = {};
		for (const [termId, list] of this.postings) {
			postingsObj[termId] = list;
		}
		const docLengthsObj: BM25Index['docLengths'] = {};
		for (const [id, len] of this.docLengths) {
			docLengthsObj[id] = len;
		}
		return {
			termDict: termDictObj,
			postings: postingsObj,
			docCount: this._docCount,
			avgBigChunkLen: this.avgBigChunkLen,
			docLengths: docLengthsObj,
		};
	}

	deserialize(data: BM25Index): void {
		this.clear();

		for (const [term, entry] of Object.entries(data.termDict)) {
			this.termDict.set(term, { termId: entry.termId, df: entry.df });
		}
		for (const [termIdStr, list] of Object.entries(data.postings)) {
			this.postings.set(Number(termIdStr), list as PostingList);
		}
		for (const [idStr, len] of Object.entries(data.docLengths)) {
			this.docLengths.set(Number(idStr), len as number);
		}
		this._docCount = data.docCount;
		this.avgBigChunkLen = data.avgBigChunkLen;
		this.totalDocLen = data.avgBigChunkLen * data.docCount;
		this.nextTermId = Math.max(0, ...Array.from(this.termDict.values()).map(e => e.termId)) + 1;
	}

	// ─── Private helpers ──────────────────────────────────────────────────────

	private computeTfNorm(tf: number, dl: number): number {
		const avgdl = this.avgBigChunkLen || 1;
		return (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgdl)));
	}
}

// ─── Utility functions ────────────────────────────────────────────────────────

function encodeDelta(positions: number[]): number[] {
	const out: number[] = [];
	let prev = 0;
	for (const p of positions) {
		out.push(p - prev);
		prev = p;
	}
	return out;
}

function decodeDelta(deltas: number[]): number[] {
	const out: number[] = [];
	let acc = 0;
	for (const d of deltas) {
		acc += d;
		out.push(acc);
	}
	return out;
}

/** Binary search: index of first entry with docId >= target. */
function lowerBound(entries: BM25PostingEntry[], target: number): number {
	let lo = 0, hi = entries.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (entries[mid].docId < target) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/**
 * Find the minimum window span that covers at least one occurrence of each query term.
 * Uses a sliding-window approach over merged sorted positions.
 */
function minSpan(termPos: Map<string, number[]>, terms: string[]): number {
	// Merge all positions with term index
	const events: Array<{ pos: number; termIdx: number }> = [];
	const termList = terms.filter(t => termPos.has(t));
	for (let ti = 0; ti < termList.length; ti++) {
		for (const pos of termPos.get(termList[ti])!) {
			events.push({ pos, termIdx: ti });
		}
	}
	events.sort((a, b) => a.pos - b.pos);

	const needed = termList.length;
	const counts = new Array<number>(needed).fill(0);
	let have = 0;
	let left = 0;
	let minS = Infinity;

	for (let right = 0; right < events.length; right++) {
		const { termIdx } = events[right];
		if (counts[termIdx] === 0) have++;
		counts[termIdx]++;

		while (have === needed) {
			const span = events[right].pos - events[left].pos;
			if (span < minS) minS = span;
			const lt = events[left].termIdx;
			counts[lt]--;
			if (counts[lt] === 0) have--;
			left++;
		}
	}
	return minS;
}
