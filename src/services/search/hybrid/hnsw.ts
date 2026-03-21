import {
	HNSW_EF,
	HNSW_EF_CONSTRUCTION,
	HNSW_M,
	type HnswGraph,
	type HnswGraphData,
	type HnswNode,
	type StoredVector,
	type VectorPrecision,
} from './hybrid-types';
import type { ChunkVectorRecord } from './hybrid-store';

const ML = 1 / Math.log(HNSW_M); // level multiplier

type Candidate = { id: number; dist: number };

function int8CosineSim(
	a: Int8Array,
	scaleA: number,
	b: Int8Array,
	scaleB: number,
): number {
	let dot = 0;
	for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
	return dot / (scaleA * scaleB * 127 * 127);
}

function int8Dist(
	a: Int8Array,
	scaleA: number,
	b: Int8Array,
	scaleB: number,
): number {
	return 1 - int8CosineSim(a, scaleA, b, scaleB);
}

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
	return dot; // vectors are already normalized
}

function f16Dist(a: Uint16Array, b: Uint16Array): number {
	return 1 - f16CosineSim(a, b);
}

class MinHeap {
	private data: Candidate[] = [];

	get size() { return this.data.length; }

	push(c: Candidate): void {
		this.data.push(c);
		this.bubbleUp(this.data.length - 1);
	}

	pop(): Candidate {
		const top = this.data[0];
		const last = this.data.pop()!;
		if (this.data.length > 0) {
			this.data[0] = last;
			this.siftDown(0);
		}
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
			const l = 2 * i + 1;
			const r = 2 * i + 2;
			if (l < n && this.data[l].dist < this.data[smallest].dist) smallest = l;
			if (r < n && this.data[r].dist < this.data[smallest].dist) smallest = r;
			if (smallest === i) break;
			[this.data[smallest], this.data[i]] = [this.data[i], this.data[smallest]];
			i = smallest;
		}
	}
}

export class HnswIndex {
	private graph: HnswGraph = this.createEmptyGraph('int8');
	private readonly vectorsInt8 = new Map<number, Int8Array>();
	private readonly scalesInt8 = new Map<number, number>();
	private readonly vectorsFloat16 = new Map<number, Uint16Array>();

	constructor(precision: VectorPrecision = 'int8') {
		this.graph = this.createEmptyGraph(precision);
	}

	private createEmptyGraph(precision: VectorPrecision): HnswGraph {
		return {
			entryPoint: null,
			maxLevel: 0,
			precision,
			nodes: new Map(),
			deletedSet: new Set(),
		};
	}

	get precision(): VectorPrecision {
		return this.graph.precision;
	}

	setPrecision(precision: VectorPrecision): void {
		this.clear(precision);
	}

	clear(precision: VectorPrecision = this.graph.precision): void {
		this.graph = this.createEmptyGraph(precision);
		this.vectorsInt8.clear();
		this.scalesInt8.clear();
		this.vectorsFloat16.clear();
	}

	insert(id: number, vector: StoredVector): void {
		this.ensurePrecision(vector.precision);
		this.storeVector(id, vector);

		const level = this.randomLevel();
		const node: HnswNode = {
			id,
			level,
			neighbors: Array.from({ length: level + 1 }, () => []),
		};

		this.graph.nodes.set(id, node);

		if (this.graph.entryPoint === null) {
			this.graph.entryPoint = id;
			this.graph.maxLevel = level;
			return;
		}

		let ep = this.graph.entryPoint;
		const epLevel = this.graph.nodes.get(ep)!.level;

		for (let lc = epLevel; lc > level; lc--) {
			ep = this.greedySearch(vector, ep, lc);
		}

		for (let lc = Math.min(level, epLevel); lc >= 0; lc--) {
			const candidates = this.searchLayer(vector, ep, HNSW_EF_CONSTRUCTION, lc);
			const neighbors = this.selectNeighbors(id, candidates, HNSW_M);
			node.neighbors[lc] = neighbors.map((c) => c.id);

			for (const nb of neighbors) {
				const nbNode = this.graph.nodes.get(nb.id)!;
				if (!nbNode.neighbors[lc]) nbNode.neighbors[lc] = [];
				nbNode.neighbors[lc].push(id);
				nbNode.neighbors[lc] = this.pruneNeighbors(nb.id, nbNode.neighbors[lc], HNSW_M);
			}

			ep = candidates[0]?.id ?? ep;
		}

		if (level > this.graph.maxLevel) {
			this.graph.maxLevel = level;
			this.graph.entryPoint = id;
		}
	}

