#!/usr/bin/env node

import fs from "fs";
import path from "path";

const METADATA_FIELDS = ["basename", "aliases", "headings", "folder", "tag"];
const EXACT_FIELDS = [...METADATA_FIELDS, "body"];
const NOTEWORTHY_QUERIES = new Set(["\u8d62\u5b8b", "\u59d4\u5458\u957f", "\u751f\u547d\u529b"]);

function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!args.documents || !args.queries) {
		printUsageAndExit();
	}
	const documents = normalizeDocuments(readJson(args.documents));
	const queries = normalizeQueries(readJson(args.queries));
	const currentBreakdown = args.currentBreakdown
		? readJson(args.currentBreakdown)
		: null;
	const maxItemResults = Number.isFinite(args.maxItemResults)
		? Math.max(1, Math.trunc(args.maxItemResults))
		: 10;
	const policy = resolveHanPolicy(maxItemResults);

	const corpus = buildCorpus(documents);
	const replay = replayQueries(corpus, queries, policy);
	const informationFloor = buildInformationFloor(corpus);
	const codecFloorEstimates = buildCodecFloorEstimates(corpus);
	const rawIndexedTextBytes = corpus.rawIndexedTextBytes;
	const rawMetadataTextBytes = corpus.rawMetadataTextBytes;
	const rawBodyTextBytes = corpus.rawBodyTextBytes;

	const output = {
		input: {
			documentCount: documents.length,
			queryCount: queries.length,
			maxItemResults,
			policy,
			documentsPath: path.resolve(args.documents),
			queriesPath: path.resolve(args.queries),
			currentBreakdownPath: args.currentBreakdown
				? path.resolve(args.currentBreakdown)
				: null,
		},
		rawText: {
			rawIndexedTextBytes,
			rawMetadataTextBytes,
			rawBodyTextBytes,
		},
		requiredInformationPrimitives: {
			exact_doc_incidence: informationFloor.exactDocIncidence,
			metadata_han_gate_incidence: informationFloor.metadataHanGateIncidence,
			body_verification_view: informationFloor.bodyVerificationView,
			body_pending_scan_work: replay.bodyPendingScanWork,
			proximity_sequence_view: informationFloor.proximitySequenceView,
		},
		information_floor: {
			totalBytes: informationFloor.totalBytes,
			requiredInfoBytesPerRawIndexedTextByte: safeRatio(
				informationFloor.totalBytes,
				rawIndexedTextBytes,
			),
		},
		codec_floor_estimates: {
			exact_doc_incidence: codecFloorEstimates.exactDocIncidence,
			metadata_han_gate_incidence: codecFloorEstimates.metadataHanGateIncidence,
			combined: codecFloorEstimates.combined,
			codecFloorBytesPerRawIndexedTextByte: safeRatio(
				codecFloorEstimates.combined.partitionedEliasFanoBytes +
					informationFloor.bodyVerificationView.totalBytes +
					informationFloor.proximitySequenceView.totalBytes,
				rawIndexedTextBytes,
			),
		},
		current_js_hot_cost: currentBreakdown,
		ratios: {
			required_info_bytes_over_raw_indexed_text_bytes: safeRatio(
				informationFloor.totalBytes,
				rawIndexedTextBytes,
			),
			codec_floor_bytes_over_raw_indexed_text_bytes: safeRatio(
				codecFloorEstimates.combined.partitionedEliasFanoBytes +
					informationFloor.bodyVerificationView.totalBytes +
					informationFloor.proximitySequenceView.totalBytes,
				rawIndexedTextBytes,
			),
			current_hot_live_bytes_over_raw_indexed_text_bytes: safeRatio(
				extractCurrentHotBytes(currentBreakdown),
				rawIndexedTextBytes,
			),
			body_verification_view_bytes_over_raw_body_text_bytes: safeRatio(
				informationFloor.bodyVerificationView.totalBytes,
				rawBodyTextBytes,
			),
			metadata_han_gate_bytes_over_raw_metadata_text_bytes: safeRatio(
				informationFloor.metadataHanGateIncidence.totalBytes,
				rawMetadataTextBytes,
			),
		},
		query_replay: replay.summary,
		notable_queries: replay.notableQueries,
		appendix: {
			current_breakdown_comparison: currentBreakdown
				? {
						currentHotBytes: extractCurrentHotBytes(currentBreakdown),
						requiredInfoBytes: informationFloor.totalBytes,
						codecFloorBytes:
							codecFloorEstimates.combined.partitionedEliasFanoBytes +
							informationFloor.bodyVerificationView.totalBytes +
							informationFloor.proximitySequenceView.totalBytes,
				  }
				: null,
		},
	};

	console.log(JSON.stringify(output, null, 2));
}

