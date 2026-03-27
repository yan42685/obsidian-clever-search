import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
	DEFAULT_LANE,
	DEFAULT_PARAMETER_TARGET_FILE,
	buildLaneCandidateFile,
	sanitizeLaneName,
} from "./config.mjs";
import { extractCurrentTuningProfile, readParameterFile } from "./search-space.mjs";

const TUNING_BOUNDS = {
	targetTokens: { min: 72, max: 192 },
	minTokens: { min: 32, max: 96 },
	overlapTokens: { min: 16, max: 96 },
	fileMetadataPrior: { min: 0.12, max: 0.45 },
	fileCoverageBonus: { min: 0.8, max: 1.5 },
	fileMetadataAnchorBlend: { min: 0.45, max: 1.2 },
	fileMixedQueryBodyMetadataBonus: { min: 0.35, max: 1.1 },
	passageLocalityCoverageWeight: { min: 0.25, max: 0.9 },
	passageLocalityOrderWeight: { min: 0.15, max: 0.75 },
	passageLocalityCompactnessWeight: { min: 0.3, max: 1.2 },
	passageLocalityTightWindowBonus: { min: 0.1, max: 0.6 },
	verifierCoverageWeight: { min: 0.5, max: 1.4 },
	verifierOrderWeight: { min: 0.35, max: 1.2 },
	verifierCompactnessWeight: { min: 0.55, max: 1.7 },
	verifierExactPhraseBonus: { min: 1.2, max: 3.2 },
	verifierTightWindowBonus: { min: 0.2, max: 0.9 },
	verifierLocalWindowWeight: { min: 0.35, max: 1.15 },
	passageLocalityLocalWindowWeight: { min: 0.15, max: 0.75 },
	localWindowCoverageWeight: { min: 0.75, max: 1.6 },
	localWindowAnchorWeight: { min: 0.2, max: 0.9 },
	localWindowCompactnessWeight: { min: 0.45, max: 1.4 },
	localWindowOrderWeight: { min: 0.1, max: 0.7 },
	prefixFamilyVerifierCoverageBonus: { min: 0.1, max: 0.9 },
	prefixFamilyLocalityCoverageBonus: { min: 0.08, max: 0.6 },
	prefixFamilyOrderScale: { min: 0.18, max: 0.85 },
};

