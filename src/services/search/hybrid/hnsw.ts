import {
	HNSW_EF,
	HNSW_EF_CONSTRUCTION,
	HNSW_M,
	type HnswGraph,
	type HnswGraphData,
	type HnswNode,
	type VectorPrecision,
} from './hybrid-types';

const ML = 1 / Math.log(HNSW_M); // level multiplier

type Candidate = { id: number; dist: number };

// ─── Distance ─────────────────────────────────────────────────────────────────

/**
 * Approximate cosine similarity via int8 dot product.
 * sim = dot(a, b) / (scaleA * scaleB * 127²)
 * Returns value in [-1, 1]; higher = more similar.
 */
function int8CosineSim(
	a: Int8Array, scaleA: number,
	b: Int8Array, scaleB: number,
): number {
	let dot = 0;
	for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
	return dot / (scaleA * scaleB * 127 * 127);
}

/** Distance = 1 - similarity (for min-heap logic). */
function int8Dist(a: Int8Array, scaleA: number, b: Int8Array, scaleB: number): number {
	return 1 - int8CosineSim(a, scaleA, b, scaleB);
}

// float16 dequantize for rescoring
function float16ToFloat32(h: number): number {
	const sign = (h >>> 15) ? -1 : 1;
	const exp = (h >>> 10) & 0x1f;
	const frac = h & 0x3ff;
	if (exp === 0) return sign * Math.pow(2, -14) * (frac / 1024);
	if (exp === 31) return frac ? NaN : sign * Infinity;
	return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
}

function f16CosineSim(a: Uint16Array, b: Uint16Array): number {
	let dot = 0;
	for (let i = 0; i < a.length; i++) {
		dot += float16ToFloat32(a[i]) * float16ToFloat32(b[i]);
	}
	return dot; // vectors are already L2-normalized
}

// ─── Min-heap ─────────────────────────────────────────────────────────────────

class MinHeap {
	private data: Candidate[] = [];

	get size() { return this.data.length; }
	peek(): Candidate { return this.data[0]; }

	push(c: Candidate): void {
		this.data.push(c);
		this.bubbleUp(this.data.length - 1);
	}

	pop(): Candidate {
		const top = this.data[0];
		const last = this.data.pop()!;
		if (this.data.length > 0) { this.data[0] = last; this.siftDown(0); }
		return top;
	}

	private bubbleUp(i: number): void {
		while (i > 0) {
			const p = (i - 1) >> 1;
			if (this.data[p].dist <= this.data[i].dist) break;
			[this.data[p], this.data[i]] = [this.data[i], this.data[p]];
			i = p;
		}
	}

	private siftDown(i: number): void {
		const n = this.data.length;
		while (true) {
			let smallest = i;
			const l = 2 * i + 1, r = 2 * i + 2;
			if (l < n && this.data[l].dist < this.data[smallest].dist) smallest = l;
			if (r < n && this.data[r].dist < this.data[smallest].dist) smallest = r;
			if (smallest === i) break;
			[this.data[smallest], this.data[i]] = [this.data[i], this.data[smallest]];
			i = smallest;
		}
	}
}

// ─── HNSW ─────────────────────────────────────────────────────────────────────

export class HnswIndex {
	private graph: HnswGraph = {
		entryPoint: null,
		maxLevel: 0,
		nodes: new Map(),
		vectors: new Map(),
		scales: new Map(),
		deletedSet: new Set(),
	};

	clear(): void {
		this.graph = {
			entryPoint: null,
			maxLevel: 0,
			nodes: new Map(),
			vectors: new Map(),
			scales: new Map(),
			deletedSet: new Set(),
		};
	}

	// ─── Insert ───────────────────────────────────────────────────────────────

