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
	private readonly postingsByTokenId: Array<Uint32Array | undefined> = [];
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
		return this.postingsByTokenId.length;
	}

	readonly [Symbol.toStringTag] = "CoverageLexicalSharedTokenIdPostingMap";

	clear(): void {
		this.postingsByTokenId.length = 0;
		this.activeTermCount = 0;
	}

	delete(term: string): boolean {
		const tokenId = this.resolveTokenId(term);
		if (tokenId === undefined || this.postingsByTokenId[tokenId] === undefined) {
			return false;
		}
		this.postingsByTokenId[tokenId] = undefined;
		this.activeTermCount -= 1;
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
		return tokenId === undefined ? undefined : this.postingsByTokenId[tokenId];
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
		const nextPostingsByTokenId: Array<Uint32Array | undefined> = new Array(
			nextTokenCount,
		);
		let activeTermCount = 0;
		for (const [tokenId, docIds] of this.iterateTokenIdEntries()) {
			const nextTokenId = tokenIdRemap.get(tokenId);
			if (nextTokenId === undefined) {
				continue;
			}
			nextPostingsByTokenId[nextTokenId] = docIds;
			activeTermCount += 1;
		}
		this.postingsByTokenId.length = 0;
		this.postingsByTokenId.push(...nextPostingsByTokenId);
		this.activeTermCount = activeTermCount;
	}

	set(term: string, docIds: CoverageLexicalPackedPostingValue): this {
		const tokenId = this.getOrCreateTokenId(term);
		const nextDocIds =
			docIds instanceof Uint32Array ? docIds : new Uint32Array(docIds);
		const hadPrevious = this.postingsByTokenId[tokenId] !== undefined;
		if (nextDocIds.length === 0) {
			if (hadPrevious) {
				this.postingsByTokenId[tokenId] = undefined;
				this.activeTermCount -= 1;
			}
			return this;
		}
		this.postingsByTokenId[tokenId] = nextDocIds;
		if (!hadPrevious) {
			this.activeTermCount += 1;
		}
		return this;
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
			tokenId < this.postingsByTokenId.length;
			tokenId += 1
		) {
			const docIds = this.postingsByTokenId[tokenId];
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
}
