import type { IndexedDocument, MatchedFile } from "src/globals/search-types";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import type {
	FileSearchEngine,
	FileSearchRequest,
	SerializedFileSearchIndex,
} from "../file-search-engine";
import { Tokenizer } from "../tokenizer";
import {
	buildCoverageLexicalPassageAdmissionSignal,
	compareCoverageLexicalPassageAdmissionSignals,
} from "./coverage-lexical-admission";
import {
	buildCoverageLexicalPhraseSignatures,
	buildCoverageLexicalPhraseTerms,
} from "./coverage-lexical-bridge";
import { buildCoverageLexicalPlan } from "./coverage-lexical-planner";
import { collectCoverageLexicalCandidateStates } from "./coverage-lexical-recall";
import { buildCoverageLexicalPairSignatures } from "./coverage-lexical-signatures";
import {
	compareCoverageLexicalResultSignals,
	rankCoverageLexicalResults,
	type CoverageLexicalRankableResult,
} from "./coverage-lexical-ranker";
import {
	buildCoverageLexicalWindowFusionSignal,
	createEmptyCoverageLexicalWindowFusionSignal,
} from "./coverage-lexical-fusion";
import type {
	CoverageFamilyMatchKind,
	CoverageLexicalAreaSignal,
	CoverageLexicalCandidateState,
	CoverageLexicalFamily,
	CoverageLexicalFamilyProbe,
	CoverageLexicalFamilySignal,
	CoverageLexicalMetadataField,
	CoverageLexicalPairSignature,
	CoverageLexicalPhraseSignature,
} from "./coverage-lexical-types";

type CoverageLexicalDocument = {
	aliasTerms: Set<string>;
	basenameTerms: Set<string>;
	bodyTokenSequence: string[];
	bodyPhraseTerms: Set<string>;
	bodyTerms: Set<string>;
	folderTerms: Set<string>;
	headingTerms: Set<string>;
	metadataPhraseTerms: Set<string>;
	metadataTerms: Set<string>;
	tagTerms: Set<string>;
};
const LOCAL_WINDOW_RERANK_MULTIPLIER = 6;
const MIN_LOCAL_WINDOW_RERANK_BUDGET = 48;

@singleton()
export class CoverageLexicalFileSearchEngine implements FileSearchEngine {
	readonly backend = "coverage-lexical" as const;
	readonly supportsSerialization = false;

	private readonly tokenizer = getInstance(Tokenizer);
	private readonly documents = new Map<string, CoverageLexicalDocument>();
	private readonly bodyPostings = new Map<string, Set<string>>();
	private readonly bodyPhrasePostings = new Map<string, Set<string>>();
	private readonly metadataAliasPostings = new Map<string, Set<string>>();
	private readonly metadataBasenamePostings = new Map<string, Set<string>>();
	private readonly metadataFolderPostings = new Map<string, Set<string>>();
	private readonly metadataHeadingPostings = new Map<string, Set<string>>();
	private readonly metadataPostings = new Map<string, Set<string>>();
	private readonly metadataPhrasePostings = new Map<string, Set<string>>();
	private readonly metadataTagPostings = new Map<string, Set<string>>();
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
		this.bodyPhrasePostings.clear();
		this.metadataAliasPostings.clear();
		this.metadataBasenamePostings.clear();
		this.metadataFolderPostings.clear();
		this.metadataHeadingPostings.clear();
		this.metadataPostings.clear();
		this.metadataPhrasePostings.clear();
		this.metadataTagPostings.clear();
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
		const pairSignatures = buildCoverageLexicalPairSignatures(plan.families);
		const phraseSignatures = buildCoverageLexicalPhraseSignatures(plan.families);
		const candidates = collectCoverageLexicalCandidateStates(
			{
				bodyPostings: this.bodyPostings,
				metadataAliasPostings: this.metadataAliasPostings,
				metadataBasenamePostings: this.metadataBasenamePostings,
				metadataFolderPostings: this.metadataFolderPostings,
				metadataHeadingPostings: this.metadataHeadingPostings,
				metadataPostings: this.metadataPostings,
				bodyPhrasePostings: this.bodyPhrasePostings,
				metadataPhrasePostings: this.metadataPhrasePostings,
				metadataTagPostings: this.metadataTagPostings,
				sortedLexicon: this.sortedLexicon,
			},
			plan,
			phraseSignatures,
			request,
		);
		if (candidates.size === 0) {
			return [];
		}