	search(
		queryVector: StoredVector,
		topK: number,
		ef = HNSW_EF,
	): Array<{ id: number; score: number }> {
		if (this.graph.entryPoint === null || topK <= 0) return [];
		this.ensurePrecision(queryVector.precision);

		let ep = this.graph.entryPoint;
		const epLevel = this.graph.nodes.get(ep)!.level;

		for (let lc = epLevel; lc > 0; lc--) {
			ep = this.greedySearch(queryVector, ep, lc);
		}

		const candidates = this.searchLayer(queryVector, ep, ef, 0);
		return candidates
			.filter((candidate) => !this.graph.deletedSet.has(candidate.id))
			.slice(0, topK)
			.map((candidate) => ({ id: candidate.id, score: 1 - candidate.dist }));
	}

	delete(id: number): void {
		this.graph.deletedSet.add(id);
		this.deleteVector(id);
	}

	needsRebuild(): boolean {
		return this.graph.deletedSet.size > this.graph.nodes.size * 0.2;
	}

	isNonEmpty(): boolean {
		return this.graph.nodes.size > this.graph.deletedSet.size;
	}

	hasVectors(): boolean {
		return this.graph.precision === 'int8'
			? this.vectorsInt8.size > 0
			: this.vectorsFloat16.size > 0;
	}

	hasDeletedNodes(): boolean {
		return this.graph.deletedSet.size > 0;
	}

	hydrateVectors(
		records: ChunkVectorRecord[],
		option: { append?: boolean } = {},
	): void {
		if (!(option.append ?? false)) {
			this.vectorsInt8.clear();
			this.scalesInt8.clear();
			this.vectorsFloat16.clear();
		}

		for (const record of records) {
			if (!this.graph.nodes.has(record.id) || this.graph.deletedSet.has(record.id)) {
				continue;
			}
			if (record.vector.precision !== this.graph.precision) {
				continue;
			}
			this.storeVector(record.id, record.vector);
		}
	}

	rebuild(): void {
		const precision = this.graph.precision;
		const toKeep = Array.from(this.graph.nodes.keys()).filter(
			(id) => !this.graph.deletedSet.has(id),
		);
		const vectors = toKeep
			.map((id) => {
				const vector = this.getStoredVector(id);
				if (!vector) return null;
				return { id, vector };
			})
			.filter((item): item is { id: number; vector: StoredVector } => item !== null);

		this.clear(precision);
		for (const item of vectors) {
			this.insert(item.id, item.vector);
		}
	}

	serialize(): HnswGraphData {
		return {
			entryPoint: this.graph.entryPoint,
			maxLevel: this.graph.maxLevel,
			precision: this.graph.precision,
			nodes: Array.from(this.graph.nodes.entries()),
			deletedSet: Array.from(this.graph.deletedSet),
		};
	}

	deserialize(data: HnswGraphData): void {
		this.clear(data.precision);
		this.graph.entryPoint = data.entryPoint;
		this.graph.maxLevel = data.maxLevel;
		this.graph.nodes = new Map(data.nodes);
		this.graph.deletedSet = new Set(data.deletedSet);
	}

	private ensurePrecision(precision: VectorPrecision): void {
		if (precision !== this.graph.precision) {
			throw new Error(
				`Vector precision mismatch: graph=${this.graph.precision}, input=${precision}`,
			);
		}
	}

	private storeVector(id: number, vector: StoredVector): void {
		if (vector.precision === 'int8') {
			this.vectorsInt8.set(id, vector.vector);
			this.scalesInt8.set(id, vector.scale);
			this.vectorsFloat16.delete(id);
			return;
		}

		this.vectorsFloat16.set(id, vector.vector);
		this.vectorsInt8.delete(id);
		this.scalesInt8.delete(id);
	}

	private deleteVector(id: number): void {
		this.vectorsInt8.delete(id);
		this.scalesInt8.delete(id);
		this.vectorsFloat16.delete(id);
	}

	private getStoredVector(id: number): StoredVector | null {
		if (this.graph.precision === 'int8') {
			const vector = this.vectorsInt8.get(id);
			const scale = this.scalesInt8.get(id);
			if (!vector || scale === undefined) return null;
			return { precision: 'int8', vector, scale };
		}

		const vector = this.vectorsFloat16.get(id);
		if (!vector) return null;
		return { precision: 'float16', vector };
	}

	private randomLevel(): number {
		let level = 0;
		while (Math.random() < 1 / HNSW_M && level < 16) level++;
		return level;
	}

	private greedySearch(queryVector: StoredVector, ep: number, layer: number): number {
		let best = ep;
		let bestDist = this.dist(queryVector, ep);
		let changed = true;
		while (changed) {
			changed = false;
			const node = this.graph.nodes.get(best);
			if (!node || !node.neighbors[layer]) break;
			for (const nb of node.neighbors[layer]) {
				if (this.graph.deletedSet.has(nb)) continue;
				const dist = this.dist(queryVector, nb);
				if (dist < bestDist) {
					bestDist = dist;
					best = nb;
					changed = true;
				}
			}
		}
		return best;
	}

