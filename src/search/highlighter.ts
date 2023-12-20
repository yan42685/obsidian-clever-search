import { LanguageEnum, getCurrLanguage } from "src/entities/language-enum";

export class Highlighter {}

export interface TruncateLimitConfig {
	maxPreCharsForItem: number;
	maxPreCharsForPreview: number;
	maxPreLines: number;
}

export class TruncateLimit {
	private static readonly limitsByLanguage: Record<LanguageEnum, TruncateLimitConfig> =
		{
			[LanguageEnum.other]: {
				maxPreCharsForItem: 100,
				maxPreCharsForPreview: 200,
				maxPreLines: 10,
			},
			[LanguageEnum.zh]: {
				maxPreCharsForItem: 100,
				maxPreCharsForPreview: 200,
				maxPreLines: 10,
			},
		};
    public readonly instance: TruncateLimitConfig;

	constructor() {
        this.instance = TruncateLimit.limitsByLanguage[getCurrLanguage()];
    }
}
