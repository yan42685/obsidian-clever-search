import type { IndexedDocument, MatchedFile } from "src/globals/search-types";
import { innerSetting } from "src/globals/plugin-setting";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import type {
	FileSearchEngine,
	FileSearchRequest,
	SerializedFileSearchIndex,
} from "../file-search-engine";
import { Tokenizer } from "../tokenizer";
import { buildCoverageLexicalPlan } from "./coverage-lexical-planner";
import {
	rankCoverageLexicalResults,
	type CoverageLexicalRankableResult,
} from "./coverage-lexical-ranker";
import { buildCoverageLexicalLocalWindowSignal } from "./coverage-lexical-windowing";
import type {
	CoverageFamilyMatchKind,
	CoverageLexicalAreaSignal,
	CoverageLexicalFamily,
	CoverageLexicalFamilyProbe,
	CoverageLexicalFamilySignal,
	CoverageLexicalLocalWindowSignal,
} from "./coverage-lexical-types";

type CoverageLexicalDocument = {
	bodyTokenSequence: string[];
	bodyTerms: Set<string>;
	metadataTerms: Set<string>;
};

type CoverageLexicalCandidateState = {
	bodyMatches: Map<number, CoverageFamilyMatchKind>;
	metadataMatches: Map<number, CoverageFamilyMatchKind>;
};

const MAX_PREFIX_EXPANSIONS = 48;
const MAX_FUZZY_EXPANSIONS = 24;
const COVERAGE_CANDIDATE_MULTIPLIER = 4;
const LOCAL_WINDOW_RERANK_MULTIPLIER = 6;
const MIN_LOCAL_WINDOW_RERANK_BUDGET = 48;

@singleton()
export class CoverageLexicalFileSearchEngine implements FileSearchEngine {
	readonly backend = "coverage-lexical" as const;
	readonly supportsSerialization = false;

	private readonly tokenizer = getInstance(Tokenizer);
	private readonly documents = new Map<string, CoverageLexicalDocument>();
	private readonly bodyPostings = new Map<string, Set<string>>();
	private readonly metadataPostings = new Map<string, Set<string>>();
	private readonly lexicon = new Set<string>();
	private sortedLexicon: string[] = [];

	async reIndexAll(
		data: IndexedDocument[] | SerializedFileSearchIndex,
	): Promise<boolean> {
		if (!Array.isArray(data)) {
			logger.warn(
				"coverage-lexical MVP currently supports rebuild from live documents only",
			);
			this.clearIndex();
			return false;
		}

		this.clearIndex();
		await this.addDocuments(data);
		return true;
	}

	clearIndex(): void {
		this.documents.clear();
		this.bodyPostings.clear();
		this.metadataPostings.clear();
		this.lexicon.clear();
		this.sortedLexicon = [];
	}

	async addDocuments(documents: IndexedDocument[]): Promise<void> {
		for (const document of documents) {
			this.indexDocument(document);
		}
	}

	deleteDocuments(paths: string[]): void {
		for (const path of paths) {
			this.removeDocument(path);
		}
	}

	async searchFiles(request: FileSearchRequest): Promise<MatchedFile[]> {
		const queryTerms = this.tokenizer
			.tokenizeSequence(request.queryText, "search")
			.map((term) => term.toLowerCase());
		if (queryTerms.length === 0 || this.documents.size === 0) {
			return [];
		}

		const familyProbes = this.buildFamilyProbes(queryTerms);
		const plan = buildCoverageLexicalPlan(request.queryText, queryTerms, familyProbes);
		const candidates = this.collectCandidateStates(plan.families, request);
		if (candidates.size === 0) {
			return [];
		}

		const coarseResults = Array.from(candidates.entries())
			.map(([path, state]) =>
				this.createRankableResult(path, queryTerms, plan.families, state, false),
			)
			.filter((result): result is CoverageLexicalRankableResult => result !== null);
		const coarseRanked = rankCoverageLexicalResults(coarseResults, plan);
		const localWindowBudget = Math.min(
			coarseRanked.length,
			Math.max(
				MIN_LOCAL_WINDOW_RERANK_BUDGET,
				request.maxItemResults * LOCAL_WINDOW_RERANK_MULTIPLIER,
			),
		);
		const localWindowPaths = new Set(
			coarseRanked
				.slice(0, localWindowBudget)
				.map((result) => result.path),
		);
		const ranked = rankCoverageLexicalResults(
			Array.from(candidates.entries())
				.map(([path, state]) =>
					this.createRankableResult(
						path,
						queryTerms,
						plan.families,
						state,
						localWindowPaths.has(path),
					),
				)
				.filter((result): result is CoverageLexicalRankableResult => result !== null),
			plan,
		);
		return ranked
			.slice(0, request.maxItemResults)
			.map(({ coverageLexicalSignal: _coverageLexicalSignal, ...result }) => result);
	}

