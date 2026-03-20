import fs from "fs";
import path from "path";
import MiniSearch from "minisearch";

const DEFAULT_LIMIT = 20;
const DEFAULT_SYNTHETIC_FILES = 600;

const stop = new Set([
	"the",
	"and",
	"for",
	"with",
	"that",
	"from",
	"this",
	"into",
	"about",
	"your",
	"their",
	"have",
	"will",
	"not",
	"are",
	"was",
	"were",
	"use",
	"using",
	"you",
	"but",
	"can",
	"via",
]);

const FILE_SEARCH_FIELDS = ["basename", "aliases", "folder", "tags", "headings", "content"];
const FILE_SEARCH_METADATA_FIELDS = ["basename", "aliases", "folder", "tags", "headings"];
const FILE_SEARCH_METADATA_FIELD_SET = new Set(FILE_SEARCH_METADATA_FIELDS);
const FILE_SEARCH_FIELD_IDS = {
	basename: 0,
	aliases: 1,
	folder: 2,
	tags: 3,
	headings: 4,
	content: 5,
};
const FILE_SEARCH_FIELD_WEIGHTS = {
	basename: 3,
	aliases: 3,
	folder: 2,
	tags: 1.15,
	headings: 1.27,
	content: 1,
};

const FILE_SEARCH_BM25_K1 = 1.5;
const FILE_SEARCH_BM25_B = 0.75;
const FILE_SEARCH_PREFIX_EXPANSION_LIMIT = 128;
const FILE_SEARCH_FUZZY_EXPANSION_LIMIT = 96;
const FILE_SEARCH_MAX_FUZZY_EDITS = 2;
const FILE_SEARCH_FIELD_COORDINATION_BONUS = 0.9;
const FILE_SEARCH_METADATA_COORDINATION_BONUS = 1.8;
const FILE_SEARCH_METADATA_EXPANDED_MATCH_BONUS = 1.25;
const FILE_SEARCH_METADATA_FULL_FIELD_COVERAGE_BONUS = 2.4;
const FILE_SEARCH_PREFIX_EXACT_MATCH_BOOST = 0.72;
const FILE_SEARCH_FUZZY_WHEN_PREFIX_EXISTS_BOOST = 0.92;
const FILE_SEARCH_BINARY_MAGIC = [0x43, 0x53, 0x46, 0x42];
const FILE_SEARCH_BINARY_FORMAT_VERSION = 1;
const textEncoder = new TextEncoder();

function parseArgs(argv) {
	const args = {
		mode: "synthetic",
		vault: "",
		queries: "",
		limit: DEFAULT_LIMIT,
		syntheticFiles: DEFAULT_SYNTHETIC_FILES,
	};
	for (const arg of argv.slice(2)) {
		if (arg.startsWith("--mode=")) {
			args.mode = arg.slice("--mode=".length);
		} else if (arg.startsWith("--vault=")) {
			args.vault = arg.slice("--vault=".length);
		} else if (arg.startsWith("--queries=")) {
			args.queries = arg.slice("--queries=".length);
		} else if (arg.startsWith("--limit=")) {
			args.limit = Number(arg.slice("--limit=".length)) || DEFAULT_LIMIT;
		} else if (arg.startsWith("--synthetic-files=")) {
			args.syntheticFiles =
				Number(arg.slice("--synthetic-files=".length)) || DEFAULT_SYNTHETIC_FILES;
		}
	}
	return args;
}

function tokenizeSequence(text) {
	const out = [];
	for (const raw of text.toLowerCase().split(/[^a-z0-9_\-]+/g)) {
		if (!raw || raw.length < 2 || stop.has(raw)) continue;
		out.push(raw);
		if (raw.length > 3) {
			for (const part of raw
				.replace(/[-_]|([a-z](?=[A-Z]))/g, "$1 ")
				.split(/\s+/)) {
				if (part && part.length > 1 && !stop.has(part)) {
					out.push(part);
				}
			}
		}
	}
	return out;
}

function tokenize(text) {
	return [...new Set(tokenizeSequence(text))];
}

class MiniSearchAdapter {
	constructor() {
		this.engine = new MiniSearch({
			fields: FILE_SEARCH_FIELDS,
			storeFields: ["path"],
			idField: "path",
			tokenize: (text) => tokenize(text),
			processTerm: (term) => term.toLowerCase(),
		});
	}

	addAll(docs) {
		this.engine.addAll(docs);
	}

