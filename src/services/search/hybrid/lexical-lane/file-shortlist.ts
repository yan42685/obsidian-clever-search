import { App, parseFrontMatterAliases } from "obsidian";
import { OuterSetting } from "src/globals/plugin-setting";
import { FileUtil } from "src/utils/file-util";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { FileSearchEngineFactory } from "../../file-search-engine";
import { DataProvider } from "src/services/obsidian/user-data/data-provider";
import type { HybridLexicalLaneFileCandidate } from "./contracts";

export async function buildHybridLexicalLaneFileShortlist(params: {
	queryText: string;
	limit: number;
}): Promise<HybridLexicalLaneFileCandidate[]> {
	const queryText = params.queryText.trim();
	if (queryText.length === 0 || params.limit <= 0) {
		return [];
	}

	const setting = getInstance(OuterSetting);
	const fileEngine = getInstance(FileSearchEngineFactory).getActiveEngine();
	const app = getInstance(App);
	const dataProvider = getInstance(DataProvider);
	if (fileEngine.backend !== "coverage-lexical") {
		logger.warn(
			`hybrid lexical lane is using ${fileEngine.backend} for shortlist fallback because coverage-lexical is not the active file backend.`,
		);
	}
	const matchedFiles = await fileEngine.searchFiles({
		queryText,
		isPrefixMatch: setting.isPrefixMatch,
		isFuzzy: setting.isFuzzy,
		hideWeaklyRelatedResults: setting.hideWeaklyRelatedResults,
		weakFilePruneMode: setting.weakFilePruneMode,
		maxItemResults: Math.max(params.limit, params.limit * 3),
	});

	return buildHybridLexicalLaneFileCandidates({
		queryText,
		limit: params.limit,
		matches: matchedFiles.map((match, index) => ({
			path: match.path,
			score: match.score ?? 0,
			rank: index,
		})),
		resolveMetadata: (path) =>
			resolveHybridLexicalLaneFileMetadata(path, {
				app,
				dataProvider,
			}),
	});
}

export function resolveHybridLexicalLaneFileMetadata(
	path: string,
	deps: {
		app?: App;
		dataProvider?: DataProvider;
	} = {},
): { aliases: readonly string[]; headings: readonly string[] } {
	const app = deps.app ?? getInstance(App);
	const dataProvider = deps.dataProvider ?? getInstance(DataProvider);
	const file = dataProvider.getFileByPath(path);
	const metadata = file ? app.metadataCache.getFileCache(file) : null;
	return {
		aliases: parseFrontMatterAliases(metadata?.frontmatter) || [],
		headings: metadata?.headings?.map((heading) => heading.heading) || [],
	};
}

export function buildHybridLexicalLaneFileCandidates(params: {
	queryText: string;
	limit?: number;
	matches: ReadonlyArray<{
		path: string;
		score?: number;
		rank?: number;
	}>;
	resolveMetadata?: (
		path: string,
	) => { aliases?: readonly string[]; headings?: readonly string[] } | null;
}): HybridLexicalLaneFileCandidate[] {
	const reranked = params.matches
		.map((match, index) => {
			const metadata = params.resolveMetadata?.(match.path) ?? null;
			const aliases = metadata?.aliases ?? [];
			const headings = metadata?.headings ?? [];
			return {
				filePath: match.path,
				fileScore: match.score ?? 0,
				fileRank: match.rank ?? index,
				basename: FileUtil.getBasename(match.path),
				metadataSignals: buildHybridLexicalLaneMetadataSignals({
					queryText: params.queryText,
					path: match.path,
					aliases,
					headings,
				}),
				metadataValues: {
					aliases: [...aliases],
					headings: [...headings],
				},
			};
		})
		.sort((left, right) => {
			const scoreDiff =
				computeHybridLexicalLaneFileCandidateScore(right) -
				computeHybridLexicalLaneFileCandidateScore(left);
			if (scoreDiff !== 0) {
				return scoreDiff;
			}
			if (left.fileRank !== right.fileRank) {
				return left.fileRank - right.fileRank;
			}
			return left.filePath.localeCompare(right.filePath);
		})
		.map((candidate, index) => ({
			...candidate,
			fileRank: index,
		}));
	return reranked.slice(0, params.limit ?? reranked.length);
}

