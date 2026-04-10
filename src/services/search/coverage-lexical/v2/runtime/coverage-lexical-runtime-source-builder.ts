import type {
	CoverageLexicalV2MatchField,
	CoverageLexicalV2MatchedPrimaryUnitEvidence,
} from '../ranking';
import type {
	CoverageLexicalV2RuntimeSourceEntry,
} from './coverage-lexical-runtime-adapter';

export type CoverageLexicalV2RuntimeFieldTerms = {
	basenameTerms?: readonly string[];
	aliasTerms?: readonly string[];
	headingsTerms?: readonly string[];
	folderTerms?: readonly string[];
	tagTerms?: readonly string[];
	bodyTerms?: readonly string[];
};

export type CoverageLexicalV2RuntimeDocumentLexicalState = {
	docId: string | number;
	path: string;
	stableDeterministicKey?: string;
	fieldTerms: CoverageLexicalV2RuntimeFieldTerms;
	basenameTokenSequence?: readonly string[];
	aliasTokenSequence?: readonly string[];
	headingsTokenSequence?: readonly string[];
	bodyTokenSequence?: readonly string[];
};

type CoverageLexicalV2RuntimeLocalWindowField = Extract<
	CoverageLexicalV2MatchField,
	'basename' | 'aliases' | 'headings' | 'body'
>;

type CoverageLexicalV2RuntimeResolvedBestWindow = {
	field: CoverageLexicalV2RuntimeLocalWindowField;
	matchedUnitKeys: string[];
	windowWidth: number;
	averageDistance: number;
	preservesSurfaceOrder: boolean;
};

const COVERAGE_LEXICAL_V2_RUNTIME_LOCAL_WINDOW_FIELDS: readonly CoverageLexicalV2RuntimeLocalWindowField[] = [
	'basename',
	'aliases',
	'headings',
	'body',
];

const COVERAGE_LEXICAL_V2_RUNTIME_LOCAL_WINDOW_FIELD_PRIORITY: Record<
	CoverageLexicalV2RuntimeLocalWindowField,
	number
> = {
	basename: 0,
	aliases: 1,
	headings: 2,
	body: 3,
};

export function buildCoverageLexicalV2RuntimeSourceEntries(
	queryTerms: readonly string[],
	documents: readonly CoverageLexicalV2RuntimeDocumentLexicalState[],
): CoverageLexicalV2RuntimeSourceEntry[] {
	const normalizedQueryTerms = queryTerms
		.map((term) => term.trim().toLowerCase())
		.filter((term) => term.length > 0);
	const sourceEntries: CoverageLexicalV2RuntimeSourceEntry[] = [];
	for (const document of documents) {
		const matchedPrimaryUnits = buildMatchedPrimaryUnits(normalizedQueryTerms, document.fieldTerms);
		if (matchedPrimaryUnits.length === 0) {
			continue;
		}
		sourceEntries.push({
			docId: document.docId,
			path: document.path,
			stableDeterministicKey: document.stableDeterministicKey ?? document.path,
			sourceKind: matchedPrimaryUnits.some((unit) => unit.strongestField !== 'body') ? 'metadata' : 'body',
			matchedPrimaryUnits,
			bestWindow: buildCoverageLexicalV2RuntimeBestWindow(
				normalizedQueryTerms,
				matchedPrimaryUnits,
				document,
			),
		});
	}
	return sourceEntries;
}

