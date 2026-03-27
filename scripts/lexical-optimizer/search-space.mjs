import fs from "fs";

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isSupportedValue(value) {
	return (
		(typeof value === "number" && Number.isFinite(value)) ||
		typeof value === "string" ||
		typeof value === "boolean"
	);
}

function formatLiteral(value) {
	if (typeof value === "string") {
		return JSON.stringify(value);
	}
	if (typeof value === "boolean") {
		return value ? "true" : "false";
	}
	return String(value);
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
		if (!isSupportedValue(value)) {
			throw new Error(
				`Candidate "${label}" uses unsupported value for "${key}"`,
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
		`(${escapeRegex(propertyName)}\\s*:\\s*)(-?\\d+(?:\\.\\d+)?|true|false|"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')(\\b|(?=,)|(?=\\n)|(?=\\r))`,
	);
	if (!pattern.test(sourceText)) {
		throw new Error(`Unable to find primitive property ${propertyName}`);
	}
	return sourceText.replace(pattern, `$1${formatLiteral(numericValue)}$3`);
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
	const propertyRegex =
		/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(-?\d+(?:\.\d+)?|true|false|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,?\s*$/gm;
	let match;
	while ((match = propertyRegex.exec(sourceText)) !== null) {
		const rawValue = match[2];
		if (rawValue === "true" || rawValue === "false") {
			profile[match[1]] = rawValue === "true";
			continue;
		}
		if (
			(rawValue.startsWith("\"") && rawValue.endsWith("\"")) ||
			(rawValue.startsWith("'") && rawValue.endsWith("'"))
		) {
			profile[match[1]] = JSON.parse(
				rawValue.startsWith("'")
					? `"${rawValue.slice(1, -1).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
					: rawValue,
			);
			continue;
		}
		profile[match[1]] = Number(rawValue);
	}
	return profile;
}
