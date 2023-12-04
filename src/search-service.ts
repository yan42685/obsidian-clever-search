import { Client } from "@elastic/elasticsearch";
import type { SearchHitsMetadata } from "@elastic/elasticsearch/lib/api/types";
import * as chokidar from "chokidar";
// one two three   speed ↓ accuracy ↑
import nlp from "compromise/two";
import { debounce } from "throttle-debounce";
import { inject, singleton } from "tsyringe";
import { PluginManager } from "./plugin-manager";
import { logger } from "./utils/logger";
import {
	FileExtension,
	fsUtils,
	getAllFiles,
	monitorExecution,
	pathUtils
} from "./utils/my-lib";

// register <SearchService, singleton> to the container
@singleton()
export class SearchService {
	client: Client;
	watchedPaths: string[];
	targetIndex: string;
	// watch the create, update and delete operations and reIndex corresponding files
	watchers: chokidar.FSWatcher[] = [];

	// @inject(key) get a dependency from the container
	constructor(@inject(PluginManager) pluginManager: PluginManager) {
		// connect to local Elasticsearch server
		this.client = new Client({ node: "http://localhost:9200" });
		this.watchedPaths = pluginManager.watchedPaths;
		this.targetIndex = pluginManager.indexName;
	}

	async testProcedure() {
		console.log("Clever Search start...");
		console.log(this.client);
		console.log("watchedPaths: " + this.watchedPaths);

		this.startFileWatchers();
		// this.deleteIndex(this.targetIndex);
		await monitorExecution(this.reIndexAll.bind(this));

		// 使用示例
		await this.search("hello");
		// this.fuzzySearch("boundaries");
		// this.fuzzySearch("cohensive");
		await this.fuzzySearch("hello");
		await this.testSearch("when");
	}

	async testSearch(queryString: string) {
		try {
			const { hits } = await this.client.search({
				index: this.targetIndex,
				body: {
					query: {
						nested: {
							path: "sentences", // 嵌套对象的路径
							query: {
								match: {
									"sentences.content": queryString,
								},
							},
							score_mode: "avg", // 如何计算分数
						},
					},
				},
				size: 10, // 返回最多 10 个结果
			});

			logger.debug("[testSearch] results:", hits);
		} catch (error) {
			logger.error("Error during [testSearch]:", error);
		}
	}