function parseArgs(argv) {
	const args = {};
	for (let index = 0; index < argv.length; index += 1) {
		const part = argv[index];
		if (part === "--documents") {
			args.documents = argv[index + 1];
			index += 1;
			continue;
		}
		if (part === "--queries") {
			args.queries = argv[index + 1];
			index += 1;
			continue;
		}
		if (part === "--current-breakdown") {
			args.currentBreakdown = argv[index + 1];
			index += 1;
			continue;
		}
		if (part === "--max-item-results") {
			args.maxItemResults = Number(argv[index + 1]);
			index += 1;
		}
	}
	return args;
}

function printUsageAndExit() {
	console.error(
		[
			"Usage:",
			"  node scripts/coverage-lexical-v2-information-analysis.mjs \\",
			"    --documents <documents.json> --queries <queries.json> \\",
			"    [--current-breakdown <breakdown.json>] [--max-item-results 10]",
		].join("\n"),
	);
	process.exit(1);
}

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeDocuments(input) {
	const rawDocuments = Array.isArray(input) ? input : input.documents;
	if (!Array.isArray(rawDocuments)) {
		throw new Error("Expected documents JSON to be an array or { documents: [...] }");
	}
	return rawDocuments.map((document, index) => ({
		docId: index + 1,
		path: String(document.path ?? `doc-${index + 1}`),
		basename: String(document.basename ?? ""),
		folder: String(document.folder ?? ""),
		aliases: String(document.aliases ?? ""),
		tags: String(document.tags ?? ""),
		headings: String(document.headings ?? ""),
		body: String(document.content ?? document.body ?? ""),
	}));
}

function normalizeQueries(input) {
	const rawQueries = Array.isArray(input) ? input : input.queries;
	if (!Array.isArray(rawQueries)) {
		throw new Error("Expected queries JSON to be an array or { queries: [...] }");
	}
	return rawQueries
		.map((query, index) =>
			typeof query === "string"
				? {
						query: query,
						relevantPath: null,
						index,
				  }
				: {
						query: String(query.query ?? ""),
						relevantPath:
							query.relevantPath == null ? null : String(query.relevantPath),
						index,
				  },
		)
		.filter((query) => query.query.trim().length > 0);
}

