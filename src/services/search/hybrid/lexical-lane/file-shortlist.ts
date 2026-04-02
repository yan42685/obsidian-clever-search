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
		maxItemResults: params.limit,
	});

	return matchedFiles.map((match, index) => {
		const file = dataProvider.getFileByPath(match.path);
		const metadata = file ? app.metadataCache.getFileCache(file) : null;
		const aliases = parseFrontMatterAliases(metadata?.frontmatter) || [];
		const headings = metadata?.headings?.map((heading) => heading.heading) || [];
		return {
			filePath: match.path,
			fileScore: match.score ?? 0,
			fileRank: index,
			basename: FileUtil.getBasename(match.path),
			metadataSignals: buildMetadataSignals({
				queryText,
				path: match.path,
				aliases,
				headings,
			}),
		};
	});
}

function buildMetadataSignals(params: {
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
