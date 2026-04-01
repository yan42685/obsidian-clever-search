import {
	App,
	TFile,
	Vault,
	parseFrontMatterAliases,
	type CachedMetadata,
} from "obsidian";
import { THIS_PLUGIN } from "src/globals/constants";
import { OuterSetting } from "src/globals/plugin-setting";
import type CleverSearch from "src/main";
import {
	createLightweightFuzzyIndex,
	matchLightweightFuzzy,
	prepareLightweightFuzzyQuery,
} from "src/services/search/lightweight-fuzzy-matcher";
import { FileUtil } from "src/utils/file-util";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { DataProvider } from "./data-provider";

export type SearchAutocompleteSource =
	| "file"
	| "alias"
	| "heading"
	| "path"
	| "recent";

export type SearchAutocompleteCandidate = {
	id: string;
	kind: SearchAutocompleteSource;
	insertText: string;
	primaryText: string;
	secondaryText?: string;
	path: string;
	positions: number[];
	score: number;
};

type IndexedAutocompleteEntry = {
	id: string;
	kind: Exclude<SearchAutocompleteSource, "recent">;
	insertText: string;
	primaryText: string;
	secondaryText?: string;
	path: string;
	textIndex: ReturnType<typeof createLightweightFuzzyIndex>;
};

@singleton()
export class SearchAutocompleteService {
	private static readonly MAX_CANDIDATE_COUNT = 12;
	private static readonly RECENT_FILE_LIMIT = 10;
	private readonly plugin: CleverSearch = getInstance(THIS_PLUGIN);
	private readonly app = getInstance(App);
	private readonly vault = getInstance(Vault);
	private readonly setting = getInstance(OuterSetting);
	private readonly dataProvider = getInstance(DataProvider);
	private indexedEntriesCache: IndexedAutocompleteEntry[] | null = null;

	constructor() {
		this.registerInvalidationEvents();
	}

	isEnabled(): boolean {
		const sources = this.setting.searchHistory.sources;
		return (
			sources.file ||
			sources.alias ||
			sources.heading ||
			sources.path ||
			sources.recentFile
		);
	}

	getNavigationSuggestions(
		queryText: string,
		limit = SearchAutocompleteService.MAX_CANDIDATE_COUNT,
	): SearchAutocompleteCandidate[] {
		if (!this.isEnabled()) {
			return [];
		}

		const preparedQuery = prepareLightweightFuzzyQuery(queryText);
		if (preparedQuery.normalizedQuery.length === 0) {
			return this.setting.searchHistory.sources.recentFile
				? this.buildRecentFileCandidates("").slice(0, limit)
				: [];
		}

		const queryLooksPathLike = this.isPathLikeQuery(preparedQuery.normalizedQuery);
		const candidates: SearchAutocompleteCandidate[] = [];

		for (const entry of this.getIndexedEntries()) {
			if (!this.isSourceEnabled(entry.kind)) {
				continue;
			}
			const match = matchLightweightFuzzy(preparedQuery, entry.textIndex);
			if (!match) {
				continue;
			}
			candidates.push({
				id: entry.id,
				kind: entry.kind,
				insertText: entry.insertText,
				primaryText: entry.primaryText,
				secondaryText: entry.secondaryText,
				path: entry.path,
				positions: match.positions,
				score:
					match.score +
					this.getSourceBoost(entry.kind, queryLooksPathLike) +
					(this.startsWithQuery(entry.insertText, preparedQuery.normalizedQuery)
						? 140
						: 0),
			});
		}

		if (this.setting.searchHistory.sources.recentFile) {
			candidates.push(
				...this.buildRecentFileCandidates(preparedQuery.normalizedQuery),
			);
		}

		return this.sortAndTrimCandidates(candidates, limit);
	}

	private registerInvalidationEvents(): void {
		this.plugin.registerEvent(
			this.vault.on("create", () => this.invalidateCache()),
		);
		this.plugin.registerEvent(
			this.vault.on("delete", () => this.invalidateCache()),
		);
		this.plugin.registerEvent(
			this.vault.on("rename", () => this.invalidateCache()),
		);
		this.plugin.registerEvent(
			this.app.metadataCache.on("changed", () => this.invalidateCache()),
		);
		this.plugin.registerEvent(
			this.app.metadataCache.on("resolved", () => this.invalidateCache()),
		);
	}

	private getIndexedEntries(): IndexedAutocompleteEntry[] {
		if (this.indexedEntriesCache) {
			return this.indexedEntriesCache;
		}

		const entries: IndexedAutocompleteEntry[] = [];
		for (const file of this.dataProvider.allFilesToBeIndexed()) {
			entries.push(...this.buildEntriesForFile(file));
		}
		this.indexedEntriesCache = entries;
		return entries;
	}

	private buildEntriesForFile(file: TFile): IndexedAutocompleteEntry[] {
		const entries: IndexedAutocompleteEntry[] = [];
		const metadata = this.app.metadataCache.getFileCache(file);
		const basename = file.basename.trim();
		const path = file.path;
		const folderPath = FileUtil.getFolderPath(path);

		entries.push(
			this.createIndexedEntry({
				kind: "file",
				insertText: basename,
				primaryText: basename,
				secondaryText: path,
				path,
			}),
		);

		entries.push(
			this.createIndexedEntry({
				kind: "path",
				insertText: path,
				primaryText: path,
				secondaryText: basename,
				path,
			}),
		);

		for (const alias of this.extractAliases(metadata, basename)) {
			entries.push(
				this.createIndexedEntry({
					kind: "alias",
					insertText: alias,
					primaryText: alias,
					secondaryText: `${basename} / ${folderPath}`,
					path,
				}),
			);
		}

		for (const heading of this.extractHeadings(metadata)) {
			entries.push(
				this.createIndexedEntry({
					kind: "heading",
					insertText: heading,
					primaryText: heading,
					secondaryText: `${basename} / ${folderPath}`,
					path,
				}),
			);
		}

		return entries;
	}