	serialize(): SerializedFileSearchIndex | null {
		return null;
	}

	estimateIndexBytes(): number | null {
		const tokenCount =
			sumPostingEntries(this.bodyPostings) + sumPostingEntries(this.metadataPostings);
		return tokenCount * 24;
	}

	getIndexBreakdown(): Record<string, unknown> | null {
		return {
			documentCount: this.documents.size,
			bodyTermCount: this.bodyPostings.size,
			metadataTermCount: this.metadataPostings.size,
			lexiconSize: this.sortedLexicon.length,
		};
	}

	private indexDocument(document: IndexedDocument): void {
		this.removeDocument(document.path);

		const bodyTokenSequence = this.tokenizer
			.tokenizeSequence(document.content ?? "", "index")
			.map((term) => term.toLowerCase());
		const bodyTerms = new Set(bodyTokenSequence);
		const metadataTerms = new Set(
			this.tokenizer
				.tokenizeSequence(
					[
						document.basename,
						document.folder,
						document.aliases ?? "",
						document.tags ?? "",
						document.headings ?? "",
					].join(" "),
					"index",
				)
				.map((term) => term.toLowerCase()),
		);

		this.documents.set(document.path, {
			bodyTokenSequence,
			bodyTerms,
			metadataTerms,
		});

		for (const term of bodyTerms) {
			addPosting(this.bodyPostings, term, document.path);
			this.lexicon.add(term);
		}
		for (const term of metadataTerms) {
			addPosting(this.metadataPostings, term, document.path);
			this.lexicon.add(term);
		}
		this.sortedLexicon = Array.from(this.lexicon).sort();
	}

	private removeDocument(path: string): void {
		const existing = this.documents.get(path);
		if (!existing) {
			return;
		}

		for (const term of existing.bodyTerms) {
			removePosting(this.bodyPostings, term, path);
		}
		for (const term of existing.metadataTerms) {
			removePosting(this.metadataPostings, term, path);
		}
		this.documents.delete(path);
		this.rebuildLexicon();
	}

	private rebuildLexicon(): void {
		const nextLexicon = new Set<string>();
		for (const term of this.bodyPostings.keys()) {
			nextLexicon.add(term);
		}
		for (const term of this.metadataPostings.keys()) {
			nextLexicon.add(term);
		}
		this.lexicon.clear();
		for (const term of nextLexicon) {
			this.lexicon.add(term);
		}
		this.sortedLexicon = Array.from(this.lexicon).sort();
	}

	private buildFamilyProbes(queryTerms: readonly string[]): CoverageLexicalFamilyProbe[] {
		return queryTerms.map((term) => ({
			bodyExactDocCount: this.bodyPostings.get(term)?.size ?? 0,
			metadataExactDocCount: this.metadataPostings.get(term)?.size ?? 0,
		}));
	}

	private collectCandidateStates(
		families: readonly CoverageLexicalFamily[],
		request: FileSearchRequest,
	): Map<string, CoverageLexicalCandidateState> {
		const candidates = new Map<string, CoverageLexicalCandidateState>();
		for (const family of families) {
			if (family.role === "noise") {
				continue;
			}
			this.collectCandidatesForTerm(
				candidates,
				family.index,
				family.normalizedTerm,
				"exact",
			);
		}

		if (
			request.isPrefixMatch &&
			candidates.size < request.maxItemResults * COVERAGE_CANDIDATE_MULTIPLIER
		) {
			for (const family of families) {
				if (family.role === "noise" || !family.allowPrefix) {
					continue;
				}
				for (const term of this.expandPrefixTerms(family.normalizedTerm)) {
					if (term === family.normalizedTerm) {
						continue;
					}
					this.collectCandidatesForTerm(candidates, family.index, term, "prefix");
				}
			}
		}

		if (
			request.isFuzzy &&
			candidates.size < request.maxItemResults * COVERAGE_CANDIDATE_MULTIPLIER
		) {
			for (const family of families) {
				if (family.role === "noise" || !family.allowFuzzy) {
					continue;
				}
				for (const term of this.expandFuzzyTerms(family.normalizedTerm)) {
					this.collectCandidatesForTerm(candidates, family.index, term, "fuzzy");
				}
			}
		}

		return candidates;
	}

	private collectCandidatesForTerm(
		candidates: Map<string, CoverageLexicalCandidateState>,
		familyIndex: number,
		term: string,
		kind: Exclude<CoverageFamilyMatchKind, null>,
	): void {
		const bodyMatches = this.bodyPostings.get(term);
		if (bodyMatches) {
			for (const path of bodyMatches) {
				const state = getOrCreateCandidateState(candidates, path);
				recordFamilyMatch(state.bodyMatches, familyIndex, kind);
			}
		}

		const metadataMatches = this.metadataPostings.get(term);
		if (metadataMatches) {
			for (const path of metadataMatches) {
				const state = getOrCreateCandidateState(candidates, path);
				recordFamilyMatch(state.metadataMatches, familyIndex, kind);
			}
		}
	}

