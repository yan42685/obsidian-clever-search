import { Client } from "@elastic/elasticsearch";
import type { SearchHitsMetadata } from "@elastic/elasticsearch/lib/api/types";
import * as chokidar from "chokidar";
import { debounce } from "throttle-debounce";
import { inject, singleton } from "tsyringe";
import { fsUtils, pathUtils } from "./my-lib";
import { PluginManager } from "./plugin-manager";

// register <SearchService, singleton> to the container
@singleton()
export class SearchService {
	client: Client;
	targetIndex: string;
	// watch the create, update and delete operations and reIndex corresponding files
	watchers: chokidar.FSWatcher[];

	// @inject(key) get a dependency from the container
	constructor(@inject(PluginManager) pluginStates: PluginManager) {
		// connect to local Elasticsearch server
		this.client = new Client({ node: "http://localhost:9200" });
		this.targetIndex = pluginStates.getIndexName();
		this.watchers = [];
		console.log("Clever Search start...");
		console.log(this.client);
		console.log("watchedPaths: " + pluginStates.getWatchedPaths());

		const indexFileDebounced: (path: string) => void = debounce(
			3000,
			this.indexFile.bind(this),
		);

		// TODO: 处理重复子目录
		// 监视目录
		pluginStates.getWatchedPaths().forEach((path) => {
			// chokidar.watch() will return a new instance every time when called
			const watcher = chokidar
				.watch(path, {
					persistent: true,
				})
				.on("add", (path) => indexFileDebounced(path))
				.on("change", (path) => indexFileDebounced(path));
			this.watchers.push(watcher);
		});

		// 使用示例
		this.search("hello").then((result) => {
			console.log("raw result: ", result);
			console.log(
				"search result:",
				result.hits.hits as SearchHitsMetadata[],
			);
		});
	}
	async search(query: string): Promise<any> {
		console.log("perform a search");
		try {
			const result: any = await this.client.search({
				index: this.targetIndex,
				body: {
					query: {
						multi_match: {
							// Use the multi_match query for semantic search
							query: query,
							fields: ["content", "title^2"], // Boost the title field
							fuzziness: "AUTO", // Enable fuzzy matching
							operator: "and", // Use 'and' operator to ensure all words must be present
						},
					},
					highlight: {
						// Highlighting settings
						fields: {
							content: {}, // Highlight matches in the content field
						},
					},
				},
			});
			return result;
		} catch (error) {
			console.error(`Error during search:`, error);
			return [];
		}
	}

	indexFile(path: string): void {
		const content: string = fsUtils.readFileSync(path, "utf8");
		this.client
			.index({
				index: this.targetIndex,
				id: path,
				document: {
					path: path,
					title: pathUtils.basename(path),
					content: content,
				},
			})
			.then(() => {
				console.log(`Indexed file: ${path}`);
			})
			.catch((e) => {
				console.error(`Error indexing file ${path}:`, e);
			});
	}

	// TODO: finish it
	reIndexAll() {
		this.client.indices
			.delete({ index: this.targetIndex })
			.then((res) => console.log(`index [${this.targetIndex}] deleted`))
			.catch((e) =>
				console.error(`delete index [${this.targetIndex}] failed!`),
			);
	}
}