	private buildRecentFileCandidates(
		normalizedQuery: string,
	): SearchAutocompleteCandidate[] {
		const preparedQuery =
			normalizedQuery.length > 0
				? prepareLightweightFuzzyQuery(normalizedQuery)
				: null;
		const candidates: SearchAutocompleteCandidate[] = [];

		this.app.workspace
			.getLastOpenFiles()
			.slice(0, SearchAutocompleteService.RECENT_FILE_LIMIT)
			.forEach((path, index) => {
				const file = this.dataProvider.getFileByPath(path);
				if (!(file instanceof TFile) || !this.dataProvider.isIndexable(file)) {
					return;
				}

				const match = preparedQuery
					? matchLightweightFuzzy(
							preparedQuery,
							createLightweightFuzzyIndex(file.basename),
						)
					: { positions: [], score: 0 };
				if (!match) {
					return;
				}

				candidates.push({
					id: `recent:${path}`,
					kind: "recent",
					insertText: file.basename,
					primaryText: file.basename,
					secondaryText: path,
					path,
					positions: match.positions,
					score:
						match.score +
						this.getSourceBoost("recent", false) +
						(SearchAutocompleteService.RECENT_FILE_LIMIT - index) * 18,
				});
			});

		return candidates;
	}

	private sortAndTrimCandidates(
		candidates: SearchAutocompleteCandidate[],
		limit: number,
	): SearchAutocompleteCandidate[] {
		const sorted = [...candidates].sort((left, right) => {
			if (left.score !== right.score) {
				return right.score - left.score;
			}
			const priorityDiff =
				this.getKindPriority(right.kind) - this.getKindPriority(left.kind);
			if (priorityDiff !== 0) {
				return priorityDiff;
			}
			return left.primaryText.localeCompare(right.primaryText);
		});

		const deduped: SearchAutocompleteCandidate[] = [];
		const seen = new Set<string>();
		for (const candidate of sorted) {
			const key = this.getDedupKey(candidate);
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			deduped.push(candidate);
			if (deduped.length >= limit) {
				break;
			}
		}
		return deduped;
	}

	private isSourceEnabled(kind: IndexedAutocompleteEntry["kind"]): boolean {
		switch (kind) {
			case "file":
				return this.setting.searchHistory.sources.file;
			case "alias":
				return this.setting.searchHistory.sources.alias;
			case "heading":
				return this.setting.searchHistory.sources.heading;
			case "path":
				return this.setting.searchHistory.sources.path;
		}
	}

	private getSourceBoost(
		kind: SearchAutocompleteSource,
		queryLooksPathLike: boolean,
	): number {
		switch (kind) {
			case "recent":
				return 300;
			case "file":
				return 250;
			case "alias":
				return 230;
			case "heading":
				return 210;
			case "path":
				return queryLooksPathLike ? 320 : 140;
		}
	}

	private getKindPriority(kind: SearchAutocompleteSource): number {
		switch (kind) {
			case "recent":
				return 5;
			case "file":
				return 4;
			case "alias":
				return 3;
			case "heading":
				return 2;
			case "path":
				return 1;
		}
	}

	private getDedupKey(candidate: SearchAutocompleteCandidate): string {
		switch (candidate.kind) {
			case "recent":
			case "file":
				return `file:${candidate.path}`;
			case "path":
				return `path:${candidate.path}`;
			case "alias":
				return `alias:${candidate.path}:${normalizeKey(candidate.primaryText)}`;
			case "heading":
				return `heading:${candidate.path}:${normalizeKey(candidate.primaryText)}`;
		}
	}

	private createIndexedEntry(
		entry: Omit<IndexedAutocompleteEntry, "id" | "textIndex">,
	): IndexedAutocompleteEntry {
		return {
			...entry,
			id: `${entry.kind}:${entry.path}:${normalizeKey(entry.primaryText)}`,
			textIndex: createLightweightFuzzyIndex(entry.primaryText),
		};
	}

	private extractAliases(
		metadata: CachedMetadata | null,
		basename: string,
	): string[] {
		const aliases = parseFrontMatterAliases(metadata?.frontmatter) || [];
		return dedupeTexts(aliases).filter(
			(alias) => normalizeKey(alias) !== normalizeKey(basename),
		);
	}

	private extractHeadings(metadata: CachedMetadata | null): string[] {
		return dedupeTexts(
			(metadata?.headings ?? []).map((heading) => heading.heading),
		);
	}

	private startsWithQuery(insertText: string, normalizedQuery: string): boolean {
		return normalizeKey(insertText).startsWith(normalizedQuery);
	}

	private isPathLikeQuery(query: string): boolean {
		return /[\\/]|(?:^|\s)(?:path:|folder:)/iu.test(query);
	}

	private invalidateCache(): void {
		this.indexedEntriesCache = null;
	}
}

function dedupeTexts(values: string[]): string[] {
	const seen = new Set<string>();
	const deduped: string[] = [];
	for (const value of values) {
		const normalized = normalizeKey(value);
		if (!normalized || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		deduped.push(value.replace(/\s+/g, " ").trim());
	}
	return deduped;
}

function normalizeKey(text: string): string {
	return text.trim().toLocaleLowerCase();
}