	insert(id: number, vec: Int8Array, scale: number, vecF16?: Uint16Array): void {
		const level = this.randomLevel();
		const node: HnswNode = { id, level, neighbors: Array.from({ length: level + 1 }, () => []) };

		this.graph.nodes.set(id, node);
		this.graph.vectors.set(id, vec);
		this.graph.scales.set(id, scale);
		if (vecF16) {
			if (!this.graph.vectorsF16) this.graph.vectorsF16 = new Map();
			this.graph.vectorsF16.set(id, vecF16);
		}

		if (this.graph.entryPoint === null) {
			this.graph.entryPoint = id;
			this.graph.maxLevel = level;
			return;
		}

		let ep = this.graph.entryPoint;
		const epLevel = this.graph.nodes.get(ep)!.level;

		// Greedy descent from top level to level+1
		for (let lc = epLevel; lc > level; lc--) {
			ep = this.greedySearch(vec, scale, ep, lc);
		}

		// Insert at each level from min(level, epLevel) down to 0
		for (let lc = Math.min(level, epLevel); lc >= 0; lc--) {
			const candidates = this.searchLayer(vec, scale, ep, HNSW_EF_CONSTRUCTION, lc);
			const neighbors = this.selectNeighbors(candidates, HNSW_M);
			node.neighbors[lc] = neighbors.map(c => c.id);

			// Add back-links
			for (const nb of neighbors) {
				const nbNode = this.graph.nodes.get(nb.id)!;
				if (!nbNode.neighbors[lc]) nbNode.neighbors[lc] = [];
				nbNode.neighbors[lc].push(id);
				// Prune if over M
				if (nbNode.neighbors[lc].length > HNSW_M) {
					nbNode.neighbors[lc] = this.pruneNeighbors(nbNode.neighbors[lc], vec, scale, HNSW_M);
				}
			}

			ep = candidates[0]?.id ?? ep;
		}

		if (level > this.graph.maxLevel) {
			this.graph.maxLevel = level;
			this.graph.entryPoint = id;
		}
	}

	// ─── Search ───────────────────────────────────────────────────────────────

	search(
		queryVec: Int8Array,
		queryScale: number,
		topK: number,
		ef = HNSW_EF,
		precision: VectorPrecision = 'int8',
		queryVecF16?: Uint16Array,
	): Array<{ id: number; score: number }> {
		if (this.graph.entryPoint === null) return [];

		let ep = this.graph.entryPoint;
		const epLevel = this.graph.nodes.get(ep)!.level;

		for (let lc = epLevel; lc > 0; lc--) {
			ep = this.greedySearch(queryVec, queryScale, ep, lc);
		}

		const candidates = this.searchLayer(queryVec, queryScale, ep, ef, 0);
		const active = candidates.filter(c => !this.graph.deletedSet.has(c.id));
		const top = active.slice(0, topK);

		// float16 rescoring branch
		if (precision === 'float16' && queryVecF16 && this.graph.vectorsF16) {
			// Expand to top-50 then rescore
			const expanded = active.slice(0, Math.max(topK, 50));
			const rescored = expanded.map(c => {
				const f16 = this.graph.vectorsF16!.get(c.id);
				const score = f16 ? f16CosineSim(queryVecF16, f16) : 1 - c.dist;
				return { id: c.id, score };
			});
			rescored.sort((a, b) => b.score - a.score);
			return rescored.slice(0, topK);
		}

		return top.map(c => ({ id: c.id, score: 1 - c.dist }));
	}

	// ─── Delete (lazy) ────────────────────────────────────────────────────────

	delete(id: number): void {
		this.graph.deletedSet.add(id);
	}

	needsRebuild(): boolean {
		return this.graph.deletedSet.size > this.graph.nodes.size * 0.2;
	}

	isNonEmpty(): boolean {
		return this.graph.nodes.size > this.graph.deletedSet.size;
	}

	/** Rebuild graph without deleted nodes. */
	rebuild(): void {
		const toKeep = Array.from(this.graph.nodes.keys()).filter(
			id => !this.graph.deletedSet.has(id),
		);
		const vecs = new Map(toKeep.map(id => [id, this.graph.vectors.get(id)!]));
		const scales = new Map(toKeep.map(id => [id, this.graph.scales.get(id)!]));
		const vecsF16 = this.graph.vectorsF16
			? new Map(toKeep.filter(id => this.graph.vectorsF16!.has(id)).map(id => [id, this.graph.vectorsF16!.get(id)!]))
			: undefined;

		this.graph = {
			entryPoint: null,
			maxLevel: 0,
			nodes: new Map(),
			vectors: new Map(),
			scales: new Map(),
			vectorsF16: vecsF16,
			deletedSet: new Set(),
		};

		for (const id of toKeep) {
			this.insert(id, vecs.get(id)!, scales.get(id)!, vecsF16?.get(id));
		}
	}