export function buildHybridLexicalLaneMetadataSignals(params: {
	queryText: string;
	path: string;
	aliases: readonly string[];
	headings: readonly string[];
}) {
	const normalizedQuery = normalizeKey(params.queryText);
	const basename = normalizeKey(FileUtil.getBasename(params.path));
	const path = normalizeKey(params.path);
	const queryTokens = tokenizeNavigationTokens(params.queryText);
	const queryAnchorTokens = extractStructuredAnchorTokens(params.queryText);
	const basenameTokens = tokenizeNavigationTokens(FileUtil.getBasename(params.path));
	const pathSegments = params.path.split("/");
	const pathTokens = pathSegments
		.flatMap((segment) => tokenizeNavigationTokens(segment));
	const pathAnchorTokens = pathSegments
		.flatMap((segment) => extractStructuredAnchorTokens(segment));
	const pathRootAnchorTokens = extractStructuredAnchorTokens(pathSegments[0] ?? "");
	const normalizedRootSegment = normalizeKey(pathSegments[0] ?? "");
	const folderTokens = pathSegments
		.slice(0, -1)
		.flatMap((segment) => tokenizeNavigationTokens(segment));
	const normalizedHeadings = params.headings.map(normalizeKey);
	const normalizedAliases = params.aliases.map(normalizeKey);
	const headingExactCount = normalizedHeadings.filter(
		(heading) => heading === normalizedQuery,
	).length;
	const headingPrefixCount = normalizedHeadings.filter(
		(heading) => heading !== normalizedQuery && heading.startsWith(normalizedQuery),
	).length;
	const headingContainedInQueryCount = normalizedHeadings.filter((heading) =>
		isMeaningfullyContainedInQuery(normalizedQuery, heading),
	).length;
	const aliasExactCount = normalizedAliases.filter(
		(alias) => alias === normalizedQuery,
	).length;
	const aliasPrefixCount = normalizedAliases.filter(
		(alias) => alias !== normalizedQuery && alias.startsWith(normalizedQuery),
	).length;
	const aliasContainedInQueryCount = normalizedAliases.filter((alias) =>
		isMeaningfullyContainedInQuery(normalizedQuery, alias),
	).length;
	const headingTokenCoverageCount = computeBestMetadataTokenCoverage(
		queryTokens,
		params.headings,
	);
	const aliasTokenCoverageCount = computeBestMetadataTokenCoverage(
		queryTokens,
		params.aliases,
	);
	return {
		basenameExact: basename === normalizedQuery,
		basenamePrefix: basename.startsWith(normalizedQuery),
		basenameContainedInQuery: isMeaningfullyContainedInQuery(
			normalizedQuery,
			basename,
		),
		basenameTokenCoverageCount: countNavigationTokenMatches(
			queryTokens,
			basenameTokens,
		),
		pathExact: path === normalizedQuery,
		pathPrefix: path.startsWith(normalizedQuery),
		pathTokenCoverageCount: countNavigationTokenMatches(queryTokens, pathTokens),
		pathAnchorCoverageCount: countNavigationTokenMatches(
			queryAnchorTokens,
			pathAnchorTokens,
		),
		pathRootAnchorCoverageCount: countNavigationTokenMatches(
			queryAnchorTokens,
			pathRootAnchorTokens,
		),
		pathRootAnchorExact: queryAnchorTokens.some(
			(anchorToken) => anchorToken === normalizedRootSegment,
		),
		folderHintCount: countNavigationTokenMatches(queryTokens, folderTokens),
		templateFolderHit:
			queryTokens.includes("template") && /(^|\/)templates?\//u.test(params.path),
		archivePenaltyEligible:
			path.includes("/archive/") &&
			!queryTokens.some((token) => token === "archive"),
		headingMetaHit: normalizedHeadings.some((heading) =>
			heading.includes(normalizedQuery),
		),
		headingExactCount,
		headingPrefixCount,
		headingContainedInQueryCount,
		headingTokenCoverageCount,
		aliasHit: normalizedAliases.some((alias) =>
			alias.includes(normalizedQuery),
		),
		aliasExactCount,
		aliasPrefixCount,
		aliasContainedInQueryCount,
		aliasTokenCoverageCount,
	};
}

function normalizeKey(text: string): string {
	return text.trim().toLocaleLowerCase();
}

function tokenizeNavigationTokens(text: string): string[] {
	const normalized = normalizeKey(text);
	const rawTokens = normalized
		.split(/[^a-z0-9\p{Script=Han}]+/u)
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
	const tokens = rawTokens
		.map((token) => singularizeToken(token))
		.filter((token) => token.length >= 4 || /^\p{Script=Han}$/u.test(token));
	return Array.from(new Set(tokens));
}

