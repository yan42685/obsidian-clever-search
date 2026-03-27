import fs from "fs";

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeCandidate(candidate, index) {
	if (!candidate || typeof candidate !== "object") {
		throw new Error(`Candidate at index ${index} must be an object`);
	}
	const values =
		"values" in candidate && candidate.values && typeof candidate.values === "object"
			? candidate.values
			: candidate;
	const label =
		typeof candidate.label === "string" && candidate.label.trim().length > 0
			? candidate.label.trim()
			: `candidate-${index + 1}`;
	const numericValues = {};
	for (const [key, value] of Object.entries(values)) {
		if (key === "label") {
			continue;
		}
		if (typeof value !== "number" || !Number.isFinite(value)) {
			throw new Error(
				`Candidate "${label}" uses non-numeric value for "${key}"`,
			);
		}
		numericValues[key] = value;
	}
	if (Object.keys(numericValues).length === 0) {
		throw new Error(`Candidate "${label}" did not provide any numeric values`);
	}
	return {
		label,
		values: numericValues,
	};
}

function replaceProperty(sourceText, propertyName, numericValue) {
	const pattern = new RegExp(
		`(${escapeRegex(propertyName)}\\s*:\\s*)(-?\\d+(?:\\.\\d+)?)(\\b)`,
	);
	if (!pattern.test(sourceText)) {
		throw new Error(`Unable to find numeric property ${propertyName}`);
	}
	return sourceText.replace(pattern, `$1${numericValue}$3`);
}

export function readParameterFile(filePath) {
	return fs.readFileSync(filePath, "utf8");
}

export function readCandidateManifest(filePath) {
	if (!filePath || !fs.existsSync(filePath)) {
		return [];
	}
	const raw = fs.readFileSync(filePath, "utf8").trim();
	if (!raw) {
		return [];
	}
	const parsed = JSON.parse(raw);
	const candidates = Array.isArray(parsed) ? parsed : parsed.candidates;
	if (!Array.isArray(candidates)) {
		throw new Error("Candidate manifest must be an array or { candidates: [] }");
	}
	return candidates.map(normalizeCandidate);
}

export function patchTuningValues(sourceText, candidate) {
	let next = sourceText;
	for (const [propertyName, numericValue] of Object.entries(candidate.values)) {
		next = replaceProperty(next, propertyName, numericValue);
	}
	return next;
}

export function extractCurrentTuningProfile(sourceText) {
	const profile = {};
	const propertyRegex = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(-?\d+(?:\.\d+)?)\s*,?\s*$/gm;
	let match;
	while ((match = propertyRegex.exec(sourceText)) !== null) {
		profile[match[1]] = Number(match[2]);
	}
	return profile;
}
