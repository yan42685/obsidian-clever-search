import type {
	CoverageLexicalV2MatchedPrimaryUnitEvidence,
} from "../ranking";
import type {
	CoverageLexicalV2RuntimeSourceEntry,
} from "./coverage-lexical-runtime-adapter";

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
};

export function buildCoverageLexicalV2RuntimeSourceEntries(
	queryTerms: readonly string[],
	documents: readonly CoverageLexicalV2RuntimeDocumentLexicalState[],
): CoverageLexicalV2RuntimeSourceEntry[] {
	const normalizedQueryTerms = queryTerms.map((term) => term.trim().toLowerCase()).filter((term) => term.length > 0);
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
			sourceKind: matchedPrimaryUnits.some((unit) => unit.strongestField !== "body") ? "metadata" : "body",
			matchedPrimaryUnits,
			bestWindow: null,
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
			matchQuality: "exact",
		});
	}
	return units;
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
): Array<"basename" | "aliases" | "headings" | "folder" | "tag" | "body"> {
	const fields: Array<"basename" | "aliases" | "headings" | "folder" | "tag" | "body"> = [];
	if (terms.basenameTerms.has(term)) {
		fields.push("basename");
	}
	if (terms.aliasTerms.has(term)) {
		fields.push("aliases");
	}
	if (terms.headingsTerms.has(term)) {
		fields.push("headings");
	}
	if (terms.folderTerms.has(term)) {
		fields.push("folder");
	}
	if (terms.tagTerms.has(term)) {
		fields.push("tag");
	}
	if (terms.bodyTerms.has(term)) {
		fields.push("body");
	}
	return fields;
}

function normalizeTerms(terms: readonly string[] | undefined): string[] {
	return (terms ?? []).map((term) => term.trim().toLowerCase()).filter((term) => term.length > 0);
}

function classifySurfaceKind(term: string): "latin" | "han" | "mixed" {
	const hasLatin = /[a-z0-9]/i.test(term);
	const hasHan = /\p{Script=Han}/u.test(term);
	if (hasLatin && hasHan) {
		return "mixed";
	}
	if (hasHan) {
		return "han";
	}
	return "latin";
}