function buildCorpus(documents) {
	const exactIncidence = new Map();
	const metadataHanGateIncidence = new Map();
	const bodyVerificationView = new Map();
	const proximityTokenSequences = new Map();
	const pathByDocId = new Map();
	let rawIndexedTextBytes = 0;
	let rawMetadataTextBytes = 0;
	let rawBodyTextBytes = 0;

	for (const document of documents) {
		pathByDocId.set(document.docId, document.path);
		const metadataFields = {
			basename: document.basename,
			aliases: document.aliases,
			headings: document.headings,
			folder: document.folder,
			tag: document.tags,
		};
		const proximityTokens = [];
		for (const [field, text] of Object.entries(metadataFields)) {
			rawIndexedTextBytes += utf8Bytes(text);
			rawMetadataTextBytes += utf8Bytes(text);
			const normalizedTokens = tokenizeText(text);
			proximityTokens.push(...normalizedTokens);
			for (const term of new Set(normalizedTokens)) {
				appendDocId(exactIncidence, `${field}:${term}`, document.docId);
			}
			for (const bigram of new Set(extractHanBigrams(text))) {
				appendDocId(metadataHanGateIncidence, `${field}:${bigram}`, document.docId);
			}
		}

		rawIndexedTextBytes += utf8Bytes(document.body);
		rawBodyTextBytes += utf8Bytes(document.body);
		const bodyTokens = tokenizeText(document.body);
		for (const term of new Set(bodyTokens)) {
			appendDocId(exactIncidence, `body:${term}`, document.docId);
		}
		const bodyHanSegments = extractHanSegments(document.body).map(normalizeText);
		bodyVerificationView.set(document.docId, bodyHanSegments);
		proximityTokenSequences.set(document.docId, {
			body: bodyTokens,
			metadata: proximityTokens,
		});
	}

	return {
		documents,
		pathByDocId,
		exactIncidence,
		metadataHanGateIncidence,
		bodyVerificationView,
		proximityTokenSequences,
		rawIndexedTextBytes,
		rawMetadataTextBytes,
		rawBodyTextBytes,
		bodyHanSegmentDocIds: documents
			.filter((document) => (bodyVerificationView.get(document.docId) ?? []).length > 0)
			.map((document) => document.docId),
	};
}

function buildInformationFloor(corpus) {
	const exactDocIncidence = buildIncidencePrimitive(corpus.exactIncidence);
	const metadataHanGateIncidence = buildIncidencePrimitive(corpus.metadataHanGateIncidence);
	const bodyVerificationView = buildBodyVerificationView(corpus.bodyVerificationView);
	const proximitySequenceView = buildProximitySequenceView(corpus.proximityTokenSequences);
	return {
		exactDocIncidence,
		metadataHanGateIncidence,
		bodyVerificationView,
		proximitySequenceView,
		totalBytes:
			exactDocIncidence.totalBytes +
			metadataHanGateIncidence.totalBytes +
			bodyVerificationView.totalBytes +
			proximitySequenceView.totalBytes,
	};
}

function buildCodecFloorEstimates(corpus) {
	const exactDocIncidence = buildIncidenceCodecEstimates(corpus.exactIncidence, corpus.documents.length);
	const metadataHanGateIncidence = buildIncidenceCodecEstimates(
		corpus.metadataHanGateIncidence,
		corpus.documents.length,
	);
	return {
		exactDocIncidence,
		metadataHanGateIncidence,
		combined: {
			uint32Bytes: exactDocIncidence.uint32Bytes + metadataHanGateIncidence.uint32Bytes,
			deltaVarintBytes:
				exactDocIncidence.deltaVarintBytes + metadataHanGateIncidence.deltaVarintBytes,
			blockPackedBytes:
				exactDocIncidence.blockPackedBytes + metadataHanGateIncidence.blockPackedBytes,
			eliasFanoBytes:
				exactDocIncidence.eliasFanoBytes + metadataHanGateIncidence.eliasFanoBytes,
			partitionedEliasFanoBytes:
				exactDocIncidence.partitionedEliasFanoBytes +
				metadataHanGateIncidence.partitionedEliasFanoBytes,
		},
	};
}

