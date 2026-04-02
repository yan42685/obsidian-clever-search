type CoverageLexicalPackedPostingValue = number[] | Uint32Array;

type CoverageLexicalMutablePackedPostingMap = ReadonlyMap<
	string,
	CoverageLexicalPackedPostingValue
> & {
	set(term: string, docIds: CoverageLexicalPackedPostingValue): unknown;
	delete(term: string): boolean;
	clear(): void;
};

export class CoverageLexicalSharedTokenIdPostingMap
	implements CoverageLexicalMutablePackedPostingMap
{
	private postingStartsByTokenId = new Uint32Array(0);
	private postingLengthsByTokenId = new Uint32Array(0);
	private postingTape = new Uint32Array(0);
	private activeTermCount = 0;

	constructor(
		private readonly resolveTokenId: (term: string) => number | undefined,
		private readonly getOrCreateTokenId: (term: string) => number,
		private readonly resolveToken: (tokenId: number) => string | undefined,
	) {}

	get size(): number {
		return this.activeTermCount;
	}

	get slotCount(): number {
		return this.postingStartsByTokenId.length;
	}

	get postingCount(): number {
		return this.postingTape.length;
	}

	readonly [Symbol.toStringTag] = "CoverageLexicalSharedTokenIdPostingMap";

	clear(): void {
		this.postingStartsByTokenId = new Uint32Array(0);
		this.postingLengthsByTokenId = new Uint32Array(0);
		this.postingTape = new Uint32Array(0);
		this.activeTermCount = 0;
	}

	delete(term: string): boolean {
		const tokenId = this.resolveTokenId(term);
		if (
			tokenId === undefined ||
			this.postingLengthsByTokenId[tokenId] === undefined ||
			this.postingLengthsByTokenId[tokenId] === 0
		) {
			return false;
		}
		this.rebuildPostingTape(new Map([[tokenId, undefined]]));
		return true;
	}

	entries(): IterableIterator<[string, CoverageLexicalPackedPostingValue]> {
		return this.iterateEntries();
	}

	forEach(
		callbackfn: (
			value: CoverageLexicalPackedPostingValue,
			key: string,
			map: ReadonlyMap<string, CoverageLexicalPackedPostingValue>,
		) => void,
		thisArg?: unknown,
	): void {
		for (const [term, docIds] of this.entries()) {
			callbackfn.call(thisArg, docIds, term, this);
		}
	}

	get(term: string): CoverageLexicalPackedPostingValue | undefined {
		const tokenId = this.resolveTokenId(term);
		return tokenId === undefined ? undefined : this.readPostingAt(tokenId);
	}

	getTokenIdEntries(): IterableIterator<[number, Uint32Array]> {
		return this.iterateTokenIdEntries();
	}

	has(term: string): boolean {
		return this.get(term) !== undefined;
	}

	keys(): IterableIterator<string> {
		return this.iterateKeys();
	}

	remapTokenIds(
		tokenIdRemap: ReadonlyMap<number, number>,
		nextTokenCount: number,
	): void {
		const nextStartsByTokenId = new Uint32Array(nextTokenCount);
		const nextLengthsByTokenId = new Uint32Array(nextTokenCount);
		let activeTermCount = 0;
		for (const [tokenId] of this.iterateTokenIdEntries()) {
			const nextTokenId = tokenIdRemap.get(tokenId);
			if (nextTokenId === undefined) {
				continue;
			}
			nextStartsByTokenId[nextTokenId] = this.postingStartsByTokenId[tokenId];
			nextLengthsByTokenId[nextTokenId] = this.postingLengthsByTokenId[tokenId];
			activeTermCount += 1;
		}
		this.postingStartsByTokenId = nextStartsByTokenId;
		this.postingLengthsByTokenId = nextLengthsByTokenId;
		this.activeTermCount = activeTermCount;
	}

	replaceAll(
		postings: ReadonlyMap<string, readonly number[] | Uint32Array>,
	): void {
		const nextPostingsByTokenId = new Map<number, Uint32Array>();
		let nextTokenCount = 0;
		for (const [term, docIds] of postings.entries()) {
			const tokenId = this.getOrCreateTokenId(term);
			nextTokenCount = Math.max(nextTokenCount, tokenId + 1);
			nextPostingsByTokenId.set(
				tokenId,
				docIds instanceof Uint32Array ? docIds : new Uint32Array(docIds),
			);
		}
		this.rebuildPostingTape(nextPostingsByTokenId, nextTokenCount);
	}

	set(term: string, docIds: CoverageLexicalPackedPostingValue): this {
		const nextDocIds =
			docIds instanceof Uint32Array ? docIds : new Uint32Array(docIds);
		if (nextDocIds.length === 0) {
			const existingTokenId = this.resolveTokenId(term);
			if (existingTokenId === undefined) {
				return this;
			}
			this.rebuildPostingTape(new Map([[existingTokenId, undefined]]));
			return this;
		}
		const tokenId = this.getOrCreateTokenId(term);
		this.ensureSlotCapacity(tokenId + 1);
		this.rebuildPostingTape(new Map([[tokenId, nextDocIds]]));
		return this;
	}

	updateMany(
		postings: ReadonlyMap<string, CoverageLexicalPackedPostingValue | undefined>,
	): void {
		const overrides = new Map<number, Uint32Array | undefined>();
		let nextTokenCount = this.postingStartsByTokenId.length;
		for (const [term, docIds] of postings.entries()) {
			if (!docIds || docIds.length === 0) {
				const existingTokenId = this.resolveTokenId(term);
				if (existingTokenId !== undefined) {
					overrides.set(existingTokenId, undefined);
				}
				continue;
			}
			const tokenId = this.getOrCreateTokenId(term);
			nextTokenCount = Math.max(nextTokenCount, tokenId + 1);
			overrides.set(
				tokenId,
				docIds instanceof Uint32Array ? docIds : new Uint32Array(docIds),
			);
		}
		if (overrides.size === 0) {
			return;
		}
		this.rebuildPostingTape(overrides, nextTokenCount);
	}

	values(): IterableIterator<CoverageLexicalPackedPostingValue> {
		return this.iterateValues();
	}

	[Symbol.iterator](): IterableIterator<[string, CoverageLexicalPackedPostingValue]> {
		return this.entries();
	}

	private *iterateEntries(): IterableIterator<
		[string, CoverageLexicalPackedPostingValue]
	> {
		for (const [tokenId, docIds] of this.iterateTokenIdEntries()) {
			const term = this.resolveToken(tokenId);
			if (term === undefined) {
				continue;
			}
			yield [term, docIds];
		}
	}

	private *iterateKeys(): IterableIterator<string> {
		for (const [term] of this.iterateEntries()) {
			yield term;
		}
	}

	private *iterateTokenIdEntries(): IterableIterator<[number, Uint32Array]> {
		for (
			let tokenId = 0;
			tokenId < this.postingStartsByTokenId.length;
			tokenId += 1
		) {
			const docIds = this.readPostingAt(tokenId);
			if (!docIds) {
				continue;
			}
			yield [tokenId, docIds];
		}
	}

	private *iterateValues(): IterableIterator<CoverageLexicalPackedPostingValue> {
		for (const [, docIds] of this.iterateTokenIdEntries()) {
			yield docIds;
		}
	}

	private ensureSlotCapacity(nextTokenCount: number): void {
		if (nextTokenCount <= this.postingStartsByTokenId.length) {
			return;
		}
		const nextStartsByTokenId = new Uint32Array(nextTokenCount);
		nextStartsByTokenId.set(this.postingStartsByTokenId);
		this.postingStartsByTokenId = nextStartsByTokenId;
		const nextLengthsByTokenId = new Uint32Array(nextTokenCount);
		nextLengthsByTokenId.set(this.postingLengthsByTokenId);
		this.postingLengthsByTokenId = nextLengthsByTokenId;
	}

	private readPostingAt(tokenId: number): Uint32Array | undefined {
		const length = this.postingLengthsByTokenId[tokenId] ?? 0;
		if (length === 0) {
			return undefined;
		}
		const start = this.postingStartsByTokenId[tokenId] ?? 0;
		return this.postingTape.subarray(start, start + length);
	}

	private rebuildPostingTape(
		overrides: ReadonlyMap<number, Uint32Array | undefined>,
		nextTokenCount: number = this.postingStartsByTokenId.length,
	): void {
		const nextStartsByTokenId = new Uint32Array(nextTokenCount);
		const nextLengthsByTokenId = new Uint32Array(nextTokenCount);
		const nextPostingTape: number[] = [];
		let activeTermCount = 0;
		for (let tokenId = 0; tokenId < nextTokenCount; tokenId += 1) {
			const docIds = overrides.has(tokenId)
				? overrides.get(tokenId)
				: this.readPostingAt(tokenId);
			if (!docIds || docIds.length === 0) {
				continue;
			}
			nextStartsByTokenId[tokenId] = nextPostingTape.length;
			nextLengthsByTokenId[tokenId] = docIds.length;
			nextPostingTape.push(...docIds);
			activeTermCount += 1;
		}
		// Single-tape postings minimize resident memory, but each mutation rebuilds
		// the tape. If Obsidian starts feeling intermittently hitchy while indexing,
		// revisit this rebuild path first.
		this.postingStartsByTokenId = nextStartsByTokenId;
		this.postingLengthsByTokenId = nextLengthsByTokenId;
		this.postingTape = new Uint32Array(nextPostingTape);
		this.activeTermCount = activeTermCount;
	}
}