function buildMatchedPrimaryUnits(
	queryTerms: readonly string[],
	fieldTerms: CoverageLexicalV2RuntimeFieldTerms,
): CoverageLexicalV2MatchedPrimaryUnitEvidence[] {
	const basenameTerms = new Set(normalizeTerms(fieldTerms.basenameTerms));
	const aliasTerms = new Set(normalizeTerms(fieldTerms.aliasTerms));
	const headingsTerms = new Set(normalizeTerms(fieldTerms.headingsTerms));
	const folderTerms = new Set(normalizeTerms(fieldTerms.folderTerms));
	const tagTerms = new Set(normalizeTerms(fieldTerms.tagTerms));
	const bodyTerms = new Set(normalizeTerms(fieldTerms.bodyTerms));
	const units: CoverageLexicalV2MatchedPrimaryUnitEvidence[] = [];
	for (let index = 0; index < queryTerms.length; index += 1) {
		const term = queryTerms[index];
		const matchedFields = collectMatchedFields(term, {
			basenameTerms,
			aliasTerms,
			headingsTerms,
			folderTerms,
			tagTerms,
			bodyTerms,
		});
		if (matchedFields.length === 0) {
			continue;
		}
		units.push({
			normalizedText: term,
			surfaceGroupIndex: index,
			surfaceKind: classifySurfaceKind(term),
			strongestField: matchedFields[0],
			corroboratedFields: matchedFields.slice(1),
			matchQuality: 'exact',
		});
	}
	return units;
}

function buildCoverageLexicalV2RuntimeBestWindow(
	queryTerms: readonly string[],
	matchedPrimaryUnits: readonly CoverageLexicalV2MatchedPrimaryUnitEvidence[],
	document: CoverageLexicalV2RuntimeDocumentLexicalState,
): CoverageLexicalV2RuntimeSourceEntry['bestWindow'] {
	let bestWindow: CoverageLexicalV2RuntimeResolvedBestWindow | null = null;
	for (const field of COVERAGE_LEXICAL_V2_RUNTIME_LOCAL_WINDOW_FIELDS) {
		const candidateWindow = buildCoverageLexicalV2RuntimeFieldBestWindow(
			queryTerms,
			matchedPrimaryUnits,
			field,
			getCoverageLexicalV2RuntimeFieldTokenSequence(document, field),
		);
		if (
			candidateWindow != null &&
			(bestWindow == null || isBetterCoverageLexicalV2RuntimeBestWindow(candidateWindow, bestWindow))
		) {
			bestWindow = candidateWindow;
		}
	}
	return bestWindow;
}

function buildCoverageLexicalV2RuntimeFieldBestWindow(
	queryTerms: readonly string[],
	matchedPrimaryUnits: readonly CoverageLexicalV2MatchedPrimaryUnitEvidence[],
	field: CoverageLexicalV2RuntimeLocalWindowField,
	tokenSequence: readonly string[] | undefined,
): CoverageLexicalV2RuntimeResolvedBestWindow | null {
	if (!tokenSequence || tokenSequence.length === 0) {
		return null;
	}
	const relevantUnits = matchedPrimaryUnits.filter(
		(unit) => unit.strongestField === field || (unit.corroboratedFields ?? []).includes(field),
	);
	if (relevantUnits.length === 0) {
		return null;
	}
	const relevantUnitByKey = new Map<string, CoverageLexicalV2MatchedPrimaryUnitEvidence>();
	for (const unit of relevantUnits) {
		relevantUnitByKey.set(createCoverageLexicalV2RuntimeUnitKey(unit.surfaceGroupIndex, unit.normalizedText), unit);
	}
	const normalizedTokens = normalizeTerms(tokenSequence);
	const occurrences: Array<{
		unitKey: string;
		groupIndex: number;
		position: number;
	}> = [];
	for (let position = 0; position < normalizedTokens.length; position += 1) {
		const token = normalizedTokens[position];
		for (let index = 0; index < queryTerms.length; index += 1) {
			if (token !== queryTerms[index]) {
				continue;
			}
			const unitKey = createCoverageLexicalV2RuntimeUnitKey(index, token);
			const relevantUnit = relevantUnitByKey.get(unitKey);
			if (!relevantUnit) {
				continue;
			}
			occurrences.push({
				unitKey,
				groupIndex: relevantUnit.surfaceGroupIndex,
				position,
			});
		}
	}
	if (occurrences.length === 0) {
		return null;
	}
	const requiredUnitKeys = new Set(relevantUnitByKey.keys());
	let bestWindow:
		| {
				start: number;
				end: number;
				matchedUnitKeys: string[];
				groupIndices: number[];
		  }
		| null = null;
	const windowCounts = new Map<string, number>();
	let distinctUnitCount = 0;
	let start = 0;
	for (let end = 0; end < occurrences.length; end += 1) {
		const endOccurrence = occurrences[end];
		const previousCount = windowCounts.get(endOccurrence.unitKey) ?? 0;
		windowCounts.set(endOccurrence.unitKey, previousCount + 1);
		if (previousCount === 0) {
			distinctUnitCount += 1;
		}
		while (distinctUnitCount >= requiredUnitKeys.size && start <= end) {
			const startOccurrence = occurrences[start];
			const candidateWindow = {
				start: startOccurrence.position,
				end: endOccurrence.position,
				matchedUnitKeys: dedupeCoverageLexicalV2RuntimeWindowUnitKeys(occurrences, start, end),
				groupIndices: occurrences.slice(start, end + 1).map((occurrence) => occurrence.groupIndex),
			};
			if (
				bestWindow == null ||
				isBetterCoverageLexicalV2RuntimeWindowShape(candidateWindow, bestWindow)
			) {
				bestWindow = candidateWindow;
			}
			const nextCount = (windowCounts.get(startOccurrence.unitKey) ?? 1) - 1;
			if (nextCount <= 0) {
				windowCounts.delete(startOccurrence.unitKey);
				distinctUnitCount -= 1;
			} else {
				windowCounts.set(startOccurrence.unitKey, nextCount);
			}
			start += 1;
		}
	}
	if (bestWindow == null) {
		const single = occurrences[0];
		return {
			field,
			matchedUnitKeys: [single.unitKey],
			windowWidth: 1,
			averageDistance: 0,
			preservesSurfaceOrder: true,
		};
	}
	return {
		field,
		matchedUnitKeys: bestWindow.matchedUnitKeys,
		windowWidth: bestWindow.end - bestWindow.start + 1,
		averageDistance: computeCoverageLexicalV2RuntimeAverageDistance(
			bestWindow.groupIndices.length,
			bestWindow.end - bestWindow.start,
		),
		preservesSurfaceOrder: preservesCoverageLexicalV2RuntimeSurfaceOrder(bestWindow.groupIndices),
	};
}

