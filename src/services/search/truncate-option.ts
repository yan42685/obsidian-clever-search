import { LanguageEnum } from "src/globals/enums";

export type TruncateType = "line" | "paragraph" | "subItem";

export type TruncateLimit = {
	maxPreLines: number;
	maxPostLines: number;
	maxPreChars: number;
	maxPostChars: number; // include the EOL
	/**
	 * if (currLine !== matchedLine && isFirstOrLastLine(currLine) && currLine.text.length < boundaryLineMinChars)
	 * currLine won't be added to the context
	 */
	boundaryLineMinChars: number;
};

export type AllTruncateOption = {
	[key in TruncateType]: TruncateLimit;
};

export class TruncateOption {
	// Default truncate options for all types and languages
	private static readonly default: AllTruncateOption = {
		line: {
			maxPreLines: 0,
			maxPostLines: 0,
			maxPreChars: 30,
			maxPostChars: 230,
			boundaryLineMinChars: 4,
		},
		paragraph: {
			maxPreLines: 4,
			maxPostLines: 7,
			maxPreChars: 220,
			maxPostChars: 600,
			boundaryLineMinChars: 4,
		},
		subItem: {
			maxPreLines: 3,
			maxPostLines: 3,
			maxPreChars: 60,
			maxPostChars: 80,
			boundaryLineMinChars: 4,
		},
	};

	// Truncate options set by language
	private static readonly limitsByLanguage: Record<
		LanguageEnum,
		AllTruncateOption
	> = {
		[LanguageEnum.other]: TruncateOption.default,
		[LanguageEnum.en]: TruncateOption.default,
		[LanguageEnum.zh]: {
			line: { ...this.default.line, maxPreChars: 30 },
			paragraph: { ...this.default.paragraph, maxPreChars: 220 },
			subItem: { ...this.default.subItem, maxPreChars: 50 },
		},
	};

	/**
	 * Retrieve the truncate options for a given type in the current language.
	 */
	static forType(type: TruncateType): TruncateLimit {
		// return this.limitsByLanguage[getCurrLanguage()][type];
		return this.limitsByLanguage[LanguageEnum.en][type];
	}
}