	search(query, { prefix = true, fuzzy = true, limit = DEFAULT_LIMIT } = {}) {
		return this.engine
			.search(query, {
				tokenize: (text) => tokenize(text),
				prefix: (term) => (prefix ? term.length >= 2 : false),
				fuzzy: (term) => (fuzzy ? (term.length <= 3 ? 0 : 0.2) : false),
				boost: {
					basename: 3,
					aliases: 3,
					folder: 2,
					tags: 1.15,
					headings: 1.27,
				},
				combineWith: "and",
			})
			.slice(0, limit)
			.map((result) => result.id);
	}

	serializeBytes() {
		return Buffer.byteLength(JSON.stringify(this.engine.toJSON()), "utf8");
	}
}

class CustomFileSearchBenchmarkEngine {
	constructor() {
		this.termPostings = new Map();
		this.sortedTerms = [];
		this.fieldStats = Object.fromEntries(
			FILE_SEARCH_FIELDS.map((field) => [
				field,
				{ docLengths: new Map(), totalLength: 0 },
			]),
		);
		this.pathByDocId = new Map();
		this.nextDocId = 1;
	}

	addAll(docs) {
		for (const doc of docs) {
			const docId = this.nextDocId++;
			this.pathByDocId.set(docId, doc.path);
			for (const field of FILE_SEARCH_FIELDS) {
				const tokens =
					field === "content"
						? tokenize(doc[field] || "")
						: tokenizeSequence(doc[field] || "");
				this.fieldStats[field].docLengths.set(docId, tokens.length);
				this.fieldStats[field].totalLength += tokens.length;

				const tfMap = new Map();
				for (const token of tokens) {
					tfMap.set(token, (tfMap.get(token) || 0) + 1);
				}

				for (const [term, tf] of tfMap) {
					let fieldMap = this.termPostings.get(term);
					if (!fieldMap) {
						fieldMap = new Map();
						this.termPostings.set(term, fieldMap);
						this.insertTerm(term);
					}
					let postings = fieldMap.get(field);
					if (!postings) {
						postings = new Map();
						fieldMap.set(field, postings);
					}
					postings.set(docId, tf);
				}
			}
		}
	}