function replayQueries(corpus, queries, policy) {
	const summary = {
		totalQueries: queries.length,
		queriesWithoutHanBackstop: 0,
		queriesSolvedByMetadataOnly: 0,
		queriesRequiringBodyNarrowScan: 0,
		bodyScanDocsScanned: createPercentileSummary([]),
		bodyScanSegmentsScanned: createPercentileSummary([]),
		hanPromotionCount: createPercentileSummary([]),
	};
	const bodyPendingScanDocs = [];
	const bodyPendingScanSegments = [];
	const hanPromotionCounts = [];
	const notableQueries = {};

	for (const query of queries) {
		const profile = buildQueryProfile(query.query, corpus.exactIncidence);
		let bodyDocsScanned = 0;
		let bodySegmentsScanned = 0;
		let promotedCount = 0;
		let usedBodyScan = false;
		let solvedByMetadataOnly = true;

		for (const group of profile.activeHanGroups) {
			const metadataRanked = rankMetadataCandidates(group, corpus, policy.hanBackstopDocCapPerGroup);
			const metadataVerified = metadataRanked.filter((candidate) =>
				verifyMetadataCandidate(candidate.docId, group.normalizedText, corpus.documents),
			);
			const promotedDocIds = new Set(
				metadataVerified
					.slice(0, policy.hanBackstopDocCapPerQuery)
					.map((candidate) => candidate.docId),
			);
			if (metadataVerified.length === 0) {
				solvedByMetadataOnly = false;
			}
			const bodyMatches = [];
			for (const docId of corpus.bodyHanSegmentDocIds) {
				bodyDocsScanned += 1;
				const segments = corpus.bodyVerificationView.get(docId) ?? [];
				let matched = false;
				for (const segment of segments) {
					bodySegmentsScanned += 1;
					if (segment.includes(group.normalizedText)) {
						matched = true;
						break;
					}
				}
				if (matched) {
					bodyMatches.push(docId);
				}
			}
			if (bodyMatches.length > 0) {
				usedBodyScan = true;
			}
			for (const docId of bodyMatches) {
				if (promotedDocIds.size >= policy.hanBackstopDocCapPerQuery) {
					break;
				}
				promotedDocIds.add(docId);
			}
			promotedCount += promotedDocIds.size;

			if (NOTEWORTHY_QUERIES.has(query.query)) {
				notableQueries[query.query] = {
					metadataVerifiedPaths: metadataVerified.map((candidate) =>
						corpus.pathByDocId.get(candidate.docId) ?? String(candidate.docId),
					),
					bodyMatchedPaths: bodyMatches.map((docId) =>
						corpus.pathByDocId.get(docId) ?? String(docId),
					),
					promotedPaths: [...promotedDocIds].map((docId) =>
						corpus.pathByDocId.get(docId) ?? String(docId),
					),
				};
			}
		}

		if (profile.activeHanGroups.length === 0) {
			summary.queriesWithoutHanBackstop += 1;
		}
		if (profile.activeHanGroups.length > 0 && solvedByMetadataOnly) {
			summary.queriesSolvedByMetadataOnly += 1;
		}
		if (usedBodyScan) {
			summary.queriesRequiringBodyNarrowScan += 1;
		}
		bodyPendingScanDocs.push(bodyDocsScanned);
		bodyPendingScanSegments.push(bodySegmentsScanned);
		hanPromotionCounts.push(promotedCount);
	}

	summary.bodyScanDocsScanned = createPercentileSummary(bodyPendingScanDocs);
	summary.bodyScanSegmentsScanned = createPercentileSummary(bodyPendingScanSegments);
	summary.hanPromotionCount = createPercentileSummary(hanPromotionCounts);

	return {
		summary,
		bodyPendingScanWork: {
			docsScannedDistribution: createPercentileSummary(bodyPendingScanDocs),
			segmentsScannedDistribution: createPercentileSummary(bodyPendingScanSegments),
		},
		notableQueries,
	};
}

function buildQueryProfile(queryText, exactIncidence) {
	const normalizedQuery = normalizeText(queryText);
	const queryTokens = tokenizeText(queryText);
	const hanTokens = queryTokens.filter(isHanToken);
	const activeHanGroups = [];
	for (const segment of extractHanSegments(queryText)) {
		const normalizedSegment = normalizeText(segment);
		if (Array.from(normalizedSegment).length < 2) {
			continue;
		}
		const hasExactHanToken = hanTokens.includes(normalizedSegment);
		const exactCandidateCount = hasExactHanToken
			? getFieldIncidenceDocCount(exactIncidence, normalizedSegment)
			: 0;
		if (!hasExactHanToken || exactCandidateCount === 0) {
			activeHanGroups.push({
				normalizedText: normalizedSegment,
				bigrams: extractHanBigrams(normalizedSegment),
				triggerKind: hasExactHanToken ? "fragile_covered" : "residual",
			});
		}
	}
	return {
		normalizedQuery,
		queryTokens,
		activeHanGroups,
	};
}