	private createRankableResult(
		path: string,
		queryTerms: readonly string[],
		families: readonly CoverageLexicalFamily[],
		state: CoverageLexicalCandidateState,
		includeLocalWindow: boolean,
	): CoverageLexicalRankableResult | null {
		const document = this.documents.get(path);
		if (!document) {
			return null;
		}
		const signal = buildCoverageSignal(
			families,
			state,
			document.bodyTokenSequence,
			includeLocalWindow,
		);
		if (
			signal.coreBody.coverageCount === 0 &&
			signal.softBody.coverageCount === 0 &&
			signal.metadataAnchor.coverageCount === 0
		) {
			return null;
		}

		return {
			path,
			queryTerms: [...queryTerms],
			matchedTerms: signal.matchedTerms,
			score: computeFallbackScore(signal),
			coverageLexicalSignal: signal,
		};
	}

	private expandPrefixTerms(prefix: string): string[] {
		const out: string[] = [];
		let index = lowerBoundString(this.sortedLexicon, prefix);
		while (index < this.sortedLexicon.length) {
			const term = this.sortedLexicon[index];
			if (!term.startsWith(prefix)) {
				break;
			}
			out.push(term);
			if (out.length >= MAX_PREFIX_EXPANSIONS) {
				break;
			}
			index += 1;
		}
		return out;
	}

	private expandFuzzyTerms(queryTerm: string): string[] {
		const maxDistance = computeMaxFuzzyDistance(queryTerm);
		if (maxDistance <= 0) {
			return [];
		}

		const candidates: Array<{ term: string; distance: number }> = [];
		for (const term of this.sortedLexicon) {
			if (Math.abs(term.length - queryTerm.length) > maxDistance) {
				continue;
			}
			if (term[0] !== queryTerm[0]) {
				continue;
			}
			const distance = boundedLevenshtein(term, queryTerm, maxDistance);
			if (distance <= maxDistance) {
				candidates.push({ term, distance });
			}
		}

		candidates.sort((left, right) => {
			if (left.distance !== right.distance) {
				return left.distance - right.distance;
			}
			return left.term.localeCompare(right.term);
		});
		return candidates
			.slice(0, MAX_FUZZY_EXPANSIONS)
			.map((candidate) => candidate.term);
	}
}

function buildCoverageSignal(
	families: readonly CoverageLexicalFamily[],
	state: CoverageLexicalCandidateState,
	bodyTokenSequence: readonly string[],
	includeLocalWindow: boolean,
): CoverageLexicalFamilySignal {
	const coreBody = createEmptyAreaSignal();
	const softBody = createEmptyAreaSignal();
	const metadataAnchor = createEmptyAreaSignal();
	let tailCoreWeight = 0;
	let tailSoftWeight = 0;
	const matchedTerms = new Set<string>();

	for (const family of families) {
		const bodyKind = state.bodyMatches.get(family.index) ?? null;
		const metadataKind = state.metadataMatches.get(family.index) ?? null;
		if (family.role === "noise" || (!bodyKind && !metadataKind)) {
			continue;
		}

		const weight = computeFamilyTailWeight(family.index);
		const bestKind = pickBetterMatchKind(bodyKind, metadataKind);
		if (bestKind) {
			matchedTerms.add(family.normalizedTerm);
		}
		if (family.role === "body") {
			if (bodyKind && family.strength === "core") {
				applyMatch(coreBody, bodyKind, weight);
				tailCoreWeight += weight;
				continue;
			}
			if (bodyKind) {
				applyMatch(softBody, bodyKind, weight);
				tailSoftWeight += weight;
			}
			continue;
		}
		if (family.role === "anchor") {
			if (metadataKind && family.isMetadataCapable) {
				applyMatch(metadataAnchor, metadataKind, weight);
				continue;
			}
			if (bodyKind) {
				applyMatch(softBody, bodyKind, weight);
				tailSoftWeight += weight;
			}
		}
	}

	return {
		coreBody,
		softBody,
		metadataAnchor,
		tailCoreWeight,
		tailSoftWeight,
		localWindow: includeLocalWindow
			? buildCoverageLexicalLocalWindowSignal(bodyTokenSequence, families)
			: createEmptyLocalWindowSignal(),
		matchedTerms: Array.from(matchedTerms),
	};
}

function pickBetterMatchKind(
	left: CoverageFamilyMatchKind,
	right: CoverageFamilyMatchKind,
): CoverageFamilyMatchKind {
	const rank = {
		exact: 3,
		prefix: 2,
		fuzzy: 1,
		null: 0,
	} as const;
	return rank[left ?? "null"] >= rank[right ?? "null"] ? left : right;
}

