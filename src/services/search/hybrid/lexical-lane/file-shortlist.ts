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
		resolveMetadata: (path) => {
			const file = dataProvider.getFileByPath(path);
			const metadata = file ? app.metadataCache.getFileCache(file) : null;
			return {
				aliases: parseFrontMatterAliases(metadata?.frontmatter) || [],
				headings: metadata?.headings?.map((heading) => heading.heading) || [],
			};
		},
	});
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
	return {
		basenameExact: basename === normalizedQuery,
		basenamePrefix: basename.startsWith(normalizedQuery),
		pathExact: path === normalizedQuery,
		pathPrefix: path.startsWith(normalizedQuery),
		headingMetaHit: params.headings.some((heading) =>
			normalizeKey(heading).includes(normalizedQuery),
		),
		aliasHit: params.aliases.some((alias) =>
			normalizeKey(alias).includes(normalizedQuery),
		),
	};
}

function normalizeKey(text: string): string {
	return text.trim().toLocaleLowerCase();
}

function computeHybridLexicalLaneFileCandidateScore(
	candidate: HybridLexicalLaneFileCandidate,
): number {
	const metadata = candidate.metadataSignals;
	return (
		Math.log1p(Math.max(0, candidate.fileScore)) * 44 +
		(metadata.basenameExact ? 260 : 0) +
		(metadata.basenamePrefix ? 132 : 0) +
		(metadata.pathExact ? 72 : 0) +
		(metadata.pathPrefix ? 28 : 0) +
		(metadata.headingMetaHit ? 40 : 0) +
		(metadata.aliasHit ? 34 : 0)
	);
}