function rankMetadataCandidates(group, corpus, docCapPerGroup) {
	const matchedBigramIndicesByDoc = new Map();
	for (let bigramIndex = 0; bigramIndex < group.bigrams.length; bigramIndex += 1) {
		const bigram = group.bigrams[bigramIndex];
		for (const field of METADATA_FIELDS) {
			const postings = corpus.metadataHanGateIncidence.get(`${field}:${bigram}`);
			if (!postings) {
				continue;
			}
			for (const docId of postings) {
				const fieldMap = matchedBigramIndicesByDoc.get(docId) ?? new Map();
				const indices = fieldMap.get(field) ?? new Set();
				indices.add(bigramIndex);
				fieldMap.set(field, indices);
				matchedBigramIndicesByDoc.set(docId, fieldMap);
			}
		}
	}

	return [...matchedBigramIndicesByDoc.entries()]
		.map(([docId, fieldMap]) => ({
			docId,
			stats: buildGateStats(group.bigrams.length, fieldMap),
			stableDeterministicKey: corpus.pathByDocId.get(docId) ?? String(docId),
		}))
		.filter((candidate) => passesGate(group.bigrams.length, candidate.stats))
		.sort(compareRankedCandidates)
		.slice(0, docCapPerGroup);
}

function verifyMetadataCandidate(docId, normalizedText, documents) {
	const document = documents.find((candidate) => candidate.docId === docId);
	if (!document) {
		return false;
	}
	for (const field of METADATA_FIELDS) {
		const normalizedField = normalizeText(document[field === "tag" ? "tags" : field]);
		if (normalizedField.includes(normalizedText)) {
			return true;
		}
	}
	return false;
}

function buildIncidencePrimitive(incidence) {
	const dictionary = new Set();
	let postingEntryCount = 0;
	for (const [key, docIds] of incidence.entries()) {
		dictionary.add(key.slice(key.indexOf(":") + 1));
		postingEntryCount += docIds.length;
	}
	const dictionaryBytes = sumUtf8Bytes(dictionary);
	const uint32Bytes = postingEntryCount * 4;
	return {
		dictionaryBytes,
		postingEntryCount,
		postingUint32Bytes: uint32Bytes,
		totalBytes: dictionaryBytes + uint32Bytes,
	};
}

function buildIncidenceCodecEstimates(incidence, documentCount) {
	let uint32Bytes = 0;
	let deltaVarintBytes = 0;
	let blockPackedBytes = 0;
	let eliasFanoBytes = 0;
	let partitionedEliasFanoBytes = 0;
	for (const docIds of incidence.values()) {
		uint32Bytes += docIds.length * 4;
		deltaVarintBytes += estimateVarintPostingBytes(docIds);
		blockPackedBytes += estimateBlockPackedPostingBytes(docIds);
		eliasFanoBytes += estimateEliasFanoBytes(docIds, documentCount);
		partitionedEliasFanoBytes += estimatePartitionedEliasFanoBytes(docIds, documentCount);
	}
	return {
		uint32Bytes,
		deltaVarintBytes,
		blockPackedBytes,
		eliasFanoBytes,
		partitionedEliasFanoBytes,
	};
}

function buildBodyVerificationView(bodyVerificationView) {
	let segmentCount = 0;
	let segmentUtf8Bytes = 0;
	for (const segments of bodyVerificationView.values()) {
		segmentCount += segments.length;
		for (const segment of segments) {
			segmentUtf8Bytes += utf8Bytes(segment);
		}
	}
	return {
		segmentCount,
		segmentUtf8Bytes,
		totalBytes: segmentUtf8Bytes,
	};
}

