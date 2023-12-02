import { Client } from "@elastic/elasticsearch";
import { SearchHitsMetadata } from "@elastic/elasticsearch/lib/api/types";
import * as chokidar from "chokidar";
import { debounce } from "throttle-debounce";
import { fsUtils, pathUtils } from "./my-lib";
import { PluginStates } from "./plugin-states";

export class SearchService {
	pluginStates: PluginStates;
	client: Client;
	targetIndex: string;
	// watch the create, update and delete operations and reIndex corresponding files
	watchers: chokidar.FSWatcher[];

	constructor(pluginStates: PluginStates) {
		this.pluginStates = pluginStates;
		// connect to local Elasticsearch server
		this.client = new Client({ node: "http://localhost:9200" });
		this.targetIndex = pluginStates.getIndexName();
		this.watchers = [];
		console.log("Clever Search start...");
		console.log(this.client);
		console.log("watchedPaths: " + pluginStates.getWatchedPaths());

		const indexFileDebounced: (path: string) => void = debounce(
			3000,
			this.indexFile.bind(this)
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
		

		// 搜索功能
		const search = async (query: string): Promise<any> => {
			try {
				const result: any = await this.client.search({
					index: this.targetIndex,
					query: {
						match: {
							content: query,
						},
					},
				});
				return result;
			} catch (error) {
				console.error(`Error during search:`, error);
				return [];
			}
		};


		// 使用示例
		search("hello").then((result) => {
			console.log("raw result: ", result);
			console.log(
				"search result:",
				result.hits.hits as SearchHitsMetadata[]
			);
		});
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
			.catch((e) => console.error(`delete index [${this.targetIndex}] failed!`));
	}
}