function getCoverageLexicalV2RuntimeFieldTokenSequence(
	document: CoverageLexicalV2RuntimeDocumentLexicalState,
	field: CoverageLexicalV2RuntimeLocalWindowField,
): readonly string[] | undefined {
	switch (field) {
		case 'basename':
			return document.basenameTokenSequence;
		case 'aliases':
			return document.aliasTokenSequence;
		case 'headings':
			return document.headingsTokenSequence;
		case 'body':
			return document.bodyTokenSequence;
	}
}

function collectMatchedFields(
	term: string,
	terms: {
		basenameTerms: ReadonlySet<string>;
		aliasTerms: ReadonlySet<string>;
		headingsTerms: ReadonlySet<string>;
		folderTerms: ReadonlySet<string>;
		tagTerms: ReadonlySet<string>;
		bodyTerms: ReadonlySet<string>;
	},
): Array<'basename' | 'aliases' | 'headings' | 'folder' | 'tag' | 'body'> {
	const fields: Array<'basename' | 'aliases' | 'headings' | 'folder' | 'tag' | 'body'> = [];
	if (terms.basenameTerms.has(term)) {
		fields.push('basename');
	}
	if (terms.aliasTerms.has(term)) {
		fields.push('aliases');
	}
	if (terms.headingsTerms.has(term)) {
		fields.push('headings');
	}
	if (terms.folderTerms.has(term)) {
		fields.push('folder');
	}
	if (terms.tagTerms.has(term)) {
		fields.push('tag');
	}
	if (terms.bodyTerms.has(term)) {
		fields.push('body');
	}
	return fields;
}

function normalizeTerms(terms: readonly string[] | undefined): string[] {
	return (terms ?? []).map((term) => term.trim().toLowerCase()).filter((term) => term.length > 0);
}