	search(query, { prefix = true, fuzzy = true, limit = DEFAULT_LIMIT } = {}) {
		const queryTerms = tokenize(query);
		if (queryTerms.length === 0) return [];

		const prefixTerm =
			prefix && queryTerms[queryTerms.length - 1].length >= 2
				? queryTerms[queryTerms.length - 1]
				: null;

		const termMatches = queryTerms.map((term) =>
			this.resolveMatchedTerms(term, prefixTerm === term, fuzzy),
		);
		if (termMatches.some((match) => match.length === 0)) return [];

		const candidateScores = new Map();
		const matchedCounts = new Map();
		const matchedQueryTermsByField = new Map();
		const matchedQueryTermsInMetadata = new Map();
		const matchedExpandedQueryTermsInMetadata = new Map();
		const docCount = this.pathByDocId.size;

		for (let queryTermIndex = 0; queryTermIndex < termMatches.length; queryTermIndex++) {
			const docsMatchedForTerm = new Set();
			for (const matchedTerm of termMatches[queryTermIndex]) {
				const fieldMap = this.termPostings.get(matchedTerm.term);
				if (!fieldMap) continue;

				for (const field of FILE_SEARCH_FIELDS) {
					if (matchedTerm.fields && !matchedTerm.fields.includes(field)) continue;
					const postings = fieldMap.get(field);
					if (!postings || postings.size === 0) continue;

					const idf = Math.log((docCount - postings.size + 0.5) / (postings.size + 0.5) + 1);
					const avgFieldLength =
						this.fieldStats[field].totalLength / Math.max(1, docCount) || 1;

					for (const [docId, tf] of postings) {
						const docLength = this.fieldStats[field].docLengths.get(docId) || 0;
						const tfNorm =
							(tf * (FILE_SEARCH_BM25_K1 + 1)) /
							(tf +
								FILE_SEARCH_BM25_K1 *
									(1 -
										FILE_SEARCH_BM25_B +
										FILE_SEARCH_BM25_B * (docLength / avgFieldLength)));
						candidateScores.set(
							docId,
							(candidateScores.get(docId) || 0) +
								FILE_SEARCH_FIELD_WEIGHTS[field] * idf * tfNorm * matchedTerm.boost,
						);

						let docFieldMatches = matchedQueryTermsByField.get(docId);
						if (!docFieldMatches) {
							docFieldMatches = new Map();
							matchedQueryTermsByField.set(docId, docFieldMatches);
						}
						let fieldMatches = docFieldMatches.get(field);
						if (!fieldMatches) {
							fieldMatches = new Set();
							docFieldMatches.set(field, fieldMatches);
						}
						fieldMatches.add(queryTermIndex);
						if (FILE_SEARCH_METADATA_FIELDS.includes(field)) {
							let metadataMatches = matchedQueryTermsInMetadata.get(docId);
							if (!metadataMatches) {
								metadataMatches = new Set();
								matchedQueryTermsInMetadata.set(docId, metadataMatches);
							}
							metadataMatches.add(queryTermIndex);
							if (matchedTerm.kind !== "exact") {
								let expandedMetadataMatches =
									matchedExpandedQueryTermsInMetadata.get(docId);
								if (!expandedMetadataMatches) {
									expandedMetadataMatches = new Set();
									matchedExpandedQueryTermsInMetadata.set(
										docId,
										expandedMetadataMatches,
									);
								}
								expandedMetadataMatches.add(queryTermIndex);
							}
						}
						docsMatchedForTerm.add(docId);
					}
				}
			}

			for (const docId of docsMatchedForTerm) {
				matchedCounts.set(docId, (matchedCounts.get(docId) || 0) + 1);
			}
		}

		for (const [docId, score] of candidateScores) {
			const fieldMatches = matchedQueryTermsByField.get(docId);
			if (!fieldMatches) continue;
			let bestBonus = 0;
			for (const field of FILE_SEARCH_FIELDS) {
				const matches = fieldMatches.get(field);
				if (!matches || matches.size === 0) continue;
				const coverage = matches.size / Math.max(1, termMatches.length);
				bestBonus = Math.max(
					bestBonus,
					FILE_SEARCH_FIELD_WEIGHTS[field] *
						coverage *
						matches.size *
						FILE_SEARCH_FIELD_COORDINATION_BONUS,
				);
				if (
					FILE_SEARCH_METADATA_FIELDS.includes(field) &&
					matches.size === termMatches.length
				) {
					bestBonus +=
						FILE_SEARCH_FIELD_WEIGHTS[field] *
						FILE_SEARCH_METADATA_FULL_FIELD_COVERAGE_BONUS;
				}
			}
			const metadataMatches = matchedQueryTermsInMetadata.get(docId);
			if (metadataMatches && metadataMatches.size > 0) {
				const metadataCoverage =
					metadataMatches.size / Math.max(1, termMatches.length);
				bestBonus = Math.max(
					bestBonus,
					FILE_SEARCH_METADATA_COORDINATION_BONUS *
						metadataCoverage *
						metadataMatches.size,
				);
			}
			const expandedMetadataMatches =
				matchedExpandedQueryTermsInMetadata.get(docId);
			if (expandedMetadataMatches && expandedMetadataMatches.size > 0) {
				const expandedMetadataCoverage =
					expandedMetadataMatches.size / Math.max(1, termMatches.length);
				bestBonus +=
					FILE_SEARCH_METADATA_EXPANDED_MATCH_BONUS *
					expandedMetadataCoverage *
					expandedMetadataMatches.size;
			}
			candidateScores.set(docId, score + bestBonus);
		}

		return [...candidateScores.entries()]
			.filter(([docId]) => matchedCounts.get(docId) === termMatches.length)
			.sort((a, b) => b[1] - a[1])
			.slice(0, limit)
			.map(([docId]) => this.pathByDocId.get(docId));
	}

	resolveMatchedTerms(queryTerm, allowPrefix, allowFuzzy) {
		const prefixTerms = allowPrefix ? this.expandPrefixTerms(queryTerm) : [];
		const hasLongerPrefixAlternatives = prefixTerms.some(
			(term) => term !== queryTerm,
		);
		const matchedTerms = new Map();
		if (this.termPostings.has(queryTerm)) {
			matchedTerms.set(queryTerm, {
				term: queryTerm,
				boost:
					allowPrefix && hasLongerPrefixAlternatives
						? FILE_SEARCH_PREFIX_EXACT_MATCH_BOOST
						: 1,
				kind: "exact",
			});
		}
		if (allowPrefix) {
			for (const term of prefixTerms) {
				if (matchedTerms.has(term)) continue;
				matchedTerms.set(term, {
					term,
					boost: Math.max(
						0.55,
						Math.min(1, queryTerm.length / Math.max(queryTerm.length, term.length)),
					),
					kind: "prefix",
				});
			}
		}
		const hasExactMatch = matchedTerms.get(queryTerm)?.kind === "exact";
		if (allowFuzzy && !hasExactMatch) {
			for (const { term, distance } of this.expandFuzzyTerms(queryTerm)) {
				if (matchedTerms.has(term)) continue;
				matchedTerms.set(term, {
					term,
					boost:
						Math.max(0.55, 1 - distance * 0.18) *
						(prefixTerms.length > 0
							? FILE_SEARCH_FUZZY_WHEN_PREFIX_EXISTS_BOOST
							: 1),
					kind: "fuzzy",
					fields: prefixTerms.length > 0 ? FILE_SEARCH_METADATA_FIELDS : undefined,
				});
			}
		}
		if (matchedTerms.size > 0) {
			return [...matchedTerms.values()];
		}
		return [];
	}