const LANE_TEMPLATES = {
	"mechanism-a": [
		{
			label: "coverage-heavy-tight-passages",
			factors: {
				targetTokens: 0.9,
				overlapTokens: 0.85,
				passageLocalityCoverageWeight: 1.12,
				verifierCoverageWeight: 1.1,
				localWindowCoverageWeight: 1.08,
			},
		},
		{
			label: "coverage-prior-body-first",
			factors: {
				fileMetadataPrior: 0.9,
				fileCoverageBonus: 1.08,
				passageLocalityCoverageWeight: 1.1,
				prefixFamilyVerifierCoverageBonus: 1.12,
			},
		},
		{
			label: "coverage-wide-window-guarded",
			factors: {
				targetTokens: 1.08,
				overlapTokens: 1.08,
				verifierCoverageWeight: 1.08,
				localWindowCoverageWeight: 1.06,
			},
		},
		{
			label: "coverage-locality-balanced",
			factors: {
				passageLocalityCoverageWeight: 1.08,
				passageLocalityCompactnessWeight: 1.05,
				verifierCoverageWeight: 1.08,
				prefixFamilyLocalityCoverageBonus: 1.12,
			},
		},
		{
			label: "coverage-lower-metadata-noise",
			factors: {
				fileMetadataPrior: 0.88,
				fileMixedQueryBodyMetadataBonus: 0.92,
				fileCoverageBonus: 1.06,
				verifierCoverageWeight: 1.06,
			},
		},
		{
			label: "coverage-recall-support",
			factors: {
				targetTokens: 1.05,
				overlapTokens: 1.12,
				prefixFamilyVerifierCoverageBonus: 1.12,
				prefixFamilyLocalityCoverageBonus: 1.08,
			},
		},
	],
	"mechanism-b": [
		{
			label: "locality-tight-window",
			factors: {
				passageLocalityCompactnessWeight: 1.12,
				passageLocalityTightWindowBonus: 1.12,
				localWindowCompactnessWeight: 1.1,
				verifierTightWindowBonus: 1.08,
			},
		},
		{
			label: "locality-order-forward",
			factors: {
				passageLocalityOrderWeight: 1.12,
				verifierOrderWeight: 1.1,
				localWindowOrderWeight: 1.12,
				prefixFamilyOrderScale: 1.08,
			},
		},
		{
			label: "verifier-strong-compact",
			factors: {
				verifierCompactnessWeight: 1.12,
				verifierExactPhraseBonus: 1.08,
				verifierLocalWindowWeight: 1.08,
				localWindowCompactnessWeight: 1.08,
			},
		},
		{
			label: "locality-slower-broader",
			factors: {
				targetTokens: 1.08,
				overlapTokens: 1.08,
				passageLocalityLocalWindowWeight: 1.1,
				verifierLocalWindowWeight: 1.08,
			},
		},
		{
			label: "locality-aggressive-tight",
			factors: {
				targetTokens: 0.92,
				overlapTokens: 0.9,
				passageLocalityCompactnessWeight: 1.08,
				verifierCompactnessWeight: 1.1,
			},
		},
		{
			label: "locality-order-compact-mix",
			factors: {
				passageLocalityOrderWeight: 1.08,
				passageLocalityCompactnessWeight: 1.06,
				localWindowOrderWeight: 1.08,
				localWindowCompactnessWeight: 1.06,
			},
		},
	],
	"mechanism-c": [
		{
			label: "route-body-heavier",
			factors: {
				fileMetadataPrior: 0.88,
				fileMetadataAnchorBlend: 0.92,
				fileMixedQueryBodyMetadataBonus: 0.94,
				localWindowAnchorWeight: 0.94,
			},
		},
		{
			label: "route-anchor-aware",
			factors: {
				fileMetadataAnchorBlend: 1.08,
				fileMixedQueryBodyMetadataBonus: 1.06,
				localWindowAnchorWeight: 1.1,
				prefixFamilyOrderScale: 1.06,
			},
		},
		{
			label: "route-tail-sensitive",
			factors: {
				fileMetadataPrior: 0.94,
				passageLocalityOrderWeight: 1.08,
				verifierOrderWeight: 1.06,
				prefixFamilyOrderScale: 1.12,
			},
		},
		{
			label: "route-metadata-conservative",
			factors: {
				fileMetadataPrior: 0.86,
				fileMetadataAnchorBlend: 0.9,
				fileMixedQueryBodyMetadataBonus: 0.9,
			},
		},
		{
			label: "route-body-anchor-balanced",
			factors: {
				fileMetadataPrior: 0.94,
				fileMetadataAnchorBlend: 1.04,
				fileMixedQueryBodyMetadataBonus: 1.08,
				localWindowAnchorWeight: 1.04,
			},
		},
		{
			label: "route-short-query-overlay",
			factors: {
				fileMetadataAnchorBlend: 1.08,
				localWindowAnchorWeight: 1.08,
				localWindowOrderWeight: 1.06,
				prefixFamilyOrderScale: 1.08,
			},
		},
	],
};

function round(value) {
	return Number(value.toFixed(6));
}

function clampProfileValue(name, value) {
	const bounds = TUNING_BOUNDS[name];
	if (!bounds) {
		return round(value);
	}
	return round(Math.min(bounds.max, Math.max(bounds.min, value)));
}

function applyTemplate(profile, template) {
	const values = {};
	for (const [name, factor] of Object.entries(template.factors ?? {})) {
		const currentValue = profile[name];
		if (typeof currentValue !== "number") {
			continue;
		}
		values[name] = clampProfileValue(name, currentValue * factor);
	}
	return {
		label: template.label,
		values,
	};
}

