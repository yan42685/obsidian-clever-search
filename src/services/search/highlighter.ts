import { LanguageEnum } from "src/globals/language-enum";
import {
	FileType,
	InVaultItem,
	ItemType,
	type MatchedFile,
} from "src/globals/search-types";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { FileRetriever } from "./data-provider";

export class Highlighter {
	fileRetriever: FileRetriever = getInstance(FileRetriever);
	// TODO: highlight by page, rather than reading all files
	async parseInVaultItem(
		matchedFiles: MatchedFile[],
	): Promise<InVaultItem[]> {
		// TODO: do real highlight
		const result = await Promise.all(
			matchedFiles.slice(0, 50).map(async (f) => {
				const path = f.path;
				if (
					this.fileRetriever.getFileType(path) ===
					FileType.PLAIN_TEXT
				) {
					const content =
						await this.fileRetriever.readPlainText(path);
					const lines = content.split("\n"); // 正则表达式匹配 \n 或 \r\n
					const firstTenLines = lines.slice(0, 10).join("\n");
					// It is necessary to use a constructor with 'new', rather than using an object literal.
					// Otherwise, it is impossible to determine the type using 'instanceof', achieving polymorphic effects based on inheritance
					// (to correctly display data in Svelte components).
					return new InVaultItem(ItemType.LEXICAL, f.path, [
						firstTenLines,
					]);
				} else {
					return new InVaultItem(ItemType.LEXICAL, f.path, ["not supported file type"])
				}
			}),
		);
		logger.warn("current only highlight top 50 files");
		return result;
	}
}

export interface TruncateLimitConfig {
	maxPreCharsForItem: number;
	maxPreCharsForPreview: number;
	maxPreLines: number;
}

export class TruncateLimit {
	private static readonly limitsByLanguage: Record<
		LanguageEnum,
		TruncateLimitConfig
	> = {
		[LanguageEnum.other]: {
			maxPreCharsForItem: 80,
			maxPreCharsForPreview: 200,
			maxPreLines: 10,
		},
		[LanguageEnum.en]: {
			maxPreCharsForItem: 80,
			maxPreCharsForPreview: 200,
			maxPreLines: 10,
		},
		[LanguageEnum.zh]: {
			maxPreCharsForItem: 30,
			maxPreCharsForPreview: 120,
			maxPreLines: 10,
		},
	};

	// public static getConfig(strArray: string[]): TruncateLimitConfig {
	// 	const languageResult = textAnalyzer.detectLanguage(strArray);

	// }
}
