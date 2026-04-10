import type {
	CoverageLexicalV2RuntimeDocumentLexicalState,
} from "./coverage-lexical-runtime-source-builder";
import {
	getCoverageLexicalV2RuntimeMatchQuality,
	normalizeCoverageLexicalV2RuntimeTerm,
	type CoverageLexicalV2RuntimeMatchOptions,
} from "./coverage-lexical-runtime-match";

export type CoverageLexicalV2RuntimePostingField =
	| "basename"
	| "aliases"
	| "headings"
	| "folder"
	| "tag"
	| "body";

export type CoverageLexicalV2RuntimeDocumentRecord = {
	path: string;
	stableDeterministicKey?: string;
	basenameText: string;
	aliasesText: string;
	headingsText: string;
};

export type CoverageLexicalV2RuntimeStorageReader = {
	getDocumentRecord(docId: number): CoverageLexicalV2RuntimeDocumentRecord | null;
	getPostingMatches(
		field: CoverageLexicalV2RuntimePostingField,
		term: string,
	): readonly number[] | Uint32Array | undefined;
	getSortedLexicon(): readonly string[];
	getBodyTokenSequence(docId: number): readonly string[] | undefined;
	prefetchBodyTokenSequences(docIds: readonly number[]): Promise<void>;
	tokenizeText(text: string): readonly string[];
};

type CoverageLexicalV2RuntimeCandidateFieldMatches = {
	basenameTerms: Set<string>;
	aliasTerms: Set<string>;
	headingsTerms: Set<string>;
	folderTerms: Set<string>;
	tagTerms: Set<string>;
	bodyTerms: Set<string>;
	basenameExactQueryTerms: Set<string>;
	aliasExactQueryTerms: Set<string>;
	headingsExactQueryTerms: Set<string>;
	bodyExactQueryTerms: Set<string>;
};

export async function buildCoverageLexicalV2RuntimeDocumentLexicalStates(
	queryTerms: readonly string[],
	reader: CoverageLexicalV2RuntimeStorageReader,
	matchOptions: CoverageLexicalV2RuntimeMatchOptions = {},
): Promise<CoverageLexicalV2RuntimeDocumentLexicalState[]> {
	const uniqueQueryTerms = [...new Set(
		queryTerms
			.map((term) => normalizeCoverageLexicalV2RuntimeTerm(term))
			.filter((term) => term.length > 0),
	)];
	const candidateFieldMatchesByDocId = new Map<number, CoverageLexicalV2RuntimeCandidateFieldMatches>();
	for (const term of uniqueQueryTerms) {
		collectCoverageLexicalV2RuntimeCandidateFieldMatches(
			candidateFieldMatchesByDocId,
			term,
			reader,
			matchOptions,
		);
	}
	const bodyLocalWindowDocIds = [...candidateFieldMatchesByDocId.entries()]
		.filter(([, fieldMatches]) => fieldMatches.bodyExactQueryTerms.size > 0)
		.map(([docId]) => docId);
	await reader.prefetchBodyTokenSequences(bodyLocalWindowDocIds);
	return [...candidateFieldMatchesByDocId.entries()]
		.sort(([leftDocId], [rightDocId]) => {
			const leftRecord = reader.getDocumentRecord(leftDocId);
			const rightRecord = reader.getDocumentRecord(rightDocId);
			const leftPath = leftRecord?.path ?? "";
			const rightPath = rightRecord?.path ?? "";
			return compareCoverageLexicalV2RuntimeStrings(leftPath, rightPath) || leftDocId - rightDocId;
		})
		.map<CoverageLexicalV2RuntimeDocumentLexicalState | null>(([docId, fieldMatches]) =>
			buildCoverageLexicalV2RuntimeDocumentState(docId, fieldMatches, reader),
		)
		.filter((document): document is CoverageLexicalV2RuntimeDocumentLexicalState => document !== null);
}