function generateFallbackCandidates(profile, lane, count, existingLabels) {
	const focusByLane = {
		"mechanism-a": [
			"passageLocalityCoverageWeight",
			"verifierCoverageWeight",
			"localWindowCoverageWeight",
			"fileCoverageBonus",
			"prefixFamilyVerifierCoverageBonus",
		],
		"mechanism-b": [
			"passageLocalityCompactnessWeight",
			"passageLocalityOrderWeight",
			"verifierCompactnessWeight",
			"verifierOrderWeight",
			"localWindowCompactnessWeight",
			"localWindowOrderWeight",
		],
		"mechanism-c": [
			"fileMetadataPrior",
			"fileMetadataAnchorBlend",
			"fileMixedQueryBodyMetadataBonus",
			"localWindowAnchorWeight",
			"prefixFamilyOrderScale",
		],
	};
	const focusFields = focusByLane[lane] ?? [];
	const mutationFactors = [0.92, 1.08, 0.88, 1.12];
	const candidates = [];
	let index = 0;
	while (candidates.length < count && focusFields.length > 0) {
		const left = focusFields[index % focusFields.length];
		const right = focusFields[(index + 1) % focusFields.length];
		const label = `auto-${lane}-${index + 1}`;
		index += 1;
		if (existingLabels.has(label)) {
			continue;
		}
		const factor = mutationFactors[(index - 1) % mutationFactors.length];
		const values = {};
		for (const field of [left, right]) {
			if (typeof profile[field] !== "number") {
				continue;
			}
			values[field] = clampProfileValue(field, profile[field] * factor);
		}
		if (Object.keys(values).length === 0) {
			continue;
		}
		existingLabels.add(label);
		candidates.push({ label, values });
	}
	return candidates;
}

export function generateLaneCandidateManifest({
	lane = DEFAULT_LANE,
	parameterFile = DEFAULT_PARAMETER_TARGET_FILE,
	maxCandidates = 6,
}) {
	const normalizedLane = sanitizeLaneName(lane);
	const sourceText = readParameterFile(parameterFile);
	const profile = extractCurrentTuningProfile(sourceText);
	const templates = LANE_TEMPLATES[normalizedLane] ?? [];
	const candidates = [];
	const existingLabels = new Set();
	for (const template of templates) {
		if (candidates.length >= maxCandidates) {
			break;
		}
		const candidate = applyTemplate(profile, template);
		if (Object.keys(candidate.values).length === 0) {
			continue;
		}
		if (existingLabels.has(candidate.label)) {
			continue;
		}
		existingLabels.add(candidate.label);
		candidates.push(candidate);
	}
	if (candidates.length < maxCandidates) {
		candidates.push(
			...generateFallbackCandidates(
				profile,
				normalizedLane,
				maxCandidates - candidates.length,
				existingLabels,
			),
		);
	}
	return {
		lane: normalizedLane,
		generatedAt: new Date().toISOString(),
		parameterFile,
		baselineProfile: profile,
		candidates: candidates.slice(0, maxCandidates),
	};
}

export function writeLaneCandidateManifest(manifest, outputFile) {
	const filePath =
		outputFile || buildLaneCandidateFile(manifest.lane || DEFAULT_LANE);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	return filePath;
}

function parseArgs(argv) {
	const args = {
		lane: DEFAULT_LANE,
		parameterFile: DEFAULT_PARAMETER_TARGET_FILE,
		maxCandidates: 6,
		outputFile: "",
	};
	for (const arg of argv.slice(2)) {
		if (arg.startsWith("--lane=")) {
			args.lane = arg.slice("--lane=".length);
		} else if (arg.startsWith("--parameter-file=")) {
			args.parameterFile = path.resolve(arg.slice("--parameter-file=".length));
		} else if (arg.startsWith("--max-candidates=")) {
			args.maxCandidates = Math.max(
				1,
				Number(arg.slice("--max-candidates=".length)) || 1,
			);
		} else if (arg.startsWith("--output-file=")) {
			args.outputFile = path.resolve(arg.slice("--output-file=".length));
		}
	}
	return args;
}

function main() {
	const args = parseArgs(process.argv);
	const manifest = generateLaneCandidateManifest(args);
	const outputFile = writeLaneCandidateManifest(manifest, args.outputFile);
	console.log(
		JSON.stringify(
			{
				lane: manifest.lane,
				outputFile,
				candidateCount: manifest.candidates.length,
			},
			null,
			2,
		),
	);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	main();
}
