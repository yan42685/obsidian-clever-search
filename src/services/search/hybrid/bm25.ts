import { Tokenizer } from 'src/services/search/tokenizer';
import { getInstance } from 'src/utils/my-lib';
import {
	BM25_B,
	BM25_K1,
	type BM25Index,
	type BM25PostingEntry,
	type PostingList,
} from './hybrid-types';

type BM25SearchResult = { docId: number; score: number };

const BM25_POSITION_BUCKET_SIZE = 4;
const BM25_MAX_POSITIONS_PER_TERM = 8;
const BM25_PROXIMITY_MAX_SCORE_RATIO = 0.22;
const BM25_PROXIMITY_SPAN_WEIGHT = 0.11;
const BM25_PROXIMITY_ORDER_WEIGHT = 0.05;
const BM25_PROXIMITY_ADJACENT_WEIGHT = 0.04;
const BM25_PROXIMITY_COMPACT_WEIGHT = 0.02;

export class BM25Engine {
	private readonly tokenizer = getInstance(Tokenizer);

	private termDict = new Map<string, { termId: number; df: number }>();
	private postings = new Map<number, PostingList>();
	private nextTermId = 0;
	private _docCount = 0;
	private avgDocLen = 0;
	private docLengths = new Map<number, number>();
	private totalDocLen = 0;

	get docCount(): number { return this._docCount; }

	clear(): void {
		this.termDict.clear();
		this.postings.clear();
		this.docLengths.clear();
		this.nextTermId = 0;
		this._docCount = 0;
		this.avgDocLen = 0;
		this.totalDocLen = 0;
	}