function isBetterCoverageLexicalV2RuntimeBestWindow(
	left: CoverageLexicalV2RuntimeResolvedBestWindow,
	right: CoverageLexicalV2RuntimeResolvedBestWindow,
): boolean {
	if (left.matchedUnitKeys.length !== right.matchedUnitKeys.length) {
		return left.matchedUnitKeys.length > right.matchedUnitKeys.length;
	}
	if (left.preservesSurfaceOrder !== right.preservesSurfaceOrder) {
		return left.preservesSurfaceOrder;
	}
	if (left.windowWidth !== right.windowWidth) {
		return left.windowWidth < right.windowWidth;
	}
	if (left.averageDistance !== right.averageDistance) {
		return left.averageDistance < right.averageDistance;
	}
	const leftPriority = COVERAGE_LEXICAL_V2_RUNTIME_LOCAL_WINDOW_FIELD_PRIORITY[left.field];
	const rightPriority = COVERAGE_LEXICAL_V2_RUNTIME_LOCAL_WINDOW_FIELD_PRIORITY[right.field];
	if (leftPriority !== rightPriority) {
		return leftPriority < rightPriority;
	}
	return false;
}

function isBetterCoverageLexicalV2RuntimeWindowShape(
	left: {
		start: number;
		end: number;
		matchedUnitKeys: string[];
		groupIndices: number[];
	},
	right: {
		start: number;
		end: number;
		matchedUnitKeys: string[];
		groupIndices: number[];
	},
): boolean {
	if (left.matchedUnitKeys.length !== right.matchedUnitKeys.length) {
		return left.matchedUnitKeys.length > right.matchedUnitKeys.length;
	}
	const leftPreservesOrder = preservesCoverageLexicalV2RuntimeSurfaceOrder(left.groupIndices);
	const rightPreservesOrder = preservesCoverageLexicalV2RuntimeSurfaceOrder(right.groupIndices);
	if (leftPreservesOrder !== rightPreservesOrder) {
		return leftPreservesOrder;
	}
	const leftWindowWidth = left.end - left.start + 1;
	const rightWindowWidth = right.end - right.start + 1;
	if (leftWindowWidth !== rightWindowWidth) {
		return leftWindowWidth < rightWindowWidth;
	}
	const leftAverageDistance = computeCoverageLexicalV2RuntimeAverageDistance(
		left.groupIndices.length,
		left.end - left.start,
	);
	const rightAverageDistance = computeCoverageLexicalV2RuntimeAverageDistance(
		right.groupIndices.length,
		right.end - right.start,
	);
	if (leftAverageDistance !== rightAverageDistance) {
		return leftAverageDistance < rightAverageDistance;
	}
	return left.start < right.start;
}

function dedupeCoverageLexicalV2RuntimeWindowUnitKeys(
	occurrences: ReadonlyArray<{ unitKey: string }>,
	start: number,
	end: number,
): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (let index = start; index <= end; index += 1) {
		const unitKey = occurrences[index].unitKey;
		if (seen.has(unitKey)) {
			continue;
		}
		seen.add(unitKey);
		out.push(unitKey);
	}
	return out;
}

function preservesCoverageLexicalV2RuntimeSurfaceOrder(groupIndices: readonly number[]): boolean {
	for (let index = 1; index < groupIndices.length; index += 1) {
		if (groupIndices[index] < groupIndices[index - 1]) {
			return false;
		}
	}
	return true;
}

function computeCoverageLexicalV2RuntimeAverageDistance(
	groupCount: number,
	span: number,
): number {
	if (groupCount <= 1) {
		return 0;
	}
	return span / (groupCount - 1);
}

function createCoverageLexicalV2RuntimeUnitKey(
	surfaceGroupIndex: number,
	normalizedText: string,
): string {
	return String(surfaceGroupIndex) + ':' + normalizedText;
}

function classifySurfaceKind(term: string): 'latin' | 'han' | 'mixed' {
	const hasLatin = /[a-z0-9]/i.test(term);
	const hasHan = /\p{Script=Han}/u.test(term);
	if (hasLatin && hasHan) {
		return 'mixed';
	}
	if (hasHan) {
		return 'han';
	}
	return 'latin';
}
