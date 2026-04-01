import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";

const RELEASE_TYPES = new Set(["major", "minor", "patch"]);
const DEFAULT_RELEASE_TYPE = "patch";
const OPENAI_MODEL = "gpt-5.4";
const DEFAULT_OPENAI_API_BASE_URL = "https://api.openai.com/v1";
const OPENAI_TIMEOUT_MS = 60_000;
const MAX_CHANGELOG_CHARACTERS = 2000;
const ENV_CANDIDATE_PATHS = [
	".env.release.local",
	".env.release",
	".env.local",
	".env",
];

async function main() {
	const releaseType = normalizeReleaseType(process.argv[2]);

	ensureCleanWorktree();

	console.log("Generating changelog with GPT-5.4 before release...");
	const releaseNotesBody = await generateReleaseNotesBody();

	const manifestPath = "manifest.json";
	const originalManifestText = readFileSync(manifestPath, "utf8");
	const manifest = JSON.parse(originalManifestText);
	const oldVersion = manifest.version;
	const newVersion = bumpVersion(oldVersion, releaseType);
	manifest.version = newVersion;
	writeJson(manifestPath, manifest);
	console.log(`Version bumped: ${oldVersion} -> ${newVersion}`);

	console.log("Building plugin...");
	try {
		runCommand("pnpm build", { stdio: "inherit" });
	} catch (error) {
		writeFileSync(manifestPath, originalManifestText);
		throw error;
	}

	const date = new Date().toISOString().split("T")[0];
	const changelogEntry = buildChangelogEntry(
		newVersion,
		date,
		releaseNotesBody,
	);
	prependFile("CHANGELOG.md", changelogEntry);
	console.log("CHANGELOG.md updated");

	console.log("Creating release commit and tag...");
	runCommand("git add .");
	runCommand(`git commit -m "chore: release ${newVersion}"`);
	runCommand(`git tag ${newVersion}`);
	runCommand("git push", { stdio: "inherit" });
	runCommand("git push --tags", { stdio: "inherit" });

	console.log(`Release completed: ${newVersion}`);
}

function normalizeReleaseType(rawType) {
	if (RELEASE_TYPES.has(rawType)) {
		return rawType;
	}
	return DEFAULT_RELEASE_TYPE;
}

function ensureCleanWorktree() {
	const status = runCommand("git status --porcelain");
	if (status.trim().length > 0) {
		throw new Error("Worktree is not clean. Commit or stash changes before releasing.");
	}
}

async function generateReleaseNotesBody() {
	const commitLines = collectReleaseCommitLines();
	if (commitLines.length === 0) {
		throw new Error("No commits found since the last release. Abort release.");
	}

	const apiKey = resolveOpenAIApiKey();
	const apiBaseUrl = resolveOpenAIBaseUrl();
	if (!apiKey) {
		throw new Error(
			[
				"Missing OpenAI API key for release changelog generation.",
				"Please confirm both API key and base URL are filled correctly.",
				"Supported keys: RELEASE_OPENAI_API_KEY, OPENAI_API_KEY.",
				"Supported env files: .env.release.local, .env.release, .env.local, .env.",
			].join(" "),
		);
	}

	const commitBlock = commitLines.join("\n");
	const prompt = [
		"You are generating a release changelog for an Obsidian plugin.",
		"Summarize the commits below into concise user-facing markdown bullet points.",
		"Rules:",
		"- Return only markdown bullet points.",
		"- Each bullet must start with '- '.",
		"- Do not include headings, numbering, explanations, or code fences.",
		"- Group related commits when possible.",
		"- Focus on user-visible features, fixes, stability, performance, and developer tooling.",
		"- Omit raw hashes and internal noise when it is not useful.",
		"- Keep it concise but complete.",
		"- If the output is mainly Chinese, keep it within 1200 characters.",
		"- If the output is mainly English, keep it within 1800 characters.",
		"",
		"Commits since the last release:",
		commitBlock,
	].join("\n");

	return await summarizeCommitsWithOpenAI(prompt, apiKey, apiBaseUrl);
}

function collectReleaseCommitLines() {
	let range = "";
	try {
		const lastTag = runCommand("git describe --tags --abbrev=0").trim();
		if (lastTag) {
			range = `${lastTag}..HEAD`;
		}
	} catch {
		range = "";
	}

	const logCommand = range
		? `git log ${range} --no-merges --reverse --pretty=format:%h%x09%ad%x09%s --date=short`
		: "git log --no-merges --reverse --pretty=format:%h%x09%ad%x09%s --date=short";
	const raw = runCommand(logCommand);

	return raw
		.split("\n")
		.map((line) => line.trim())
		.filter(
			(line) =>
				line.length > 0 &&
				!line.toLowerCase().includes("\tchore: release "),
		);
}

function resolveOpenAIApiKey() {
	const env = loadMergedEnvFiles();
	return (
		process.env.RELEASE_OPENAI_API_KEY?.trim() ||
		process.env.OPENAI_API_KEY?.trim() ||
		env.RELEASE_OPENAI_API_KEY?.trim() ||
		env.OPENAI_API_KEY?.trim() ||
		""
	);
}