		const coarseResults = Array.from(candidates.entries())
			.map(([path, state]) =>
				this.createRankableResult(
					path,
					queryTerms,
					plan.families,
					state,
					false,
					phraseSignatures,
					pairSignatures,
				),
			)
			.filter((result): result is CoverageLexicalRankableResult => result !== null);
		const admissionSignals = new Map(
			coarseResults.map((result) => {
				const document = this.documents.get(result.path);
				return [
					result.path,
					buildCoverageLexicalPassageAdmissionSignal(
						document?.bodyTokenSequence ?? [],
						plan.families,
						candidates.get(result.path) ?? {
							bodyMatches: new Map(),
							metadataMatches: new Map(),
							metadataFieldMatches: {
								basename: new Map(),
								aliases: new Map(),
								folder: new Map(),
								headings: new Map(),
								tags: new Map(),
							},
							phraseMatches: new Set(),
						},
						phraseSignatures,
					),
				] as const;
			}),
		);
		const coarseRanked = [...coarseResults].sort((left, right) => {
			const signalDecision = compareCoverageLexicalResultSignals(
				left.coverageLexicalSignal,
				right.coverageLexicalSignal,
				plan,
			);
			if (signalDecision !== 0) {
				return signalDecision;
			}
			const admissionDecision = compareCoverageLexicalPassageAdmissionSignals(
				admissionSignals.get(left.path)!,
				admissionSignals.get(right.path)!,
			);
			if (admissionDecision !== 0) {
				return admissionDecision;
			}
			return (
				(right.score ?? 0) - (left.score ?? 0) ||
				left.path.localeCompare(right.path)
			);
		});
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
						phraseSignatures,
						pairSignatures,
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
			sumPostingEntries(this.bodyPostings) +
			sumPostingEntries(this.bodyPhrasePostings) +
			sumPostingEntries(this.metadataAliasPostings) +
			sumPostingEntries(this.metadataBasenamePostings) +
			sumPostingEntries(this.metadataFolderPostings) +
			sumPostingEntries(this.metadataHeadingPostings) +
			sumPostingEntries(this.metadataPostings) +
			sumPostingEntries(this.metadataPhrasePostings) +
			sumPostingEntries(this.metadataTagPostings);
		return tokenCount * 24;
	}

	getIndexBreakdown(): Record<string, unknown> | null {
		return {
			documentCount: this.documents.size,
			bodyTermCount: this.bodyPostings.size,
			bodyPhraseTermCount: this.bodyPhrasePostings.size,
			metadataAliasTermCount: this.metadataAliasPostings.size,
			metadataBasenameTermCount: this.metadataBasenamePostings.size,
			metadataFolderTermCount: this.metadataFolderPostings.size,
			metadataHeadingTermCount: this.metadataHeadingPostings.size,
			metadataTermCount: this.metadataPostings.size,
			metadataPhraseTermCount: this.metadataPhrasePostings.size,
			metadataTagTermCount: this.metadataTagPostings.size,
			lexiconSize: this.sortedLexicon.length,
		};
	}

	private indexDocument(document: IndexedDocument): void {
		this.removeDocument(document.path);

		const bodyTokenSequence = this.tokenizer
			.tokenizeSequence(document.content ?? "", "index")
			.map((term) => term.toLowerCase());
		const bodyTerms = new Set(bodyTokenSequence);
		const basenameTerms = new Set(
			this.tokenizer
				.tokenizeSequence(document.basename ?? "", "index")
				.map((term) => term.toLowerCase()),
		);
		const folderTerms = new Set(
			this.tokenizer
				.tokenizeSequence(document.folder ?? "", "index")
				.map((term) => term.toLowerCase()),
		);
		const aliasTerms = new Set(
			this.tokenizer
				.tokenizeSequence(document.aliases ?? "", "index")
				.map((term) => term.toLowerCase()),
		);
		const tagTerms = new Set(
			this.tokenizer
				.tokenizeSequence(document.tags ?? "", "index")
				.map((term) => term.toLowerCase()),
		);
		const headingTerms = new Set(
			this.tokenizer
				.tokenizeSequence(document.headings ?? "", "index")
				.map((term) => term.toLowerCase()),
		);
		const metadataTokenSequence = [
			...basenameTerms,
			...folderTerms,
			...aliasTerms,
			...tagTerms,
			...headingTerms,
		];
		const metadataTerms = new Set(metadataTokenSequence);
		const bodyPhraseTerms = new Set(
			buildCoverageLexicalPhraseTerms(bodyTokenSequence),
		);
		const metadataPhraseTerms = new Set(
			buildCoverageLexicalPhraseTerms(metadataTokenSequence),
		);

		this.documents.set(document.path, {
			aliasTerms,
			basenameTerms,
			bodyTokenSequence,
			bodyPhraseTerms,
			bodyTerms,
			folderTerms,
			headingTerms,
			metadataPhraseTerms,
			metadataTerms,
			tagTerms,
		});

		for (const term of bodyTerms) {
			addPosting(this.bodyPostings, term, document.path);
			this.lexicon.add(term);
		}
		for (const term of bodyPhraseTerms) {
			addPosting(this.bodyPhrasePostings, term, document.path);
		}
		for (const term of aliasTerms) {
			addPosting(this.metadataAliasPostings, term, document.path);
			this.lexicon.add(term);
		}
		for (const term of basenameTerms) {
			addPosting(this.metadataBasenamePostings, term, document.path);
			this.lexicon.add(term);
		}
		for (const term of folderTerms) {
			addPosting(this.metadataFolderPostings, term, document.path);
			this.lexicon.add(term);
		}
		for (const term of headingTerms) {
			addPosting(this.metadataHeadingPostings, term, document.path);
			this.lexicon.add(term);
		}
		for (const term of metadataTerms) {
			addPosting(this.metadataPostings, term, document.path);
			this.lexicon.add(term);
		}
		for (const term of metadataPhraseTerms) {
			addPosting(this.metadataPhrasePostings, term, document.path);
		}
		for (const term of tagTerms) {
			addPosting(this.metadataTagPostings, term, document.path);
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
		for (const term of existing.bodyPhraseTerms) {
			removePosting(this.bodyPhrasePostings, term, path);
		}
		for (const term of existing.aliasTerms) {
			removePosting(this.metadataAliasPostings, term, path);
		}
		for (const term of existing.basenameTerms) {
			removePosting(this.metadataBasenamePostings, term, path);
		}
		for (const term of existing.folderTerms) {
			removePosting(this.metadataFolderPostings, term, path);
		}
		for (const term of existing.headingTerms) {
			removePosting(this.metadataHeadingPostings, term, path);
		}
		for (const term of existing.metadataTerms) {
			removePosting(this.metadataPostings, term, path);
		}
		for (const term of existing.metadataPhraseTerms) {
			removePosting(this.metadataPhrasePostings, term, path);
		}
		for (const term of existing.tagTerms) {
			removePosting(this.metadataTagPostings, term, path);
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

	private createRankableResult(
		path: string,
		queryTerms: readonly string[],
		families: readonly CoverageLexicalFamily[],
		state: CoverageLexicalCandidateState,
		includeLocalWindow: boolean,
		phraseSignatures: readonly CoverageLexicalPhraseSignature[],
		pairSignatures: readonly CoverageLexicalPairSignature[],
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
			phraseSignatures,
			pairSignatures,
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

}

function buildCoverageSignal(
	families: readonly CoverageLexicalFamily[],
	state: CoverageLexicalCandidateState,
	bodyTokenSequence: readonly string[],
	includeLocalWindow: boolean,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
	pairSignatures: readonly CoverageLexicalPairSignature[],
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
				continue;
			}
			if (metadataKind) {
				const boostedWeight =
					weight * getMetadataFieldBoost(state, family.index, metadataKind);
				applyMatch(softBody, metadataKind, boostedWeight);
				tailSoftWeight += boostedWeight;
			}
			continue;
		}
		if (family.role === "anchor") {
			if (metadataKind && family.isMetadataCapable) {
				applyMatch(
					metadataAnchor,
					metadataKind,
					weight * getMetadataFieldBoost(state, family.index, metadataKind),
				);
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
		phraseBridgeCount: state.phraseMatches.size,
		phraseBridgeWeight: Array.from(state.phraseMatches).reduce(
			(total, index) => total + (phraseSignatures[index]?.tailWeight ?? 0),
			0,
		),
		localEvidence: includeLocalWindow
			? buildCoverageLexicalWindowFusionSignal(
				bodyTokenSequence,
				families,
				pairSignatures,
			)
			: createEmptyCoverageLexicalWindowFusionSignal(),
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

function getMetadataFieldBoost(
	state: CoverageLexicalCandidateState,
	familyIndex: number,
	kind: Exclude<CoverageFamilyMatchKind, null>,
): number {
	let bestBoost = 1;
	for (const [field, matches] of Object.entries(
		state.metadataFieldMatches,
	) as Array<[CoverageLexicalMetadataField, Map<number, CoverageFamilyMatchKind>]>) {
		if (matches.get(familyIndex) !== kind) {
			continue;
		}
		bestBoost = Math.max(bestBoost, getMetadataFieldWeight(field));
	}
	return bestBoost;
}

function getMetadataFieldWeight(field: CoverageLexicalMetadataField): number {
	switch (field) {
		case "basename":
			return 4;
		case "aliases":
			return 3;
		case "headings":
			return 3;
		case "folder":
			return 2;
		case "tags":
			return 2;
		default:
			return 1;
	}
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
		signal.localEvidence.primary.coreCoverageCount * 2 +
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