function buildCoverageLexicalV2RuntimeDocumentState(
	docId: number,
	fieldMatches: CoverageLexicalV2RuntimeCandidateFieldMatches,
	reader: CoverageLexicalV2RuntimeStorageReader,
): CoverageLexicalV2RuntimeDocumentLexicalState | null {
	const record = reader.getDocumentRecord(docId);
	if (!record) {
		return null;
	}
	const basenameTokenSequence = fieldMatches.basenameExactQueryTerms.size > 0
		? buildCoverageLexicalV2RuntimeTokenSequence(reader, record.basenameText)
		: undefined;
	const aliasTokenSequence = fieldMatches.aliasExactQueryTerms.size > 0
		? buildCoverageLexicalV2RuntimeTokenSequence(reader, record.aliasesText)
		: undefined;
	const headingsTokenSequence = fieldMatches.headingsExactQueryTerms.size > 0
		? buildCoverageLexicalV2RuntimeTokenSequence(reader, record.headingsText)
		: undefined;
	const bodyTokenSequence = fieldMatches.bodyExactQueryTerms.size > 0
		? reader.getBodyTokenSequence(docId) ?? []
		: [];
	return {
		docId,
		path: record.path,
		stableDeterministicKey: record.stableDeterministicKey ?? record.path,
		fieldTerms: {
			basenameTerms: buildCoverageLexicalV2RuntimeFieldTerms(fieldMatches.basenameTerms),
			aliasTerms: buildCoverageLexicalV2RuntimeFieldTerms(fieldMatches.aliasTerms),
			headingsTerms: buildCoverageLexicalV2RuntimeFieldTerms(fieldMatches.headingsTerms),
			folderTerms: buildCoverageLexicalV2RuntimeFieldTerms(fieldMatches.folderTerms),
			tagTerms: buildCoverageLexicalV2RuntimeFieldTerms(fieldMatches.tagTerms),
			bodyTerms: buildCoverageLexicalV2RuntimeFieldTerms(fieldMatches.bodyTerms),
		},
		basenameTokenSequence,
		aliasTokenSequence,
		headingsTokenSequence,
		bodyTokenSequence: bodyTokenSequence.length > 0 ? [...bodyTokenSequence] : undefined,
	};
}

function collectCoverageLexicalV2RuntimeCandidateFieldMatches(
	target: Map<number, CoverageLexicalV2RuntimeCandidateFieldMatches>,
	queryTerm: string,
	reader: CoverageLexicalV2RuntimeStorageReader,
	matchOptions: CoverageLexicalV2RuntimeMatchOptions,
): void {
	collectCoverageLexicalV2RuntimeExactPostingMatches(target, queryTerm, reader);
	for (const expandedTerm of collectCoverageLexicalV2RuntimeExpansionTerms(queryTerm, reader, matchOptions)) {
		collectCoverageLexicalV2RuntimeExpandedPostingMatches(target, expandedTerm, reader);
	}
}

function collectCoverageLexicalV2RuntimeExactPostingMatches(
	target: Map<number, CoverageLexicalV2RuntimeCandidateFieldMatches>,
	term: string,
	reader: CoverageLexicalV2RuntimeStorageReader,
): void {
	collectCoverageLexicalV2RuntimePostingMatches(target, term, reader.getPostingMatches("body", term), "bodyTerms", "bodyExactQueryTerms");
	collectCoverageLexicalV2RuntimePostingMatches(target, term, reader.getPostingMatches("basename", term), "basenameTerms", "basenameExactQueryTerms");
	collectCoverageLexicalV2RuntimePostingMatches(target, term, reader.getPostingMatches("aliases", term), "aliasTerms", "aliasExactQueryTerms");
	collectCoverageLexicalV2RuntimePostingMatches(target, term, reader.getPostingMatches("headings", term), "headingsTerms", "headingsExactQueryTerms");
	collectCoverageLexicalV2RuntimePostingMatches(target, term, reader.getPostingMatches("folder", term), "folderTerms");
	collectCoverageLexicalV2RuntimePostingMatches(target, term, reader.getPostingMatches("tag", term), "tagTerms");
}

function collectCoverageLexicalV2RuntimeExpandedPostingMatches(
	target: Map<number, CoverageLexicalV2RuntimeCandidateFieldMatches>,
	term: string,
	reader: CoverageLexicalV2RuntimeStorageReader,
): void {
	collectCoverageLexicalV2RuntimePostingMatches(target, term, reader.getPostingMatches("body", term), "bodyTerms");
	collectCoverageLexicalV2RuntimePostingMatches(target, term, reader.getPostingMatches("basename", term), "basenameTerms");
	collectCoverageLexicalV2RuntimePostingMatches(target, term, reader.getPostingMatches("aliases", term), "aliasTerms");
	collectCoverageLexicalV2RuntimePostingMatches(target, term, reader.getPostingMatches("headings", term), "headingsTerms");
	collectCoverageLexicalV2RuntimePostingMatches(target, term, reader.getPostingMatches("folder", term), "folderTerms");
	collectCoverageLexicalV2RuntimePostingMatches(target, term, reader.getPostingMatches("tag", term), "tagTerms");
}