function resolveOpenAIBaseUrl() {
	const env = loadMergedEnvFiles();
	const raw =
		process.env.RELEASE_OPENAI_API_BASE_URL?.trim() ||
		process.env.OPENAI_API_BASE_URL?.trim() ||
		process.env.RELEASE_OPENAI_BASE_URL?.trim() ||
		process.env.OPENAI_BASE_URL?.trim() ||
		env.RELEASE_OPENAI_API_BASE_URL?.trim() ||
		env.OPENAI_API_BASE_URL?.trim() ||
		env.RELEASE_OPENAI_BASE_URL?.trim() ||
		env.OPENAI_BASE_URL?.trim() ||
		DEFAULT_OPENAI_API_BASE_URL;

	return normalizeOpenAIBaseUrl(raw);
}

function normalizeOpenAIBaseUrl(rawBaseUrl) {
	if (!rawBaseUrl) {
		return DEFAULT_OPENAI_API_BASE_URL;
	}
	return rawBaseUrl.replace(/\/+$/, "");
}

function buildOpenAIResponsesUrl(apiBaseUrl) {
	if (apiBaseUrl.endsWith("/responses")) {
		return apiBaseUrl;
	}
	if (apiBaseUrl.endsWith("/v1")) {
		return `${apiBaseUrl}/responses`;
	}
	return `${apiBaseUrl}/v1/responses`;
}

function loadMergedEnvFiles() {
	const merged = {};
	for (const filePath of ENV_CANDIDATE_PATHS) {
		if (!existsSync(filePath)) {
			continue;
		}
		Object.assign(merged, parseEnvFile(readFileSync(filePath, "utf8")));
	}
	return merged;
}

function parseEnvFile(content) {
	const result = {};
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) {
			continue;
		}
		const equalIndex = line.indexOf("=");
		if (equalIndex <= 0) {
			continue;
		}
		const key = line.slice(0, equalIndex).trim();
		let value = line.slice(equalIndex + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		result[key] = value;
	}
	return result;
}

async function summarizeCommitsWithOpenAI(prompt, apiKey, apiBaseUrl) {
	if (typeof fetch !== "function") {
		throw new Error(
			buildReleaseAbortMessage(
				"Current Node runtime does not support fetch, so the changelog request cannot be sent.",
			),
		);
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
	const apiUrl = buildOpenAIResponsesUrl(apiBaseUrl);

	try {
		const response = await fetch(apiUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: OPENAI_MODEL,
				input: prompt,
			}),
			signal: controller.signal,
		});

		let payload = null;
		try {
			payload = await response.json();
		} catch {
			payload = null;
		}

		if (!response.ok) {
			const errorMessage =
				payload?.error?.message ||
				`${response.status} ${response.statusText}`.trim();
			throw new Error(
				buildReleaseAbortMessage(
					`OpenAI changelog request failed: ${errorMessage}`,
				),
			);
		}

		const outputText = extractResponseText(payload);
		if (!outputText) {
			throw new Error(
				buildReleaseAbortMessage(
					"OpenAI returned an empty changelog response.",
				),
			);
		}

		return finalizeReleaseNotes(outputText);
	} catch (error) {
		if (error?.name === "AbortError") {
			throw new Error(
				buildReleaseAbortMessage(
					"OpenAI changelog request timed out.",
				),
			);
		}
		throw error;
	} finally {
		clearTimeout(timeoutId);
	}
}

function buildReleaseAbortMessage(reason) {
	return `${reason} Abort release. Please confirm both API key and base URL are filled correctly.`;
}

function extractResponseText(payload) {
	if (!payload || typeof payload !== "object") {
		return "";
	}
	if (typeof payload.output_text === "string" && payload.output_text.trim()) {
		return payload.output_text.trim();
	}

	const output = Array.isArray(payload.output) ? payload.output : [];
	const parts = [];
	for (const item of output) {
		const content = Array.isArray(item?.content) ? item.content : [];
		for (const block of content) {
			if (typeof block?.text === "string" && block.text.trim()) {
				parts.push(block.text.trim());
			}
		}
	}
	return parts.join("\n").trim();
}

function finalizeReleaseNotes(text) {
	const trimmed = stripMarkdownCodeFences(text).trim();
	if (trimmed.length <= MAX_CHANGELOG_CHARACTERS) {
		return trimmed;
	}

	return `${trimmed.slice(0, MAX_CHANGELOG_CHARACTERS - 3).trimEnd()}...`;
}

function stripMarkdownCodeFences(text) {
	return text.replace(/^```[^\n]*\n?|\n?```$/g, "");
}

function buildChangelogEntry(version, date, releaseNotesBody) {
	return `## [${version}] - ${date}\n\n${releaseNotesBody}\n\n`;
}

function bumpVersion(oldVersion, releaseType) {
	const parts = oldVersion.split(".").map(Number);
	if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
		throw new Error(`Invalid manifest version: ${oldVersion}`);
	}

	if (releaseType === "major") {
		parts[0] += 1;
		parts[1] = 0;
		parts[2] = 0;
	} else if (releaseType === "minor") {
		parts[1] += 1;
		parts[2] = 0;
	} else {
		parts[2] += 1;
	}

	return parts.join(".");
}

function prependFile(filePath, newContent) {
	const existing = existsSync(filePath)
		? readFileSync(filePath, "utf8")
		: "";
	writeFileSync(filePath, newContent + existing);
}

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
	writeFileSync(filePath, JSON.stringify(data, null, "\t"));
}

function runCommand(command, options = {}) {
	return execSync(command, {
		encoding: "utf8",
		stdio: options.stdio ?? "pipe",
	});
}

main().catch((error) => {
	console.error(`Release aborted: ${error.message}`);
	process.exit(1);
});
