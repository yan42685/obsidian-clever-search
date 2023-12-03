import { Client } from "@elastic/elasticsearch";
import type { SearchHitsMetadata } from "@elastic/elasticsearch/lib/api/types";
import * as chokidar from "chokidar";
import { debounce } from "throttle-debounce";
import { inject, singleton } from "tsyringe";
import { PluginManager } from "./plugin-manager";
import { fsUtils, pathUtils } from "./utils/my-lib";

// register <SearchService, singleton> to the container
@singleton()
export class SearchService {
	client: Client;
	watchedPaths: string[];
	targetIndex: string;
	// watch the create, update and delete operations and reIndex corresponding files
	watchers: chokidar.FSWatcher[];

	// @inject(key) get a dependency from the container
	constructor(@inject(PluginManager) pluginManager: PluginManager) {
		// connect to local Elasticsearch server
		this.client = new Client({ node: "http://localhost:9200" });
		this.watchedPaths = pluginManager.watchedPaths;
		this.targetIndex = pluginManager.indexName;

		this.watchers = [];
		console.log("Clever Search start...");
		console.log(this.client);
		console.log("watchedPaths: " + this.watchedPaths);

		const indexFileDebounced: (path: string) => void = debounce(
			3000,
			this.indexFile.bind(this),
		);

		// TODO: 处理重复子目录
		// 监视目录
		this.watchedPaths.forEach((path) => {
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

		this.reIndexAll();
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
						fields: {
							content: {},
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

	indexFile(filepath: string): void {
		const content: string = fsUtils.readFileSync(filepath, "utf8");
		this.client
			.index({
				index: this.targetIndex,
				id: filepath,
				document: {
					path: filepath,
					title: pathUtils.basename(filepath),
					content: content,
				},
			})
			.then(() => {
				console.log(`Indexed file: ${filepath}`);
			})
			.catch((e) => {
				console.error(`Error indexing file ${filepath}:`, e);
			});
	}

	private async createIndex(indexName: any) {
		console.log("hhhhhhhh");
		console.log("hhhhhhhh");
		console.log("hhhhhhhh");
		console.log("hhhhhhhh");

		this.client.indices
			.create({
				index: indexName,
				body: {
					mappings: {
						properties: {
							path: { type: "keyword" },
							title: { type: "text" },
							sentences: {
								type: "nested", // 嵌套类型
								properties: {
									content: { type: "text" },
									start_line: { type: "integer" },
								},
							},
						},
					},
				},
			})
			.then(() => console.log("hhhhhhhh"))
			.catch(() => console.error("nnnnnnnnn"));
	}

	async reIndexAll() {
		// delete current index
		try {
			await this.client.indices.delete({ index: this.targetIndex });
			console.log(`Index [${this.targetIndex}] deleted`);
		} catch (error) {
			console.error(
				`Failed to delete index [${this.targetIndex}]:`,
				error,
			);
		}
		console.log("hhhhhhhh");
		console.log("hhhhhhhh");
		await this.createIndex(this.targetIndex);
		console.log("hhhhhhhh");
		console.log("hhhhhhhh");

		const documents = [
			{
				path: "test1",
				title: "Document 1",
				sentences: [
					{ content: "Sentence 1 of document 1", start_line: 1 },
					{ content: "Sentence 2 of document 1", start_line: 2 },
				],
			},
			{
				path: "test2",
				title: "Document 2",
				sentences: [
					{ content: "Sentence 1 of document 2", start_line: 1 },
					{ content: "Sentence 2 of document 2", start_line: 2 },
				],
			},
		];

		const operations = documents.flatMap(doc => [
				{ index: { _index: this.targetIndex } }, // Include the _id field if you want to specify a unique identifier
				doc
			]);

		const targetPaths = this.watchedPaths;
		const targetIndex = this.targetIndex;
		try {
			// BUG: 别用client.helper.bulk，有BUG ！！！
			const bulkResult = await this.client.bulk({
				refresh: true,
				operations: operations
			});

			console.log(`Reindexing completed:`, bulkResult);
			console.log(`Reindexing completed:`, bulkResult);
			console.log(`Reindexing completed:`, bulkResult);
			console.log(`Reindexing completed:`, bulkResult);
		} catch (error) {
			console.error(`Error during reindexing:`, error);
		}
	}
}

const MAX_BULK_SIZE = 5 * 1024 * 1024; // 5MB







// 下面是正确的client.bulk API使用方式, 不要用  client.helper.bulk

// const client = new Client({ node: "http://localhost:9200" });

// async function run() {
// 	await client.indices.create(
// 		{
// 			index: "tweets",
// 			body: {
// 				mappings: {
// 					properties: {
// 						id: { type: "integer" },
// 						text: { type: "text" },
// 						user: { type: "keyword" },
// 						time: { type: "date" },
// 					},
// 				},
// 			},
// 		},
// 		{ ignore: [400] },
// 	);

// 	const dataset = [
// 		{
// 			id: 1,
// 			text: "If I fall, don't bring me back.",
// 			user: "jon",
// 			date: new Date(),
// 		},
// 		{
// 			id: 2,
// 			text: "Winter is coming",
// 			user: "ned",
// 			date: new Date(),
// 		},
// 		{
// 			id: 3,
// 			text: "A Lannister always pays his debts.",
// 			user: "tyrion",
// 			date: new Date(),
// 		},
// 		{
// 			id: 4,
// 			text: "I am the blood of the dragon.",
// 			user: "daenerys",
// 			date: new Date(),
// 		},
// 		{
// 			id: 5, // change this value to a string to see the bulk response with errors
// 			text: "A girl is Arya Stark of Winterfell. And I'm going home.",
// 			user: "arya",
// 			date: new Date(),
// 		},
// 	];

// 	const operations = dataset.flatMap((doc) => [
// 		{ index: { _index: "tweets" } },
// 		doc,
// 	]);

// 	const bulkResponse = await client.bulk({ refresh: true, operations });

// 	if (bulkResponse.errors) {
// 		const erroredDocuments: any = [];
// 		// The items array has the same order of the dataset we just indexed.
// 		// The presence of the `error` key indicates that the operation
// 		// that we did for the document has failed.
// 		bulkResponse.items.forEach((action: any, i: any) => {
// 			const operation = Object.keys(action)[0];
// 			if (action[operation].error) {
// 				erroredDocuments.push({
// 					// If the status is 429 it means that you can retry the document,
// 					// otherwise it's very likely a mapping error, and you should
// 					// fix the document before to try it again.
// 					status: action[operation].status,
// 					error: action[operation].error,
// 					operation: operations[i * 2],
// 					document: operations[i * 2 + 1],
// 				});
// 			}
// 		});
// 		console.log(erroredDocuments);
// 	}

// 	const count = await client.count({ index: "tweets" });
// 	console.log(count);
// }

// run().catch(console.log);

