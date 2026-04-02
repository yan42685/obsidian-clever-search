import type { AsPlainObject, Options, SearchOptions } from "minisearch";
import MiniSearch from "minisearch";
import type {
	DocumentFields,
	DocumentWeight,
	IndexedDocument,
	MatchedFile,
} from "src/globals/search-types";
import { OuterSetting, innerSetting } from "src/globals/plugin-setting";
import { getInstance } from "src/utils/my-lib";
import { Tokenizer } from "src/services/search/tokenizer";

type DevMiniSearchRequest = {
	queryText: string;
	isPrefixMatch: boolean;
	isFuzzy: boolean;
	maxItemResults: number;
};

export class DevMiniSearchFileEngine {
	readonly backend = "minisearch" as const;
	readonly supportsSerialization = true;

	private readonly outerSetting = getInstance(OuterSetting);
	private readonly inSetting = innerSetting.search;
	private readonly tokenizer = getInstance(Tokenizer);
	private readonly tokenizeIndex = (text: string) =>
		this.tokenizer.tokenize(text, "index");
	private readonly tokenizeSearch = (text: string) =>
		this.tokenizer.tokenize(text, "search");
	private readonly fileIndexOption: Options = {
		tokenize: this.tokenizeIndex,
		idField: "path",
		fields: [
			"basename",
			"aliases",
			"folder",
			"tags",
			"headings",
			"content",
		] as DocumentFields,
		storeFields: ["tags"] as DocumentFields,
		processTerm: (term) =>
			this.outerSetting.isCaseSensitive ? term : term.toLocaleLowerCase(),
	};

	private filesIndex = new MiniSearch(this.fileIndexOption);

	async reIndexAll(data: IndexedDocument[] | AsPlainObject): Promise<boolean> {
		this.clearIndex();
		if (Array.isArray(data)) {
			await this.addDocuments(data);
			return true;
		}
		this.filesIndex = MiniSearch.loadJS(data, this.fileIndexOption);
		return true;
	}

	clearIndex(): void {
		this.filesIndex.removeAll();
	}

	async addDocuments(documents: IndexedDocument[]): Promise<void> {
		const paths = documents.map((document) => document.path);
		const existingPaths = paths.filter((path) => this.filesIndex.has(path));
		if (existingPaths.length > 0) {
			this.filesIndex.discardAll(existingPaths);
		}
		await this.filesIndex.addAllAsync(documents, {
			chunkSize: 100,
		});
	}

	deleteDocuments(paths: string[]): void {
		const existingPaths = paths.filter((path) => this.filesIndex.has(path));
		if (existingPaths.length > 0) {
			this.filesIndex.discardAll(existingPaths);
		}
	}

	async searchFiles(request: DevMiniSearchRequest): Promise<MatchedFile[]> {
		return this.filesIndex
			.search(request.queryText, this.buildFileSearchOption(request))
			.slice(0, request.maxItemResults)
			.map((item) => ({
				path: String(item.id),
				queryTerms: item.queryTerms,
				matchedTerms: item.terms,
				score: item.score,
			}));
	}

	serialize(): AsPlainObject {
		return this.filesIndex.toJSON();
	}

	private buildFileSearchOption(request: DevMiniSearchRequest): SearchOptions {
		return {
			tokenize: this.tokenizeSearch,
			prefix: (term) =>
				request.isPrefixMatch
					? term.length >= this.inSetting.minTermLengthForPrefixSearch
					: false,
			fuzzy: (term) =>
				request.isFuzzy
					? term.length <= 3
						? 0
						: this.inSetting.fuzzyProportion
					: false,
			boost: {
				basename: this.inSetting.weightFilename,
				aliases: this.inSetting.weightFilename,
				folder: this.inSetting.weightFolder,
				tags: this.inSetting.weightTagText,
				headings: this.inSetting.weightHeading,
			} as DocumentWeight,
			combineWith: "and",
		};
	}
}