	// ─── Serialization ────────────────────────────────────────────────────────

	serialize(): HnswGraphData {
		return {
			entryPoint: this.graph.entryPoint,
			maxLevel: this.graph.maxLevel,
			nodes: Array.from(this.graph.nodes.entries()),
			vectors: Array.from(this.graph.vectors.entries()).map(([id, v]) => [id, Array.from(v)]),
			scales: Array.from(this.graph.scales.entries()),
			vectorsF16: this.graph.vectorsF16
				? Array.from(this.graph.vectorsF16.entries()).map(([id, v]) => [id, Array.from(v)])
				: undefined,
			deletedSet: Array.from(this.graph.deletedSet),
		};
	}

	deserialize(data: HnswGraphData): void {
		this.clear();
		this.graph.entryPoint = data.entryPoint;
		this.graph.maxLevel = data.maxLevel;
		this.graph.nodes = new Map(data.nodes);
		this.graph.vectors = new Map(data.vectors.map(([id, arr]) => [id, new Int8Array(arr)]));
		this.graph.scales = new Map(data.scales);
		this.graph.vectorsF16 = data.vectorsF16
			? new Map(data.vectorsF16.map(([id, arr]) => [id, new Uint16Array(arr)]))
			: undefined;
		this.graph.deletedSet = new Set(data.deletedSet);
	}

	// ─── Private helpers ──────────────────────────────────────────────────────

	private randomLevel(): number {
		let level = 0;
		while (Math.random() < 1 / HNSW_M && level < 16) level++;
		return level;
	}

	private greedySearch(queryVec: Int8Array, queryScale: number, ep: number, layer: number): number {
		let best = ep;
		let bestDist = this.dist(queryVec, queryScale, ep);
		let changed = true;
		while (changed) {
			changed = false;
			const node = this.graph.nodes.get(best);
			if (!node || !node.neighbors[layer]) break;
			for (const nb of node.neighbors[layer]) {
				if (this.graph.deletedSet.has(nb)) continue;
				const d = this.dist(queryVec, queryScale, nb);
				if (d < bestDist) { bestDist = d; best = nb; changed = true; }
			}
		}
		return best;
	}

	private searchLayer(
		queryVec: Int8Array,
		queryScale: number,
		ep: number,
		ef: number,
		layer: number,
	): Candidate[] {
		const visited = new Set<number>([ep]);
		const candidates = new MinHeap();
		const results: Candidate[] = [];

		const epDist = this.dist(queryVec, queryScale, ep);
		candidates.push({ id: ep, dist: epDist });
		results.push({ id: ep, dist: epDist });

		while (candidates.size > 0) {
			const curr = candidates.pop();
			const worstResult = results.reduce((w, r) => r.dist > w.dist ? r : w, results[0]);

			if (curr.dist > worstResult.dist && results.length >= ef) break;

			const node = this.graph.nodes.get(curr.id);
			if (!node || !node.neighbors[layer]) continue;

			for (const nb of node.neighbors[layer]) {
				if (visited.has(nb)) continue;
				visited.add(nb);
				const d = this.dist(queryVec, queryScale, nb);
				if (results.length < ef || d < worstResult.dist) {
					candidates.push({ id: nb, dist: d });
					results.push({ id: nb, dist: d });
					if (results.length > ef) {
						// Remove worst
						const worstIdx = results.reduce((wi, r, i) => r.dist > results[wi].dist ? i : wi, 0);
						results.splice(worstIdx, 1);
					}
				}
			}
		}

		results.sort((a, b) => a.dist - b.dist);
		return results;
	}

	private selectNeighbors(candidates: Candidate[], m: number): Candidate[] {
		return candidates.slice(0, m);
	}

	private pruneNeighbors(
		neighborIds: number[],
		_queryVec: Int8Array,
		_queryScale: number,
		m: number,
	): number[] {
		return neighborIds.slice(0, m);
	}

	private dist(queryVec: Int8Array, queryScale: number, id: number): number {
		const vec = this.graph.vectors.get(id);
		const scale = this.graph.scales.get(id);
		if (!vec || scale === undefined) return Infinity;
		return int8Dist(queryVec, queryScale, vec, scale);
	}
}