	addDocument(docId: number, text: string): void {
		const terms = this.tokenizer.tokenizeSequence(text, 'index');
		const dl = terms.length;

		if (this.docLengths.has(docId)) {
			this.removeDocument(docId);
		}

		this.docLengths.set(docId, dl);
		this.totalDocLen += dl;
		this._docCount++;
		this.avgDocLen = this.totalDocLen / this._docCount;

		const tfMap = new Map<string, { tf: number; positions: number[] }>();
		for (let pos = 0; pos < terms.length; pos++) {
			const term = terms[pos];
			const bucketPos = Math.floor(pos / BM25_POSITION_BUCKET_SIZE);
			const entry = tfMap.get(term);
			if (entry) {
				entry.tf++;
				if (
					entry.positions.length < BM25_MAX_POSITIONS_PER_TERM &&
					entry.positions[entry.positions.length - 1] !== bucketPos
				) {
					entry.positions.push(bucketPos);
				}
			} else {
				tfMap.set(term, { tf: 1, positions: [bucketPos] });
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
			const posting: BM25PostingEntry = {
				docId,
				tfNorm,
				positions: encodeDelta(positions),
			};

			let list = this.postings.get(termEntry.termId);
			if (!list) {
				list = { entries: [] };
				this.postings.set(termEntry.termId, list);
			}
			const idx = lowerBound(list.entries, docId);
			list.entries.splice(idx, 0, posting);
		}
	}

	removeDocument(docId: number): void {
		const dl = this.docLengths.get(docId);
		if (dl === undefined) return;

		this.docLengths.delete(docId);
		this.totalDocLen -= dl;
		this._docCount--;
		this.avgDocLen = this._docCount > 0 ? this.totalDocLen / this._docCount : 0;

		for (const [, list] of this.postings) {
			const idx = list.entries.findIndex((entry) => entry.docId === docId);
			if (idx !== -1) {
				list.entries.splice(idx, 1);
			}
		}

		for (const [term, termEntry] of this.termDict) {
			const list = this.postings.get(termEntry.termId);
			if (!list || list.entries.length === 0) {
				this.termDict.delete(term);
				this.postings.delete(termEntry.termId);
			} else {
				termEntry.df = list.entries.length;
			}
		}
	}

	search(query: string, topK = 20): BM25SearchResult[] {
		const terms = this.tokenizer.tokenize(query, 'search');
		if (terms.length === 0 || this._docCount === 0) return [];
		const orderedTerms = uniqueTermsInOrder(terms);

		const scores = new Map<number, number>();
		const docPositions = new Map<number, Map<string, number[]>>();
		const N = this._docCount;

		for (const term of terms) {
			const termEntry = this.termDict.get(term);
			if (!termEntry) continue;

			const list = this.postings.get(termEntry.termId);
			if (!list) continue;

			const idf = Math.log((N - termEntry.df + 0.5) / (termEntry.df + 0.5) + 1);
			for (const entry of list.entries) {
				scores.set(entry.docId, (scores.get(entry.docId) ?? 0) + entry.tfNorm * idf);
				if (orderedTerms.length > 1) {
					let termPos = docPositions.get(entry.docId);
					if (!termPos) {
						termPos = new Map();
						docPositions.set(entry.docId, termPos);
					}
					termPos.set(term, decodeDelta(entry.positions));
				}
			}
		}

		if (orderedTerms.length > 1) {
			for (const [docId, termPos] of docPositions) {
				if (termPos.size < 2) continue;
				const baseScore = scores.get(docId) ?? 0;
				if (baseScore <= 0) continue;
				const proximityBonus = computeProximityBonus(
					termPos,
					orderedTerms,
					baseScore,
				);
				if (proximityBonus > 0) {
					scores.set(docId, baseScore + proximityBonus);
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
			avgDocLen: this.avgDocLen,
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
		this.avgDocLen = data.avgDocLen;
		this.totalDocLen = data.avgDocLen * data.docCount;
		this.nextTermId = Math.max(0, ...Array.from(this.termDict.values()).map((entry) => entry.termId)) + 1;
	}

	private computeTfNorm(tf: number, dl: number): number {
		const avgdl = this.avgDocLen || 1;
		return (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgdl)));
	}
}

function computeProximityBonus(
	termPos: Map<string, number[]>,
	terms: string[],
	baseScore: number,
): number {
	const span = minSpan(termPos, terms);
	if (span === Infinity) {
		return 0;
	}

	const approxTokenSpan = span * BM25_POSITION_BUCKET_SIZE;
	const spanSignal = 1 / (approxTokenSpan + 1);
	const orderedSignal = computeOrderedPairSignal(termPos, terms);
	const adjacentSignal = computeAdjacentPairSignal(termPos, terms);
	const compactSignal =
		approxTokenSpan <= Math.max(BM25_POSITION_BUCKET_SIZE, terms.length * BM25_POSITION_BUCKET_SIZE)
			? 1
			: 0;

	const proximityRatio = Math.min(
		BM25_PROXIMITY_MAX_SCORE_RATIO,
		spanSignal * BM25_PROXIMITY_SPAN_WEIGHT +
			orderedSignal * BM25_PROXIMITY_ORDER_WEIGHT +
			adjacentSignal * BM25_PROXIMITY_ADJACENT_WEIGHT +
			compactSignal * BM25_PROXIMITY_COMPACT_WEIGHT,
	);

	return baseScore * proximityRatio;
}

function encodeDelta(positions: number[]): number[] {
	const out: number[] = [];
	let prev = 0;
	for (const pos of positions) {
		out.push(pos - prev);
		prev = pos;
	}
	return out;
}

function decodeDelta(deltas: number[]): number[] {
	const out: number[] = [];
	let acc = 0;
	for (const delta of deltas) {
		acc += delta;
		out.push(acc);
	}
	return out;
}

function lowerBound(entries: BM25PostingEntry[], target: number): number {
	let lo = 0;
	let hi = entries.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (entries[mid].docId < target) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

function minSpan(termPos: Map<string, number[]>, terms: string[]): number {
	const events: Array<{ pos: number; termIdx: number }> = [];
	const termList = terms.filter((term) => termPos.has(term));
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
			const leftTermIdx = events[left].termIdx;
			counts[leftTermIdx]--;
			if (counts[leftTermIdx] === 0) have--;
			left++;
		}
	}
	return minS;
}

function computeOrderedPairSignal(
	termPos: Map<string, number[]>,
	terms: string[],
): number {
	if (terms.length < 2) {
		return 0;
	}

	let matchedPairs = 0;
	let totalScore = 0;
	for (let i = 0; i < terms.length - 1; i++) {
		const left = termPos.get(terms[i]);
		const right = termPos.get(terms[i + 1]);
		if (!left || !right) {
			continue;
		}
		const gap = minOrderedGap(left, right);
		if (gap === Infinity) {
			continue;
		}
		matchedPairs++;
		const approxTokenGap = gap * BM25_POSITION_BUCKET_SIZE;
		totalScore += 1 / (approxTokenGap + 1);
	}

	if (matchedPairs === 0) {
		return 0;
	}
	return totalScore / Math.max(1, terms.length - 1);
}

function computeAdjacentPairSignal(
	termPos: Map<string, number[]>,
	terms: string[],
): number {
	if (terms.length < 2) {
		return 0;
	}

	let tightPairs = 0;
	for (let i = 0; i < terms.length - 1; i++) {
		const left = termPos.get(terms[i]);
		const right = termPos.get(terms[i + 1]);
		if (!left || !right) {
			continue;
		}
		const gap = minOrderedGap(left, right);
		if (gap <= 1) {
			tightPairs++;
		}
	}

	return tightPairs / Math.max(1, terms.length - 1);
}

function minOrderedGap(left: number[], right: number[]): number {
	let minGap = Infinity;
	let j = 0;
	for (const leftPos of left) {
		while (j < right.length && right[j] < leftPos) {
			j++;
		}
		for (let k = j; k < right.length; k++) {
			if (right[k] < leftPos) {
				continue;
			}
			minGap = Math.min(minGap, right[k] - leftPos);
			break;
		}
	}
	return minGap;
}

function uniqueTermsInOrder(terms: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const term of terms) {
		if (seen.has(term)) {
			continue;
		}
		seen.add(term);
		out.push(term);
	}
	return out;
}