	expandPrefixTerms(prefix) {
		const terms = [];
		let idx = lowerBoundString(this.sortedTerms, prefix);
		while (idx < this.sortedTerms.length) {
			const term = this.sortedTerms[idx];
			if (!term.startsWith(prefix)) break;
			terms.push(term);
			if (terms.length >= FILE_SEARCH_PREFIX_EXPANSION_LIMIT) break;
			idx++;
		}
		return terms;
	}

	expandFuzzyTerms(queryTerm) {
		const maxDistance = computeMaxFuzzyDistance(queryTerm);
		if (maxDistance <= 0) return [];
		const candidates = [];
		for (const term of this.sortedTerms) {
			if (Math.abs(term.length - queryTerm.length) > maxDistance) continue;
			if (term[0] !== queryTerm[0]) continue;
			const distance = boundedLevenshtein(term, queryTerm, maxDistance);
			if (distance <= maxDistance) {
				candidates.push({ term, distance });
			}
		}
		candidates.sort(
			(a, b) =>
				a.distance - b.distance ||
				Math.abs(a.term.length - queryTerm.length) -
					Math.abs(b.term.length - queryTerm.length) ||
				countSharedPrefix(queryTerm, b.term) -
					countSharedPrefix(queryTerm, a.term) ||
				a.term.length - b.term.length ||
				a.term.localeCompare(b.term),
		);
		return candidates.slice(0, FILE_SEARCH_FUZZY_EXPANSION_LIMIT);
	}

	insertTerm(term) {
		const idx = lowerBoundString(this.sortedTerms, term);
		if (this.sortedTerms[idx] !== term) {
			this.sortedTerms.splice(idx, 0, term);
		}
	}

	serializeJsonBytes() {
		const payload = {
			__backend: "custom-bm25",
			__version: 5,
			nextDocId: this.nextDocId,
			docs: [...this.pathByDocId.entries()],
			fieldStats: FILE_SEARCH_FIELDS.map((field) => [
				FILE_SEARCH_FIELD_IDS[field],
				this.fieldStats[field].totalLength,
				[...this.fieldStats[field].docLengths.entries()],
			]),
			metadataPostings: [...this.termPostings.entries()]
				.map(([term, fieldMap]) => {
					const metadataFields = [...fieldMap.entries()]
						.filter(([field]) => FILE_SEARCH_METADATA_FIELD_SET.has(field))
						.map(([field, postingMap]) => [
							FILE_SEARCH_FIELD_IDS[field],
							[...postingMap.entries()],
						]);
					return metadataFields.length > 0 ? [term, metadataFields] : null;
				})
				.filter(Boolean),
			contentPostings: [...this.termPostings.entries()]
				.map(([term, fieldMap]) => {
					const postingMap = fieldMap.get("content");
					return postingMap ? [term, [...postingMap.keys()]] : null;
				})
				.filter(Boolean),
		};
		return Buffer.byteLength(JSON.stringify(payload), "utf8");
	}

