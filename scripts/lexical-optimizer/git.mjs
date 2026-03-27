import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import {
	DEFAULT_BASELINE_REF,
	DEFAULT_WORKTREE_ROOT,
} from "./config.mjs";

export class GitUnavailableError extends Error {
	constructor(message, options = {}) {
		super(message);
		this.name = "GitUnavailableError";
		this.code = options.code ?? "GIT_UNAVAILABLE";
		this.cause = options.cause;
	}
}

function isPermissionError(error) {
	return error?.code === "EPERM" || error?.errno === -4048;
}

function buildUnavailableError(args, error) {
	const detail = error?.message ?? String(error ?? "unknown git failure");
	return new GitUnavailableError(
		`Git subprocess is unavailable for "${args.join(" ")}". Run this script in a normal local terminal, or use parameter --dry-run inside the Codex sandbox.\n\n${detail}`,
		{
			code: isPermissionError(error) ? "GIT_SUBPROCESS_BLOCKED" : "GIT_UNAVAILABLE",
			cause: error,
		},
	);
}

function runGit(args, options = {}) {
	const cwd = options.cwd ?? process.cwd();
	const result =
		process.platform === "win32"
			? spawnSync(
					"powershell.exe",
					[
						"-NoProfile",
						"-Command",
						["git", ...args.map((arg) => `'${String(arg).replace(/'/g, "''")}'`)].join(" "),
					],
					{
						cwd,
						encoding: "utf8",
						maxBuffer: 1024 * 1024 * 16,
					},
				)
			: spawnSync("git", args, {
					cwd,
					encoding: "utf8",
					maxBuffer: 1024 * 1024 * 16,
				});
	if (result.error) {
		throw buildUnavailableError(args, result.error);
	}
	if (result.status !== 0) {
		throw new Error(
			[
				`git ${args.join(" ")} failed`,
				result.stdout?.trim(),
				result.stderr?.trim(),
			]
				.filter(Boolean)
				.join("\n\n"),
		);
	}
	return result.stdout.trim();
}

export function getCurrentHead() {
	return runGit(["rev-parse", "HEAD"]);
}

export function getDirtyFiles() {
	const output = runGit(["status", "--porcelain"]);
	return output
		.split(/\r?\n/g)
		.map((line) => line.trim())
		.filter(Boolean);
}

export function readRepoState() {
	try {
		return {
			available: true,
			head: getCurrentHead(),
			dirtyFiles: getDirtyFiles(),
			notes: [],
		};
	} catch (error) {
		if (!(error instanceof GitUnavailableError)) {
			throw error;
		}
		return {
			available: false,
			head: "unavailable",
			dirtyFiles: [],
			notes: [error.message],
			error,
		};
	}
}

function ensureDir(dirPath) {
	fs.mkdirSync(dirPath, { recursive: true });
}

function buildWorktreePath(label = "") {
	const suffix = String(label || "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	const stem = `${Date.now()}-${process.pid}`;
	return path.join(
		DEFAULT_WORKTREE_ROOT,
		suffix ? `${stem}-${suffix}` : stem,
	);
}

export function createWorktreeAtRef(ref = DEFAULT_BASELINE_REF, label = "") {
	ensureDir(DEFAULT_WORKTREE_ROOT);
	const worktreePath = buildWorktreePath(label);
	try {
		runGit(["worktree", "add", "--detach", worktreePath, ref]);
	} catch (error) {
		if (error instanceof GitUnavailableError) {
			throw new GitUnavailableError(
				`${error.message}\n\nMechanism mode needs git worktree support to compare the current workspace against ${ref}.`,
				{
					code: error.code,
					cause: error,
				},
			);
		}
		throw error;
	}
	return worktreePath;
}

export function removeWorktree(worktreePath) {
	try {
		runGit(["worktree", "remove", "--force", worktreePath]);
	} catch (error) {
		if (!(error instanceof GitUnavailableError)) {
			throw error;
		}
	}
}

export function withWorktreeAtRef(ref = DEFAULT_BASELINE_REF, callback, label = "") {
	const worktreePath = createWorktreeAtRef(ref, label);
	try {
		return callback(worktreePath);
	} finally {
		removeWorktree(worktreePath);
	}
}

export function withHeadWorktree(callback) {
	return withWorktreeAtRef(DEFAULT_BASELINE_REF, callback);
}
