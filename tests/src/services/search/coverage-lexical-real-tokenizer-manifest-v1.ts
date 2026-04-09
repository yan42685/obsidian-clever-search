export type RealTokenizerIndexedDocument = {
	path: string;
	basename: string;
	folder: string;
	content?: string;
	aliases?: string;
	tags?: string;
	headings?: string;
};

export type RealTokenizerManifestCase = {
	id: string;
	query: string;
	expectedTop1Path: string;
	displayFrontSize: number;
	forbiddenFrontPaths: readonly string[];
};

export const COVERAGE_LEXICAL_REAL_TOKENIZER_MANIFEST_VERSION = "v1";

export const COVERAGE_LEXICAL_REAL_TOKENIZER_SEGMENTATIONS_V1: Record<
	string,
	string[]
> = {
	政治理论: ["政治", "理论"],
	政治理论笔记: ["政治理论", "政治", "理论", "笔记"],
	理论学习方法: ["理论", "学习", "方法"],
	政治观察摘要: ["政治", "观察", "摘要"],
	快乐定义适用范围: ["快乐", "定义", "适用范围"],
	快乐习惯清单: ["快乐", "习惯", "清单"],
	适用范围说明: ["适用范围", "说明"],
	运行时访问: ["运行时", "访问"],
	运行时访问说明: ["运行时", "访问", "说明"],
	常见问题: ["常见", "问题"],
	问题排查: ["问题", "排查"],
};

export const COVERAGE_LEXICAL_REAL_TOKENIZER_DOCUMENTS_V1: readonly RealTokenizerIndexedDocument[] =
	[
		{
			path: "notes/政治理论笔记.md",
			basename: "政治理论笔记",
			folder: "notes",
			headings: "政治理论",
			aliases: "政治理论 学习笔记",
			tags: "政治理论",
			content:
				"政治 理论 笔记 讨论 国家 制度 意识形态 与 政治 理论 的 核心概念",
		},
		{
			path: "notes/理论学习方法.md",
			basename: "理论学习方法",
			folder: "notes",
			headings: "理论方法",
			aliases: "理论 学习 方法",
			tags: "理论 学习",
			content: "理论 理论 学习 方法 侧重 抽象 理论 框架 与 复习 节奏",
		},
		{
			path: "notes/政治观察摘要.md",
			basename: "政治观察摘要",
			folder: "notes",
			headings: "政治观察",
			aliases: "政治 观察 记录",
			tags: "政治 观察",
			content: "政治 政治 观察 摘要 记录 现实 政治 事件 与 新闻 讨论",
		},
		{
			path: "notes/快乐定义适用范围.md",
			basename: "快乐定义适用范围",
			folder: "notes",
			headings: "快乐的定义和适用范围",
			aliases: "快乐 定义 适用范围",
			tags: "快乐 定义",
			content:
				"快乐 的 定义 和 适用范围 讨论 概念 边界 语境 以及 实践中的 误用",
		},
		{
			path: "notes/快乐习惯清单.md",
			basename: "快乐习惯清单",
			folder: "notes",
			headings: "快乐习惯",
			aliases: "快乐 练习 清单",
			tags: "快乐 习惯",
			content: "快乐 习惯 清单 记录 睡眠 运动 感恩 与 每日 练习",
		},
		{
			path: "notes/适用范围说明.md",
			basename: "适用范围说明",
			folder: "notes",
			headings: "适用范围说明",
			aliases: "适用范围 说明",
			tags: "适用范围",
			content: "适用范围 说明 讨论 使用边界 与 语义限定",
		},
		{
			path: "notes/projected-token-runtime-access-note.md",
			basename: "projected token runtime access note",
			folder: "notes",
			headings: "运行时访问",
			aliases: "projected token 运行时访问",
			tags: "projected token 运行时访问",
			content:
				"projected token runtime access note explains pod credential reads and 运行时 访问 flow",
		},
		{
			path: "notes/projected-token-overview.md",
			basename: "projected token overview",
			folder: "notes",
			headings: "Projected token",
			aliases: "projected token pod credentials",
			tags: "projected token",
			content:
				"projected token projected token projected token pod credential rotation overview",
		},
		{
			path: "notes/运行时访问说明.md",
			basename: "运行时访问说明",
			folder: "notes",
			headings: "运行时访问",
			aliases: "运行时访问 pod 凭证",
			tags: "运行时 访问",
			content: "运行时 访问 说明 介绍 容器 凭证 读取 与 访问 流程",
		},
		{
			path: "notes/obsidian-sync-常见问题.md",
			basename: "obsidian-sync-常见问题",
			folder: "notes",
			headings: "obsidian sync 常见问题",
			aliases: "obsidian sync 问题",
			tags: "obsidian sync 问题",
			content: "obsidian sync 常见问题 说明 同步冲突 限额 报错 与 排查步骤",
		},
		{
			path: "notes/obsidian-sync-overview.md",
			basename: "obsidian-sync-overview",
			folder: "notes",
			headings: "obsidian sync overview",
			aliases: "obsidian sync",
			tags: "obsidian sync",
			content:
				"obsidian sync overview introduces sync setup limits pricing and vault restore guidance",
		},
		{
			path: "notes/问题排查.md",
			basename: "问题排查",
			folder: "notes",
			headings: "问题排查",
			aliases: "问题 排查",
			tags: "问题 排查",
			content: "问题 排查 记录 常见报错 网络波动 与 重试步骤",
		},
	];

