import { Client } from "@elastic/elasticsearch";
import { SearchHitsMetadata } from "@elastic/elasticsearch/lib/api/types";
import * as chokidar from "chokidar";
import * as fs from "fs";
import * as pathUtils from "path";
import { throttle } from "throttle-debounce";
import { PluginStates } from "./plugin-states";

export class SearchService {
	client: Client;
	pluginStates: PluginStates;
	// watch the create, update and delete operations and reIndex corresponding files
	watchers: chokidar.FSWatcher[];

	constructor(pluginStates: PluginStates) {
		// connect to local Elasticsearch server
		this.client = new Client({ node: "http://localhost:9200" });
		this.pluginStates = pluginStates;
		this.watchers = [];
		console.log("Clever Search start...");
		console.log(this.client);
		console.log("watchedPaths: " + pluginStates.getWatchedPaths());

		const indexFileThrottled: (path: string) => void = throttle(
			1000,
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
				.on("add", (path) => indexFileThrottled(path))
				.on("change", (path) => indexFileThrottled(path));
			this.watchers.push(watcher);
		});

		// 搜索功能
		const search = async (query: string): Promise<any> => {
			try {
				const result: any = await this.client.search({
					index: "markdown_files",
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
		search("ignore").then((result) => {
			console.log("raw result: ", result);
			console.log(
				"search result:",
				result.hits.hits as SearchHitsMetadata[]
			);
		});
		this.client.indices
			.delete({ index: "markdown_files" })
			.then((res) => console.log("index [markdown_files}] deleted"))
			.catch((e) => console.log("delete index failed!"));
	}

	indexFile(filePath: string): void {
		const content: string = fs.readFileSync(filePath, "utf8");
		this.client
			.index({
				index: "markdown_files",
				id: pathUtils.basename(filePath),
				document: {
					path: filePath,
					content: content,
				},
			})
			.then(() => {
				console.log(`Indexed file: ${filePath}`);
			})
			.catch((e) => {
				console.error(`Error indexing file ${filePath}:`, e);
			});
	}
}