function collectCoverageLexicalV2RuntimePostingMatches(
	target: Map<number, CoverageLexicalV2RuntimeCandidateFieldMatches>,
	term: string,
	postings: readonly number[] | Uint32Array | undefined,
	fieldKey:
		| "basenameTerms"
		| "aliasTerms"
		| "headingsTerms"
		| "folderTerms"
		| "tagTerms"
		| "bodyTerms",
	exactFieldKey?:
		| "basenameExactQueryTerms"
		| "aliasExactQueryTerms"
		| "headingsExactQueryTerms"
		| "bodyExactQueryTerms",
): void {
	if (!postings) {
		return;
	}
	for (const docId of postings) {
		const fieldMatches = getOrCreateCoverageLexicalV2RuntimeCandidateFieldMatches(target, docId);
		fieldMatches[fieldKey].add(term);
		if (exactFieldKey) {
			fieldMatches[exactFieldKey].add(term);
		}
	}
}

function collectCoverageLexicalV2RuntimeExpansionTerms(
	queryTerm: string,
	reader: CoverageLexicalV2RuntimeStorageReader,
	matchOptions: CoverageLexicalV2RuntimeMatchOptions,
): string[] {
	if (!matchOptions.includePrefix && !matchOptions.includeFuzzy) {
		return [];
	}
	const expansions: string[] = [];
	const seen = new Set<string>();
	const sortedLexicon = reader.getSortedLexicon();
	if (matchOptions.includePrefix) {
		let termIndex = lowerBoundCoverageLexicalV2RuntimeString(sortedLexicon, queryTerm);
		while (termIndex < sortedLexicon.length) {
			const candidateTerm = sortedLexicon[termIndex];
			if (!candidateTerm.startsWith(queryTerm)) {
				break;
			}
			if (
				candidateTerm !== queryTerm &&
				getCoverageLexicalV2RuntimeMatchQuality(queryTerm, candidateTerm, matchOptions) === "prefix"
			) {
				seen.add(candidateTerm);
				expansions.push(candidateTerm);
			}
			termIndex += 1;
		}
	}
	if (matchOptions.includeFuzzy) {
		for (const candidateTerm of sortedLexicon) {
			if (seen.has(candidateTerm) || candidateTerm === queryTerm) {
				continue;
			}
			if (
				getCoverageLexicalV2RuntimeMatchQuality(queryTerm, candidateTerm, matchOptions) === "fuzzy"
			) {
				seen.add(candidateTerm);
				expansions.push(candidateTerm);
			}
		}
	}
	return expansions;
}

function buildCoverageLexicalV2RuntimeFieldTerms(
	terms: ReadonlySet<string>,
): string[] | undefined {
	const values = [...terms].map((term) => term.trim()).filter((term) => term.length > 0);
	if (values.length === 0) {
		return undefined;
	}
	return [...new Set(values)];
}

function buildCoverageLexicalV2RuntimeTokenSequence(
	reader: CoverageLexicalV2RuntimeStorageReader,
	text: string,
): string[] | undefined {
	const tokenSequence = reader.tokenizeText(text);
	return tokenSequence.length > 0 ? [...tokenSequence] : undefined;
}

function createCoverageLexicalV2RuntimeCandidateFieldMatches(): CoverageLexicalV2RuntimeCandidateFieldMatches {
	return {
		basenameTerms: new Set<string>(),
		aliasTerms: new Set<string>(),
		headingsTerms: new Set<string>(),
		folderTerms: new Set<string>(),
		tagTerms: new Set<string>(),
		bodyTerms: new Set<string>(),
		basenameExactQueryTerms: new Set<string>(),
		aliasExactQueryTerms: new Set<string>(),
		headingsExactQueryTerms: new Set<string>(),
		bodyExactQueryTerms: new Set<string>(),
	};
}

function getOrCreateCoverageLexicalV2RuntimeCandidateFieldMatches(
	target: Map<number, CoverageLexicalV2RuntimeCandidateFieldMatches>,
	docId: number,
): CoverageLexicalV2RuntimeCandidateFieldMatches {
	const existing = target.get(docId);
	if (existing) {
		return existing;
	}
	const created = createCoverageLexicalV2RuntimeCandidateFieldMatches();
	target.set(docId, created);
	return created;
}

function lowerBoundCoverageLexicalV2RuntimeString(
	values: readonly string[],
	target: string,
): number {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (compareCoverageLexicalV2RuntimeStrings(values[middle], target) < 0) {
			low = middle + 1;
			continue;
		}
		high = middle;
	}
	return low;
}

function compareCoverageLexicalV2RuntimeStrings(left: string, right: string): number {
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
}