	serializeBinaryBytes() {
		const writer = new BinaryWriter();
		writer.writeBytes(FILE_SEARCH_BINARY_MAGIC);
		writer.writeVarUint(FILE_SEARCH_BINARY_FORMAT_VERSION);
		writer.writeVarUint(this.nextDocId);

		const docs = [...this.pathByDocId.entries()].sort((a, b) => a[0] - b[0]);
		writer.writeVarUint(docs.length);
		let prevDocId = 0;
		for (const [docId, path] of docs) {
			writer.writeVarUint(docId - prevDocId);
			writer.writeString(path);
			prevDocId = docId;
		}

		for (const field of FILE_SEARCH_FIELDS) {
			writer.writeVarUint(this.fieldStats[field].totalLength);
			const docLengths = [...this.fieldStats[field].docLengths.entries()].sort(
				(a, b) => a[0] - b[0],
			);
			writer.writeVarUint(docLengths.length);
			prevDocId = 0;
			for (const [docId, docLength] of docLengths) {
				writer.writeVarUint(docId - prevDocId);
				writer.writeVarUint(docLength);
				prevDocId = docId;
			}
		}

		writer.writeVarUint(this.sortedTerms.length);
		let prevTerm = "";
		for (const term of this.sortedTerms) {
			const prefixLength = countSharedPrefix(prevTerm, term);
			writer.writeVarUint(prefixLength);
			writer.writeString(term.slice(prefixLength));

			const fieldMap = this.termPostings.get(term);
			const metadataEntries = FILE_SEARCH_METADATA_FIELDS.flatMap((field) => {
				const postingMap = fieldMap?.get(field);
				if (!postingMap || postingMap.size === 0) {
					return [];
				}
				return [[
					FILE_SEARCH_FIELD_IDS[field],
					[...postingMap.entries()].sort((a, b) => a[0] - b[0]),
				]];
			});
			writer.writeVarUint(metadataEntries.length);
			for (const [fieldId, postingEntries] of metadataEntries) {
				writer.writeVarUint(fieldId);
				writer.writeVarUint(postingEntries.length);
				prevDocId = 0;
				for (const [docId, tf] of postingEntries) {
					writer.writeVarUint(docId - prevDocId);
					writer.writeVarUint(tf);
					prevDocId = docId;
				}
			}

			const contentDocIds = [...(fieldMap?.get("content")?.keys() ?? [])].sort(
				(a, b) => a - b,
			);
			writer.writeVarUint(contentDocIds.length);
			prevDocId = 0;
			for (const docId of contentDocIds) {
				writer.writeVarUint(docId - prevDocId);
				prevDocId = docId;
			}
			prevTerm = term;
		}

		return writer.length();
	}

	serializeBytes() {
		return this.serializeBinaryBytes();
	}
}

function computeMaxFuzzyDistance(queryTerm) {
	if (queryTerm.length <= 3) return 0;
	return Math.min(
		FILE_SEARCH_MAX_FUZZY_EDITS,
		Math.max(1, Math.round(queryTerm.length * 0.2)),
	);
}

function boundedLevenshtein(a, b, maxDistance) {
	if (a === b) return 0;
	if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
	const prev = new Array(b.length + 1);
	const curr = new Array(b.length + 1);
	for (let j = 0; j <= b.length; j++) prev[j] = j;
	for (let i = 1; i <= a.length; i++) {
		curr[0] = i;
		let rowMin = curr[0];
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(
				prev[j] + 1,
				curr[j - 1] + 1,
				prev[j - 1] + cost,
			);
			rowMin = Math.min(rowMin, curr[j]);
		}
		if (rowMin > maxDistance) return maxDistance + 1;
		for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
	}
	return prev[b.length];
}