	async search(query: string): Promise<any> {
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
			logger.debug("[search] raw result: ", result);
			logger.debug(
				"[search] search result:",
				result.hits.hits as SearchHitsMetadata[],
			);
			return result;
		} catch (error) {
			logger.error(`Error during [search]:`, error);
			return [];
		}
	}

	// add or update an document
	private async indexFile(filepath: string) {
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

	// create an index in the elasticsearch to store documents
	// private async createIndex(indexName: any) {
	// 	this.client.indices.create({
	// 		index: indexName,
	// 		body: {
	// 			mappings: {
	// 				properties: {
	// 					path: { type: "keyword" },
	// 					title: { type: "text" },
	// 					sentences: {
	// 						type: "nested", // 嵌套类型
	// 						properties: {
	// 							content: { type: "text" },
	// 							start_line: { type: "integer" },
	// 						},
	// 					},
	// 				},
	// 			},
	// 		},
	// 	});

	private async startFileWatchers() {
		const indexFileDebounced: (path: string) => void = debounce(
			3000,
			this.indexFile.bind(this),
		);
		this.watchers = [];

		// TODO: 处理重复子目录
		// 监视目录
		this.watchedPaths.forEach((path) => {
			const realPath = pathUtils.join(path, "**/*.md");
			// chokidar.watch() will return a new instance every time when called
			const watcher = chokidar
				.watch(realPath, {
					persistent: true,
				})
				.on("add", (newPath) => indexFileDebounced(newPath))
				.on("change", (newPath) => indexFileDebounced(newPath));
			this.watchers.push(watcher);
		});
	}
	private async stopFileWatchers() {
		// 关闭所有watchers
		this.watchers.forEach((watcher) => watcher.close());
	}

	private async createIndex(indexName: string) {
		await this.client.indices.create({
			index: indexName,
			body: {
				settings: {
					analysis: {
						tokenizer: {
							ngram_tokenizer: {
								type: "ngram",
								min_gram: 2,
								max_gram: 3,
								token_chars: ["letter", "digit"], // Include letters and digits in ngrams
							},
						},
						filter: {
							lowercase_filter: {
								type: "lowercase", // Ensure lowercase filter is defined
							},
						},
						analyzer: {
							ngram_lowercase_analyzer: {
								type: "custom",
								tokenizer: "ngram_tokenizer",
								filter: ["lowercase_filter"], // Use the lowercase filter
							},
						},
					},
				},
				mappings: {
					properties: {
						path: { type: "keyword" },
						title: {
							type: "text",
							analyzer: "ngram_lowercase_analyzer", // Use the custom analyzer for title
						},
						sentences: {
							type: "nested",
							properties: {
								content: {
									type: "text",
									analyzer: "ngram_lowercase_analyzer", // Use the custom analyzer for content within sentences
								},
								start_line: { type: "integer" },
							},
						},
					},
				},
			},
		});
	}
	async deleteIndex(targetIndex: string) {
		if (
			await this.client.indices.exists({
				index: targetIndex,
			})
		) {
			await this.client.indices.delete({ index: targetIndex });
			logger.debug(`Index [${targetIndex}] deleted`);
		} else {
			logger.debug(
				`Index [${targetIndex}] does not exist, no need to delete.`,
			);
		}
	}

	async reIndexAll() {
		this.stopFileWatchers();
		// If the index exists, delete it
		await this.deleteIndex(this.targetIndex);
		await this.createIndex(this.targetIndex);

		const targetPaths = this.watchedPaths;
		const targetIndex = this.targetIndex;
		const allIndexedDocuments = []; // 用于测试
		// try {
		// 	// BUG: 别用client.helper.bulk，有BUG ！！！
		// 	const bulkResult = await this.client.bulk({
		// 		refresh: true,
		// 		operations: operations,
		// 	});

		// 	console.log(`Reindexing completed:`, bulkResult);
		// } catch (error) {
		// 	console.error(`Error during reindexing:`, error);
		// }
		const filePaths = await getAllFiles(targetPaths, [FileExtension.MD]);
		// TODO: 用更小的数据集测试、更简单的结构测试，这里并没有成功创建对应类型的doc, 建议直接用本页最下面的代码测
		// const filePaths = await getAllFiles(targetPaths, [FileExtension.ALL]);
		let bulkOperations: any[] = [];
		let currentBulkSize = 0;

		for (const filePath of filePaths) {
			const content = fsUtils.readFileSync(filePath, "utf8");
			const sentences = nlp(content)
				.split()
				.map((sentence: any) => ({
					content: sentence.text(),
					start_line: 1,
				}));

			const doc = {
				path: filePath,
				title: pathUtils.basename(filePath),
				sentences: sentences,
			};

			currentBulkSize += Buffer.byteLength(JSON.stringify(doc));
			bulkOperations.push(
				{
					index: { _index: targetIndex },
				},
				doc,
			);

			allIndexedDocuments.push(doc);
			// Execute bulk upload when the bulk size exceeds the threshold
			if (currentBulkSize >= BULK_SIZE_THRESHOLD) {
				await this.client.bulk({ refresh: true, body: bulkOperations });
				bulkOperations = [];
				currentBulkSize = 0;
			}
		}

		// Upload any remaining documents
		if (bulkOperations.length > 0) {
			await this.client.bulk({
				refresh: true,
				operations: bulkOperations,
			});
		}
		console.log("reIndex finished...");
		console.log(`Total indexed documents: ${allIndexedDocuments.length}`);
		// 获取前30个文档的内容
		const sampleDocs = allIndexedDocuments.slice(0, 30);
		console.log(sampleDocs);
		// this.startFileMonitoring();
	}

	async fuzzySearch(searchText: string) {
		// 定义查询的配置
		// const searchConfig = {
		// 	index: this.targetIndex,
		// 	body: {
		// 		query: {
		// 			bool: {
		// 				should: [
		// 					{
		// 						fuzzy: {
		// 							title: {
		// 								value: searchText,
		// 								fuzziness: 2,
		// 							},
		// 						},
		// 					},
		// 					{
		// 						wildcard: {
		// 							title: `*${searchText}*`,
		// 						},
		// 					},
		// 					{
		// 						match_phrase: {
		// 							"sentences.content": {
		// 								query: searchText,
		// 								slop: 100,
		// 							},
		// 						},
		// 					},
		// 				],
		// 				minimum_should_match: 1,
		// 			},
		// 		},
		// 		highlight: {
		// 			fields: {
		// 				title: {},
		// 				"sentences.content": {},
		// 			},
		// 		},
		// 	},
		// };

		const searchConfig = {
			index: this.targetIndex,
			body: {
				query: {
					multi_match: {
						query: searchText,
						fields: ["content", "title"], // 搜索content和title字段
						fuzziness: "AUTO", // 启用模糊匹配
						operator: "or", // 使用'or'操作符，任一关键词匹配即可
						type: "best_fields", // 使用最佳字段类型，适合更模糊的匹配
						tie_breaker: 0.3, // 在相关性接近时，优先考虑最佳匹配字段
					},
				},
				highlight: {
					fields: {
						content: {}, // 只高亮显示content字段
					},
				},
			},
		};

		try {
			const response = await this.client.search(searchConfig);
			logger.debug("[fuzzySearch] results:", response.hits.hits);

			// 输出结果到控制台
			response.hits.hits.forEach((hit) => {
				// console.log(`Document path: ${hit._source.path}`);
				// console.log(`Title: ${hit._source.title}`);
				if (hit.highlight && hit.highlight["sentences.content"]) {
					logger.debug(
						`Matched sentences: ${hit.highlight[
							"sentences.content"
						].join(", ")}`,
					);
				}
				// console.log("--------------------------------");
			});
		} catch (error) {
			logger.error("Error during [fuzzySearch]:", error);
		}
	}
}

const BULK_SIZE_THRESHOLD = 5 * 1024 * 1024; // 5MB

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