function extractStructuredAnchorTokens(text: string): string[] {
	const normalized = normalizeKey(text);
	const anchors = normalized.match(/[a-z0-9]{2,}(?:[-_][a-z0-9]{2,})+/gu) ?? [];
	return Array.from(new Set(anchors));
}

function singularizeToken(token: string): string {
	if (token.endsWith("ies") && token.length > 3) {
		return `${token.slice(0, -3)}y`;
	}
	if (token.endsWith("s") && token.length > 4) {
		return token.slice(0, -1);
	}
	return token;
}

function countNavigationTokenMatches(
	queryTokens: readonly string[],
	candidateTokens: readonly string[],
): number {
	const uniqueQueryTokens = Array.from(new Set(queryTokens));
	let count = 0;
	for (const queryToken of uniqueQueryTokens) {
		if (
			candidateTokens.some(
				(candidateToken) => navigationTokensMatch(queryToken, candidateToken),
			)
		) {
			count += 1;
		}
	}
	return count;
}

function computeBestMetadataTokenCoverage(
	queryTokens: readonly string[],
	values: readonly string[],
): number {
	let bestCoverage = 0;
	for (const value of values) {
		const coverage = countNavigationTokenMatches(
			queryTokens,
			tokenizeNavigationTokens(value),
		);
		if (coverage > bestCoverage) {
			bestCoverage = coverage;
		}
	}
	return bestCoverage;
}

function navigationTokensMatch(queryToken: string, candidateToken: string): boolean {
	const queryForms = buildComparableTokenForms(queryToken);
	const candidateForms = buildComparableTokenForms(candidateToken);
	for (const left of queryForms) {
		for (const right of candidateForms) {
			if (
				left === right ||
				left.startsWith(right) ||
				right.startsWith(left)
			) {
				return true;
			}
		}
	}
	return false;
}

function buildComparableTokenForms(token: string): string[] {
	const forms = new Set<string>();
	const normalized = singularizeToken(token.trim());
	if (!normalized) {
		return [];
	}
	forms.add(normalized);
	if (normalized.endsWith("e") && normalized.length > 5) {
		forms.add(normalized.slice(0, -1));
	}
	if (normalized.endsWith("ing") && normalized.length > 6) {
		const stem = normalized.slice(0, -3);
		forms.add(stem);
		forms.add(`${stem}e`);
	}
	if (normalized.endsWith("ed") && normalized.length > 5) {
		const stem = normalized.slice(0, -2);
		forms.add(stem);
		forms.add(`${stem}e`);
	}
	return [...forms].filter((form) => form.length > 0);
}

function isMeaningfullyContainedInQuery(
	normalizedQuery: string,
	normalizedValue: string,
): boolean {
	if (!normalizedValue || normalizedValue === normalizedQuery) {
		return false;
	}
	const valueTokens = tokenizeNavigationTokens(normalizedValue);
	if (valueTokens.length < 2 && normalizedValue.length < 10) {
		return false;
	}
	return normalizedQuery.includes(normalizedValue);
}

function computeHybridLexicalLaneFileCandidateScore(
	candidate: HybridLexicalLaneFileCandidate,
): number {
	const metadata = candidate.metadataSignals;
	return (
		Math.log1p(Math.max(0, candidate.fileScore)) * 44 +
		Math.max(0, 8 - candidate.fileRank) * 18 +
		(metadata.basenameExact ? 260 : 0) +
		(metadata.basenamePrefix ? 132 : 0) +
		(metadata.basenameContainedInQuery ? 44 : 0) +
		metadata.basenameTokenCoverageCount * 18 +
		(metadata.pathExact ? 72 : 0) +
		(metadata.pathPrefix ? 28 : 0) +
		metadata.pathTokenCoverageCount * 6 +
		metadata.pathAnchorCoverageCount * 240 +
		metadata.pathRootAnchorCoverageCount * 180 +
		(metadata.pathRootAnchorExact ? 220 : 0) +
		metadata.folderHintCount * 34 +
		(metadata.templateFolderHit ? 220 : 0) -
		(metadata.archivePenaltyEligible ? 36 : 0) +
		(metadata.headingMetaHit ? 40 : 0) +
		metadata.headingExactCount * 120 +
		metadata.headingPrefixCount * 44 +
		metadata.headingContainedInQueryCount * 52 +
		metadata.headingTokenCoverageCount * 14 +
		(metadata.aliasHit ? 34 : 0) +
		metadata.aliasExactCount * 88 +
		metadata.aliasPrefixCount * 36 +
		metadata.aliasContainedInQueryCount * 96 +
		metadata.aliasTokenCoverageCount * 22
	);
}