export const COVERAGE_LEXICAL_REAL_TOKENIZER_QUERY_MANIFEST_V1: readonly RealTokenizerManifestCase[] =
	[
		{
			id: "zh-short-politics-theory",
			query: "政治理论",
			expectedTop1Path: "notes/政治理论笔记.md",
			displayFrontSize: 3,
			forbiddenFrontPaths: [
				"notes/理论学习方法.md",
				"notes/政治观察摘要.md",
			],
		},
		{
			id: "zh-natural-happiness-definition-scope",
			query: "关于快乐的定义和适用范围",
			expectedTop1Path: "notes/快乐定义适用范围.md",
			displayFrontSize: 3,
			forbiddenFrontPaths: [
				"notes/快乐习惯清单.md",
				"notes/适用范围说明.md",
			],
		},
		{
			id: "mixed-projected-token-runtime-access",
			query: "projected token 运行时访问",
			expectedTop1Path: "notes/projected-token-runtime-access-note.md",
			displayFrontSize: 3,
			forbiddenFrontPaths: [
				"notes/projected-token-overview.md",
				"notes/运行时访问说明.md",
			],
		},
		{
			id: "mixed-obsidian-sync-problem",
			query: "obsidian sync 问题",
			expectedTop1Path: "notes/obsidian-sync-常见问题.md",
			displayFrontSize: 3,
			forbiddenFrontPaths: [
				"notes/obsidian-sync-overview.md",
				"notes/问题排查.md",
			],
		},
	];

export function createRealChineseCoverageTokenizer(
	segmentations: Record<string, string[]> = COVERAGE_LEXICAL_REAL_TOKENIZER_SEGMENTATIONS_V1,
) {
	function normalize(text: string): string {
		return text.toLowerCase().normalize("NFKC");
	}

	function tokenizeSequence(text: string): string[] {
		const normalized = normalize(text);
		const segments = normalized.split(/[\[\]{}()<>\s]+/u).filter(Boolean);
		const tokens: string[] = [];
		for (const segment of segments) {
			if (/[\p{Script=Han}]/u.test(segment)) {
				tokens.push(...(segmentations[segment] ?? [segment]));
				continue;
			}
			for (const token of segment.split(/[^a-z0-9_-]+/u)) {
				if (token.length > 1) {
					tokens.push(token);
				}
			}
		}
		return tokens;
	}

	function tokenizeSequenceWithOffsets(text: string): Array<{
		token: string;
		start: number;
		end: number;
	}> {
		const normalized = normalize(text);
		const out: Array<{ token: string; start: number; end: number }> = [];
		let cursor = 0;
		for (const token of tokenizeSequence(text)) {
			const start = normalized.indexOf(token, cursor);
			if (start < 0) {
				continue;
			}
			out.push({ token, start, end: start + token.length });
			cursor = start + token.length;
		}
		return out;
	}

	return {
		tokenize(text: string): string[] {
			return Array.from(new Set(tokenizeSequence(text)));
		},
		tokenizeSequence(text: string): string[] {
			return tokenizeSequence(text);
		},
		tokenizeSequenceWithOffsets(text: string): Array<{
			token: string;
			start: number;
			end: number;
		}> {
			return tokenizeSequenceWithOffsets(text);
		},
	};
}