	private searchLayer(
		queryVector: StoredVector,
		ep: number,
		ef: number,
		layer: number,
	): Candidate[] {
		const visited = new Set<number>([ep]);
		const candidates = new MinHeap();
		const results: Candidate[] = [];

		const epDist = this.dist(queryVector, ep);
		candidates.push({ id: ep, dist: epDist });
		results.push({ id: ep, dist: epDist });

		while (candidates.size > 0) {
			const curr = candidates.pop();
			const worstResult = results.reduce(
				(worst, result) => (result.dist > worst.dist ? result : worst),
				results[0],
			);

			if (curr.dist > worstResult.dist && results.length >= ef) break;

			const node = this.graph.nodes.get(curr.id);
			if (!node || !node.neighbors[layer]) continue;

			for (const nb of node.neighbors[layer]) {
				if (visited.has(nb)) continue;
				visited.add(nb);
				const dist = this.dist(queryVector, nb);
				if (results.length < ef || dist < worstResult.dist) {
					candidates.push({ id: nb, dist });
					results.push({ id: nb, dist });
					if (results.length > ef) {
						const worstIdx = results.reduce(
							(worstIdxInner, result, index) =>
								result.dist > results[worstIdxInner].dist ? index : worstIdxInner,
							0,
						);
						results.splice(worstIdx, 1);
					}
				}
			}
		}

		results.sort((a, b) => a.dist - b.dist);
		return results;
	}

	private selectNeighbors(nodeId: number, candidates: Candidate[], m: number): Candidate[] {
		const deduped: Candidate[] = [];
		const seen = new Set<number>();
		for (const candidate of candidates) {
			if (candidate.id === nodeId || seen.has(candidate.id) || this.graph.deletedSet.has(candidate.id)) {
				continue;
			}
			seen.add(candidate.id);
			deduped.push(candidate);
		}

		const selected: Candidate[] = [];
		for (const candidate of deduped) {
			let keep = true;
			for (const existing of selected) {
				const pairDist = this.distBetweenNodes(candidate.id, existing.id);
				if (pairDist < candidate.dist) {
					keep = false;
					break;
				}
			}
			if (!keep) {
				continue;
			}
			selected.push(candidate);
			if (selected.length >= m) {
				return selected;
			}
		}

		for (const candidate of deduped) {
			if (selected.some((item) => item.id === candidate.id)) {
				continue;
			}
			selected.push(candidate);
			if (selected.length >= m) {
				break;
			}
		}

		return selected;
	}

	private pruneNeighbors(nodeId: number, neighborIds: number[], m: number): number[] {
		const candidates = Array.from(new Set(neighborIds))
			.filter((neighborId) => neighborId !== nodeId && !this.graph.deletedSet.has(neighborId))
			.map((neighborId) => ({
				id: neighborId,
				dist: this.distBetweenNodes(nodeId, neighborId),
			}))
			.filter((item) => Number.isFinite(item.dist))
			.sort((left, right) => left.dist - right.dist || left.id - right.id);

		return this.selectNeighbors(nodeId, candidates, m).map((item) => item.id);
	}

	private distBetweenNodes(leftId: number, rightId: number): number {
		if (this.graph.precision === 'int8') {
			const leftVector = this.vectorsInt8.get(leftId);
			const leftScale = this.scalesInt8.get(leftId);
			const rightVector = this.vectorsInt8.get(rightId);
			const rightScale = this.scalesInt8.get(rightId);
			if (!leftVector || leftScale === undefined || !rightVector || rightScale === undefined) {
				return Infinity;
			}
			return int8Dist(leftVector, leftScale, rightVector, rightScale);
		}

		const leftVector = this.vectorsFloat16.get(leftId);
		const rightVector = this.vectorsFloat16.get(rightId);
		if (!leftVector || !rightVector) {
			return Infinity;
		}
		return f16Dist(leftVector, rightVector);
	}

	private dist(queryVector: StoredVector, id: number): number {
		if (this.graph.precision === 'int8') {
			if (queryVector.precision !== 'int8') return Infinity;
			const vector = this.vectorsInt8.get(id);
			const scale = this.scalesInt8.get(id);
			if (!vector || scale === undefined) return Infinity;
			return int8Dist(queryVector.vector, queryVector.scale, vector, scale);
		}

		if (queryVector.precision !== 'float16') return Infinity;
		const vector = this.vectorsFloat16.get(id);
		if (!vector) return Infinity;
		return f16Dist(queryVector.vector, vector);
	}
}