function lowerBoundString(values, target) {
	let lo = 0;
	let hi = values.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (values[mid].localeCompare(target) < 0) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

class BinaryWriter {
	constructor() {
		this.chunks = [];
		this.totalLength = 0;
	}

	writeBytes(bytes) {
		const chunk = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
		this.chunks.push(chunk);
		this.totalLength += chunk.length;
	}

	writeVarUint(value) {
		let current = value >>> 0;
		const out = [];
		do {
			let byte = current & 0x7f;
			current >>>= 7;
			if (current !== 0) {
				byte |= 0x80;
			}
			out.push(byte);
		} while (current !== 0);
		this.writeBytes(out);
	}

	writeString(value) {
		const encoded = textEncoder.encode(value);
		this.writeVarUint(encoded.length);
		this.writeBytes(encoded);
	}

	length() {
		return this.totalLength;
	}
}

function countSharedPrefix(prev, current) {
	const limit = Math.min(prev.length, current.length);
	let index = 0;
	while (index < limit && prev[index] === current[index]) {
		index++;
	}
	return index;
}

function rankOf(list, target) {
	const idx = list.indexOf(target);
	return idx === -1 ? null : idx + 1;
}

function bestRankOf(list, targets) {
	let bestRank = null;
	for (const target of targets) {
		const rank = rankOf(list, target);
		if (rank !== null && (bestRank === null || rank < bestRank)) {
			bestRank = rank;
		}
	}
	return bestRank;
}

function summarizeRows(rows, engineKey) {
	return {
		count: rows.length,
		hit1: rows.filter((row) => row[engineKey] === 1).length,
		hit3: rows.filter((row) => row[engineKey] && row[engineKey] <= 3).length,
		hit10: rows.filter((row) => row[engineKey] && row[engineKey] <= 10).length,
		mrr: Number(
			(
				rows.reduce((sum, row) => sum + (row[engineKey] ? 1 / row[engineKey] : 0), 0) /
				rows.length
			).toFixed(3),
		),
	};
}

function summarizeComparison(rows) {
	let miniBetter = 0;
	let customBetter = 0;
	let tied = 0;
	let bothMissed = 0;

	for (const row of rows) {
		if (row.mini === null && row.custom === null) {
			bothMissed++;
			continue;
		}
		if (row.mini === row.custom) {
			tied++;
			continue;
		}
		if (row.mini === null || (row.custom !== null && row.custom < row.mini)) {
			customBetter++;
			continue;
		}
		if (row.custom === null || row.mini < row.custom) {
			miniBetter++;
			continue;
		}
		tied++;
	}

	return {
		miniBetter,
		customBetter,
		tied,
		bothMissed,
	};
}

function evaluateSuite(name, queries, mini, custom, limit = DEFAULT_LIMIT) {
	const rows = queries.map((queryCase) => {
		const targets = Array.isArray(queryCase.targets)
			? queryCase.targets
			: queryCase.target
				? [queryCase.target]
				: [];
		const options = {
			prefix: queryCase.prefix ?? true,
			fuzzy: queryCase.fuzzy ?? true,
			limit: queryCase.limit ?? limit,
		};
		const miniResults = mini.search(queryCase.query, options);
		const customResults = custom.search(queryCase.query, options);
		return {
			name: queryCase.name ?? queryCase.query,
			query: queryCase.query,
			targets,
			mini: bestRankOf(miniResults, targets),
			custom: bestRankOf(customResults, targets),
			prefix: options.prefix,
			fuzzy: options.fuzzy,
			limit: options.limit,
			miniTop3: miniResults.slice(0, 3),
			customTop3: customResults.slice(0, 3),
		};
	});
	return {
		name,
		mini: summarizeRows(rows, "mini"),
		custom: summarizeRows(rows, "custom"),
		comparison: summarizeComparison(rows),
		samples: rows.filter((row) => row.mini !== row.custom).slice(0, 8),
	};
}

function buildSyntheticCorpus(count) {
	const random = mulberry32(20260320);
	const pickRandom = (list) => list[Math.floor(random() * list.length)];
	const randomCode = (length) =>
		Array.from({ length }, () =>
			String.fromCharCode(97 + Math.floor(random() * 26)),
		).join("");
	const shuffleRandom = (list) => {
		for (let i = list.length - 1; i > 0; i--) {
			const j = Math.floor(random() * (i + 1));
			[list[i], list[j]] = [list[j], list[i]];
		}
		return list;
	};

	const folders = ["project", "research", "journal", "meeting", "idea", "spec", "lab", "ops"];
	const topics = [
		"vector",
		"search",
		"plugin",
		"cache",
		"graph",
		"index",
		"ranking",
		"parser",
		"render",
		"memory",
		"query",
		"token",
		"chunk",
		"prompt",
		"syntax",
		"export",
		"retrieval",
		"router",
		"layout",
		"editor",
	];
	const traits = [
		"hybrid",
		"dense",
		"sparse",
		"fast",
		"stable",
		"exact",
		"local",
		"remote",
		"daily",
		"weekly",
		"semantic",
		"lexical",
		"adaptive",
		"linked",
	];
	const nouns = [
		"design",
		"workflow",
		"guide",
		"notes",
		"plan",
		"review",
		"draft",
		"report",
		"log",
		"summary",
		"checklist",
		"analysis",
		"playbook",
		"blueprint",
	];
	const fillers = [
		"system",
		"module",
		"signal",
		"process",
		"engine",
		"result",
		"state",
		"window",
		"buffer",
		"entry",
		"option",
		"value",
		"match",
		"stream",
		"record",
		"output",
		"pipeline",
		"bridge",
		"context",
		"trace",
	];
	const novelRoots = [
		"graphflux",
		"querymesh",
		"vaultscope",
		"promptflow",
		"retrix",
		"semacore",
		"tokenweave",
		"linkburst",
		"rankpilot",
		"cacheforge",
	];

	const docs = [];
	for (let i = 0; i < count; i++) {
		const folder = pickRandom(folders);
		const topic1 = pickRandom(topics);
		let topic2 = pickRandom(topics);
		while (topic2 === topic1) topic2 = pickRandom(topics);
		const trait = pickRandom(traits);
		const noun = pickRandom(nouns);
		const novel = `${pickRandom(novelRoots)}${i}`;
		const basename = `${topic1}_${trait}_${i}_${noun}`;
		const heading = `${trait} ${topic1} ${noun}`;
		const alias = `${topic1} ${noun}`;
		const uniqueNameToken = `filekey${i}`;
		const uniqueHeadingToken = `headkey${i}`;
		const uniqueNameStableToken = `namekey${i.toString(36)}${randomCode(5)}`;
		const uniqueHeadingStableToken = `headkey${i.toString(36)}${randomCode(5)}`;
		const near = shuffleRandom([
			`rare${i}a`,
			`rare${i}b`,
			topic1,
			topic2,
			trait,
			noun,
			novel,
			...Array.from({ length: 24 }, () => pickRandom(fillers)),
		]).join(" ");
		const content = `${near}\n\n${Array.from({ length: 60 }, () => pickRandom([...fillers, ...topics, ...traits, ...nouns])).join(" ")}`;

		docs.push({
			path: `${folder}/${basename}.md`,
			basename: `${basename} ${uniqueNameToken} ${uniqueNameStableToken} ${novel}`,
			folder,
			tags: `${topic1} ${trait} ${novel}`,
			headings: `${heading} ${uniqueHeadingToken} ${uniqueHeadingStableToken} ${novel}`,
			aliases: `${alias} ${novel}`,
			content,
			meta: {
				uniqueNameToken,
				uniqueHeadingToken,
				uniqueNameStableToken,
				uniqueHeadingStableToken,
				novel,
				topic1,
			},
		});
	}

	return docs;
}

function buildSyntheticSuites(docs) {
	return [
		{
			name: "filename_typo_fuzzy",
			queries: docs.map((doc) => ({
				query: mutateLastChar(doc.meta.uniqueNameToken),
				target: doc.path,
			})),
		},
		{
			name: "heading_typo_fuzzy",
			queries: docs.map((doc) => ({
				query: mutateLastChar(doc.meta.uniqueHeadingToken),
				target: doc.path,
			})),
		},
		{
			name: "filename_unique_typo_fuzzy",
			queries: docs.map((doc) => ({
				query: mutateLastChar(doc.meta.uniqueNameStableToken),
				target: doc.path,
			})),
		},
		{
			name: "heading_unique_typo_fuzzy",
			queries: docs.map((doc) => ({
				query: mutateLastChar(doc.meta.uniqueHeadingStableToken),
				target: doc.path,
			})),
		},
		{
			name: "alias_plus_novel_prefix",
			queries: docs.map((doc) => ({
				query: `${doc.meta.topic1} ${doc.meta.novel.slice(0, 5)}`,
				target: doc.path,
			})),
		},
		{
			name: "novel_varied_prefix",
			queries: docs.map((doc) => ({
				query: doc.meta.novel.slice(0, Math.max(5, doc.meta.novel.length - 2)),
				target: doc.path,
			})),
		},
	];
}

function mutateLastChar(token) {
	if (!token) return token;
	const last = token[token.length - 1];
	const replacement = last === "x" ? "z" : "x";
	return `${token.slice(0, -1)}${replacement}`;
}

function walkMarkdownFiles(rootDir) {
	const files = [];
	function walk(dir) {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === ".obsidian" || entry.name === "node_modules") continue;
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath);
			} else if (entry.isFile() && entry.name.endsWith(".md")) {
				files.push(fullPath);
			}
		}
	}
	walk(rootDir);
	return files;
}

