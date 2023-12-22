import { LanguageEnum } from "src/globals/language-enum";

export class Highlighter {}

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