function buildProximitySequenceView(proximityTokenSequences) {
	const lexicon = new Set();
	let bodyTokenCount = 0;
	let metadataTokenCount = 0;
	for (const sequences of proximityTokenSequences.values()) {
		for (const token of sequences.body) {
			lexicon.add(token);
			bodyTokenCount += 1;
		}
		for (const token of sequences.metadata) {
			lexicon.add(token);
			metadataTokenCount += 1;
		}
	}
	const lexiconUtf8Bytes = sumUtf8Bytes(lexicon);
	const tokenIdBytes = (bodyTokenCount + metadataTokenCount) * 4;
	return {
		uniqueTokenCount: lexicon.size,
		lexiconUtf8Bytes,
		bodyTokenCount,
		metadataTokenCount,
		tokenIdBytes,
		totalBytes: lexiconUtf8Bytes + tokenIdBytes,
	};
}

function appendDocId(incidence, key, docId) {
	const postings = incidence.get(key) ?? [];
	if (postings.length === 0 || postings[postings.length - 1] !== docId) {
		postings.push(docId);
	}
	incidence.set(key, postings);
}

function getFieldIncidenceDocCount(exactIncidence, term) {
	const docIds = new Set();
	for (const field of EXACT_FIELDS) {
		for (const docId of exactIncidence.get(`${field}:${term}`) ?? []) {
			docIds.add(docId);
		}
	}
	return docIds.size;
}

function buildGateStats(totalBigramCount, matchedBigramIndicesByField) {
	let best = {
		longestContiguousBigramChain: 0,
		matchedBigramCount: 0,
		bigramCoverageRatio: 0,
	};
	for (const indices of matchedBigramIndicesByField.values()) {
		const stats = {
			longestContiguousBigramChain: longestContiguousChain(indices),
			matchedBigramCount: indices.size,
			bigramCoverageRatio: totalBigramCount > 0 ? indices.size / totalBigramCount : 0,
		};
		if (compareStats(stats, best) < 0) {
			best = stats;
		}
	}
	return best;
}

function passesGate(totalBigramCount, stats) {
	if (totalBigramCount <= 1) {
		return stats.matchedBigramCount === totalBigramCount;
	}
	if (totalBigramCount === 2) {
		return stats.matchedBigramCount === totalBigramCount;
	}
	return stats.matchedBigramCount >= 2 && stats.longestContiguousBigramChain >= 2;
}

function compareRankedCandidates(left, right) {
	const statsOrder = compareStats(left.stats, right.stats);
	if (statsOrder !== 0) {
		return statsOrder;
	}
	return left.stableDeterministicKey.localeCompare(right.stableDeterministicKey);
}

function compareStats(left, right) {
	if (left.longestContiguousBigramChain !== right.longestContiguousBigramChain) {
		return right.longestContiguousBigramChain - left.longestContiguousBigramChain;
	}
	if (left.matchedBigramCount !== right.matchedBigramCount) {
		return right.matchedBigramCount - left.matchedBigramCount;
	}
	if (left.bigramCoverageRatio !== right.bigramCoverageRatio) {
		return right.bigramCoverageRatio - left.bigramCoverageRatio;
	}
	return 0;
}

function longestContiguousChain(indices) {
	const sorted = [...indices].sort((left, right) => left - right);
	let longest = 0;
	let current = 0;
	let previous = Number.NaN;
	for (const index of sorted) {
		if (!Number.isFinite(previous) || index === previous + 1) {
			current += 1;
		} else {
			current = 1;
		}
		if (current > longest) {
			longest = current;
		}
		previous = index;
	}
	return longest;
}

function estimateVarintPostingBytes(docIds) {
	let previous = 0;
	let total = 0;
	for (const docId of docIds) {
		total += varintLength(docId - previous);
		previous = docId;
	}
	return total;
}

