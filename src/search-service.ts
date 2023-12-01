import { Client } from "@elastic/elasticsearch";
import { SearchHitsMetadata } from "@elastic/elasticsearch/lib/api/types";
import * as chokidar from "chokidar";
import * as fs from "fs";
import * as path from "path";
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

		// TODO: 处理重复子目录
		// 监视目录
		pluginStates.getWatchedPaths().forEach((dirPath) => {
			// chokidar.watch() will return a new instance every time when called
			const watcher = chokidar
				.watch(dirPath + "*.md", {
					persistent: true,
					ignored: ["./obsidian/**"],
				})
				.on("add", (filePath: string) => this.indexFile(filePath))
				.on("change", (filePath: string) => this.indexFile(filePath));
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
		search("software").then((result) => {
			console.log("raw result: ", result);
			console.log("search result:", result.hits.hits as SearchHitsMetadata[]);
		});
	}

	async indexFile(filePath: string): Promise<void> {
		try {
			const content: string = fs.readFileSync(filePath, "utf8");
			await this.client.index({
				index: "markdown_files",
				id: path.basename(filePath),
				document: {
					path: filePath,
					content: content,
				},
			});
			console.log(`Indexed file: ${filePath}`);
		} catch (error) {
			console.error(`Error indexing file ${filePath}:`, error);
		}
	}
}
