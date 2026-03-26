import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const cacheRoot = path.join(repoRoot, ".codex-bench");
const tempRoot = path.join(cacheRoot, "tmp", "big-vault-mixed-v1");
const corpusRoot = path.join(cacheRoot, "corpora", "big-vault-mixed-v1");

const sources = [
	{
		key: "mdn-en-web",
		repo: "https://github.com/mdn/content.git",
		repoName: "mdn/content",
		branch: "main",
		targetDir: "mdn-en-web",
		paths: ["files/en-us/web"],
	},
	{
		key: "k8s-en-core",
		repo: "https://github.com/kubernetes/website.git",
		repoName: "kubernetes/website",
		branch: "main",
		targetDir: "k8s-en-core",
		paths: ["content/en/docs/concepts", "content/en/docs/tasks"],
	},
	{
		key: "k8s-zh-core",
		repo: "https://github.com/kubernetes/website.git",
		repoName: "kubernetes/website",
		branch: "main",
		targetDir: "k8s-zh-core",
		paths: ["content/zh-cn/docs/concepts", "content/zh-cn/docs/tasks"],
	},
	{
		key: "github-actions",
		repo: "https://github.com/github/docs.git",
		repoName: "github/docs",
		branch: "main",
		targetDir: "github-actions",
		paths: ["content/actions"],
	},
	{
		key: "obsidian-help",
		repo: "https://github.com/obsidianmd/obsidian-help.git",
		repoName: "obsidianmd/obsidian-help",
		branch: "master",
		targetDir: "obsidian-help",
		paths: ["en", "zh"],
	},
];

function run(command, args, cwd = repoRoot) {
	const result = spawnSync(command, args, {
		cwd,
		stdio: "inherit",
		shell: false,
	});
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`,
		);
	}
}

function ensureEmptyDir(dir) {
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(fromDir, toDir) {
	fs.mkdirSync(path.dirname(toDir), { recursive: true });
	fs.cpSync(fromDir, toDir, {
		recursive: true,
		force: true,
	});
}

function collectMarkdownFiles(dir) {
	const files = [];
	const stack = [dir];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current || !fs.existsSync(current)) {
			continue;
		}
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(fullPath);
				continue;
			}
			if (entry.name.endsWith(".md") || entry.name.endsWith(".mdx")) {
				const stat = fs.statSync(fullPath);
				files.push({
					path: path.relative(corpusRoot, fullPath).replaceAll("\\", "/"),
					bytes: stat.size,
				});
			}
		}
	}
	files.sort((left, right) => left.path.localeCompare(right.path));
	return files;
}

function syncSource(source) {
	const checkoutDir = path.join(tempRoot, source.key);
	ensureEmptyDir(checkoutDir);

	run("git", [
		"clone",
		"--depth",
		"1",
		"--filter=blob:none",
		"--sparse",
		"--branch",
		source.branch,
		source.repo,
		checkoutDir,
	]);
	run("git", ["sparse-checkout", "set", ...source.paths], checkoutDir);

	const destRoot = path.join(corpusRoot, source.targetDir);
	for (const sourcePath of source.paths) {
		const fromDir = path.join(checkoutDir, sourcePath);
		const relativeTarget = source.paths.length === 1 ? sourcePath : path.basename(sourcePath);
		const toDir = path.join(destRoot, relativeTarget);
		copyRecursive(fromDir, toDir);
	}
}

function main() {
	fs.mkdirSync(cacheRoot, { recursive: true });
	ensureEmptyDir(tempRoot);
	ensureEmptyDir(corpusRoot);

	for (const source of sources) {
		console.log(`[sync-big-vault-corpus] syncing ${source.repoName} -> ${source.targetDir}`);
		syncSource(source);
	}

	const files = collectMarkdownFiles(corpusRoot);
	const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
	const manifest = {
		name: "big-vault-mixed-v1",
		description:
			"Local-only mixed-language large benchmark corpus for read-path and retrieval stress tests.",
		generatedAt: new Date().toISOString(),
		fileCount: files.length,
		totalBytes,
		totalMiB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
		sources: sources.map((source) => ({
			repo: source.repoName,
			branch: source.branch,
			targetDir: source.targetDir,
			paths: source.paths,
		})),
		files,
	};
	fs.writeFileSync(
		path.join(corpusRoot, "manifest.json"),
		JSON.stringify(manifest, null, 2),
	);

	console.log(
		`[sync-big-vault-corpus] ready: ${manifest.fileCount} files, ${manifest.totalMiB} MiB at ${corpusRoot}`,
	);
}

main();