function estimateBlockPackedPostingBytes(docIds) {
	const blockSize = 128;
	let total = 0;
	let previous = 0;
	for (let index = 0; index < docIds.length; index += blockSize) {
		const block = docIds.slice(index, index + blockSize);
		const deltas = [];
		for (const docId of block) {
			deltas.push(docId - previous);
			previous = docId;
		}
		const maxDelta = deltas.reduce((max, value) => Math.max(max, value), 0);
		const bits = maxDelta <= 0 ? 0 : Math.ceil(Math.log2(maxDelta + 1));
		total += Math.ceil((bits * deltas.length) / 8) + 4;
	}
	return total;
}

function estimateEliasFanoBytes(docIds, documentCount) {
	if (docIds.length === 0) {
		return 0;
	}
	const universe = Math.max(documentCount, docIds[docIds.length - 1] + 1);
	const valueCount = docIds.length;
	const lowerBits = Math.max(0, Math.floor(Math.log2(universe / valueCount)));
	const totalBits = valueCount * (lowerBits + 2);
	return Math.ceil(totalBits / 8);
}

function estimatePartitionedEliasFanoBytes(docIds, documentCount) {
	const blockSize = 128;
	let total = 0;
	for (let index = 0; index < docIds.length; index += blockSize) {
		total += estimateEliasFanoBytes(
			docIds.slice(index, index + blockSize),
			documentCount,
		);
		total += 4;
	}
	return total;
}

function createPercentileSummary(values) {
	if (values.length === 0) {
		return { count: 0, min: 0, p50: 0, p95: 0, p99: 0, max: 0, average: 0 };
	}
	const sorted = [...values].sort((left, right) => left - right);
	const total = sorted.reduce((sum, value) => sum + value, 0);
	return {
		count: sorted.length,
		min: sorted[0],
		p50: percentile(sorted, 0.5),
		p95: percentile(sorted, 0.95),
		p99: percentile(sorted, 0.99),
		max: sorted[sorted.length - 1],
		average: total / sorted.length,
	};
}

function percentile(sortedValues, ratio) {
	if (sortedValues.length === 0) {
		return 0;
	}
	const index = Math.min(
		sortedValues.length - 1,
		Math.max(0, Math.ceil(sortedValues.length * ratio) - 1),
	);
	return sortedValues[index];
}

function resolveHanPolicy(maxItemResults) {
	const frontierTarget = Math.min(96, Math.max(24, maxItemResults * 3));
	const returnTarget = maxItemResults + 4;
	return {
		frontierTarget,
		returnTarget,
		hanBackstopDocCapPerGroup: Math.min(frontierTarget, Math.max(returnTarget, 8)),
		hanBackstopDocCapPerQuery: frontierTarget,
	};
}

function tokenizeText(text) {
	return normalizeText(text).match(/[\p{Script=Han}]+|[a-z0-9_-]+/gu) ?? [];
}

function extractHanSegments(text) {
	return normalizeText(text).match(/[\p{Script=Han}]+/gu) ?? [];
}

function extractHanBigrams(text) {
	const bigrams = [];
	for (const segment of extractHanSegments(text)) {
		const chars = Array.from(segment);
		for (let index = 0; index < chars.length - 1; index += 1) {
			bigrams.push(chars[index] + chars[index + 1]);
		}
	}
	return [...new Set(bigrams)];
}

function normalizeText(text) {
	return String(text).toLowerCase().normalize("NFKC");
}

function isHanToken(token) {
	return /[\p{Script=Han}]/u.test(token);
}

function utf8Bytes(text) {
	return Buffer.byteLength(String(text), "utf8");
}

function sumUtf8Bytes(values) {
	let total = 0;
	for (const value of values) {
		total += utf8Bytes(value);
	}
	return total;
}

function varintLength(value) {
	let remaining = Math.max(0, value >>> 0);
	let bytes = 1;
	while (remaining >= 0x80) {
		remaining >>>= 7;
		bytes += 1;
	}
	return bytes;
}

function safeRatio(numerator, denominator) {
	if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
		return null;
	}
	return numerator / denominator;
}

function extractCurrentHotBytes(breakdown) {
	if (!breakdown || typeof breakdown !== "object") {
		return null;
	}
	return breakdown.estimatedBytes?.total ?? null;
}

main();