function createEmptyAreaSignal(): CoverageLexicalAreaSignal {
	return {
		coverageCount: 0,
		exactWeight: 0,
		prefixWeight: 0,
		fuzzyWeight: 0,
	};
}

function createEmptyLocalWindowSignal(): CoverageLexicalLocalWindowSignal {
	return {
		start: -1,
		end: -1,
		coreCoverageCount: 0,
		exactCoreWeight: 0,
		prefixCoreWeight: 0,
		fuzzyCoreWeight: 0,
		anchorCoverageCount: 0,
		softCoverageCount: 0,
		orderedPairCount: 0,
		orderRatio: 0,
		compactnessRatio: 0,
		score: 0,
	};
}

function applyMatch(
	area: CoverageLexicalAreaSignal,
	kind: Exclude<CoverageFamilyMatchKind, null>,
	weight: number,
): void {
	area.coverageCount += 1;
	if (kind === "exact") {
		area.exactWeight += weight;
		return;
	}
	if (kind === "prefix") {
		area.prefixWeight += weight;
		return;
	}
	area.fuzzyWeight += weight;
}

function computeFamilyTailWeight(index: number): number {
	const position = index + 1;
	return position * position;
}

function computeFallbackScore(signal: CoverageLexicalFamilySignal): number {
	return (
		signal.coreBody.coverageCount * 100 +
		signal.coreBody.exactWeight * 3 +
		signal.coreBody.prefixWeight * 2 +
		signal.softBody.coverageCount * 20 +
		signal.metadataAnchor.coverageCount * 10 +
		signal.metadataAnchor.exactWeight +
		signal.tailCoreWeight * 0.01 +
		signal.tailSoftWeight * 0.001
	);
}

function sumPostingEntries(postings: ReadonlyMap<string, Set<string>>): number {
	let total = 0;
	for (const docs of postings.values()) {
		total += docs.size;
	}
	return total;
}

function addPosting(
	postings: Map<string, Set<string>>,
	term: string,
	path: string,
): void {
	let docs = postings.get(term);
	if (!docs) {
		docs = new Set();
		postings.set(term, docs);
	}
	docs.add(path);
}

function removePosting(
	postings: Map<string, Set<string>>,
	term: string,
	path: string,
): void {
	const docs = postings.get(term);
	if (!docs) {
		return;
	}
	docs.delete(path);
	if (docs.size === 0) {
		postings.delete(term);
	}
}

function getOrCreateCandidateState(
	candidates: Map<string, CoverageLexicalCandidateState>,
	path: string,
): CoverageLexicalCandidateState {
	let state = candidates.get(path);
	if (!state) {
		state = {
			bodyMatches: new Map(),
			metadataMatches: new Map(),
		};
		candidates.set(path, state);
	}
	return state;
}

function recordFamilyMatch(
	matches: Map<number, CoverageFamilyMatchKind>,
	familyIndex: number,
	kind: Exclude<CoverageFamilyMatchKind, null>,
): void {
	const previous = matches.get(familyIndex) ?? null;
	if (pickBetterMatchKind(previous, kind) === previous) {
		return;
	}
	matches.set(familyIndex, kind);
}

function lowerBoundString(values: readonly string[], target: string): number {
	let lo = 0;
	let hi = values.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (values[mid].localeCompare(target) < 0) {
			lo = mid + 1;
		} else {
			hi = mid;
		}
	}
	return lo;
}

function computeMaxFuzzyDistance(queryTerm: string): number {
	if (queryTerm.length <= 4) {
		return 0;
	}
	return Math.min(
		2,
		Math.max(1, Math.round(queryTerm.length * innerSetting.search.fuzzyProportion)),
	);
}

function boundedLevenshtein(a: string, b: string, maxDistance: number): number {
	if (a === b) {
		return 0;
	}
	if (Math.abs(a.length - b.length) > maxDistance) {
		return maxDistance + 1;
	}

	const prev = new Array<number>(b.length + 1);
	const curr = new Array<number>(b.length + 1);
	for (let index = 0; index <= b.length; index++) {
		prev[index] = index;
	}

	for (let row = 1; row <= a.length; row++) {
		curr[0] = row;
		let rowMin = curr[0];
		for (let column = 1; column <= b.length; column++) {
			const cost = a[row - 1] === b[column - 1] ? 0 : 1;
			curr[column] = Math.min(
				prev[column] + 1,
				curr[column - 1] + 1,
				prev[column - 1] + cost,
			);
			rowMin = Math.min(rowMin, curr[column]);
		}
		if (rowMin > maxDistance) {
			return maxDistance + 1;
		}
		for (let index = 0; index <= b.length; index++) {
			prev[index] = curr[index];
		}
	}

	return prev[b.length];
}