function parseMarkdownDoc(rootDir, fullPath) {
	const raw = fs.readFileSync(fullPath, "utf8");
	const relPath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
	const lines = raw.split(/\r?\n/);
	const headings = [];
	const aliases = [];
	const tags = [];

	for (const line of lines) {
		const heading = line.match(/^#{1,6}\s+(.*)$/);
		if (heading) headings.push(heading[1].trim());
		const alias = line.match(/^aliases?:\s*(.+)$/i);
		if (alias) aliases.push(alias[1].replace(/[\[\]",]/g, " ").trim());
		const tagMatches = line.match(/#[\p{L}\p{N}_/-]+/gu);
		if (tagMatches) {
			tags.push(...tagMatches.map((tag) => tag.slice(1)));
		}
	}

	return {
		path: relPath,
		basename: path.basename(relPath, ".md"),
		folder: path.dirname(relPath) === "." ? "" : path.dirname(relPath).replace(/\\/g, "/"),
		tags: tags.join(" "),
		headings: headings.join(" "),
		aliases: aliases.join(" "),
		content: raw,
	};
}

function pickRepresentativeQuery(text) {
	const terms = tokenize(text).filter((term) => term.length >= 3);
	if (terms.length === 0) return "";
	terms.sort((a, b) => b.length - a.length || a.localeCompare(b));
	return terms.slice(0, 2).join(" ");
}

function buildVaultSuites(docs) {
	const filenameQueries = docs
		.map((doc) => ({
			query: pickRepresentativeQuery(doc.basename),
			target: doc.path,
		}))
		.filter((row) => row.query);
	const headingQueries = docs
		.map((doc) => ({
			query: pickRepresentativeQuery(doc.headings),
			target: doc.path,
		}))
		.filter((row) => row.query);
	const contentQueries = docs
		.map((doc) => ({
			query: pickRepresentativeQuery(doc.content),
			target: doc.path,
		}))
		.filter((row) => row.query);
	return [
		{ name: "vault_filename", queries: filenameQueries },
		{ name: "vault_heading", queries: headingQueries },
		{ name: "vault_content", queries: contentQueries },
	];
}

function buildRegressionSuites(queryFile, docs) {
	const queryPath = path.resolve(queryFile);
	const raw = JSON.parse(fs.readFileSync(queryPath, "utf8"));
	const suites = Array.isArray(raw) ? raw : raw.suites;
	if (!Array.isArray(suites) || suites.length === 0) {
		throw new Error("regression mode requires a non-empty suites array");
	}

	const knownPaths = new Set(docs.map((doc) => doc.path));
	const allPaths = docs.map((doc) => doc.path);
	return suites.map((suite, suiteIndex) => {
		const defaultOptions = suite.defaultOptions || {};
		const queries = (suite.queries || []).map((queryCase, queryIndex) => {
			const explicitTargets = Array.isArray(queryCase.targets)
				? queryCase.targets
				: queryCase.target
					? [queryCase.target]
					: [];
			const targetIncludes = Array.isArray(queryCase.targetIncludes)
				? queryCase.targetIncludes
				: queryCase.targetIncludes
					? [queryCase.targetIncludes]
					: [];
			const fuzzyTargets = targetIncludes.flatMap((fragment) =>
				allPaths.filter((filePath) => filePath.includes(fragment)),
			);
			const targets = Array.from(new Set([...explicitTargets, ...fuzzyTargets]));
			if (!queryCase.query || targets.length === 0) {
				throw new Error(
					`Invalid regression case at suite ${suiteIndex + 1}, query ${queryIndex + 1}`,
				);
			}
			const missingTargets = targets.filter((target) => !knownPaths.has(target));
			if (missingTargets.length > 0) {
				throw new Error(
					`Regression targets not found in vault: ${missingTargets.join(", ")}`,
				);
			}
			return {
				name: queryCase.name,
				query: queryCase.query,
				targets,
				prefix: queryCase.prefix ?? defaultOptions.prefix ?? true,
				fuzzy: queryCase.fuzzy ?? defaultOptions.fuzzy ?? true,
				limit: queryCase.limit ?? defaultOptions.limit ?? DEFAULT_LIMIT,
			};
		});
		return {
			name: suite.name || `regression_suite_${suiteIndex + 1}`,
			queries,
		};
	});
}

function runBenchmark(docs, suites, limit) {
	const mini = new MiniSearchAdapter();
	const custom = new CustomFileSearchBenchmarkEngine();
	mini.addAll(docs);
	custom.addAll(docs);
	const miniBytes = mini.serializeBytes();
	const customJsonBytes = custom.serializeJsonBytes();
	const customBinaryBytes = custom.serializeBinaryBytes();

	return {
		corpus: {
			files: docs.length,
			miniBytes,
			customJsonBytes,
			customBinaryBytes,
			customBytes: customBinaryBytes,
			customJsonToMiniRatio: Number((customJsonBytes / miniBytes).toFixed(3)),
			customToMiniRatio: Number((customBinaryBytes / miniBytes).toFixed(3)),
		},
		suites: suites.map((suite) => evaluateSuite(suite.name, suite.queries, mini, custom, limit)),
	};
}

function mulberry32(a) {
	return function () {
		let t = (a += 0x6d2b79f5);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

async function main() {
	const args = parseArgs(process.argv);
	if (args.mode === "vault" || args.mode === "regression") {
		if (!args.vault) {
			throw new Error(`${args.mode} mode requires --vault=/absolute/path`);
		}
		const files = walkMarkdownFiles(args.vault);
		const docs = files.map((file) => parseMarkdownDoc(args.vault, file));
		const suites =
			args.mode === "regression"
				? (() => {
						if (!args.queries) {
							throw new Error(
								"regression mode requires --queries=/absolute/or/relative/path.json",
							);
						}
						return buildRegressionSuites(args.queries, docs);
					})()
				: buildVaultSuites(docs);
		console.log(JSON.stringify(runBenchmark(docs, suites, args.limit), null, 2));
		return;
	}

	const docs = buildSyntheticCorpus(args.syntheticFiles);
	const suites = buildSyntheticSuites(docs);
	console.log(JSON.stringify(runBenchmark(docs, suites, args.limit), null, 2));
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
