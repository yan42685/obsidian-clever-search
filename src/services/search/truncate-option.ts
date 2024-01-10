import { LanguageEnum } from "src/globals/enums";
import { LangUtil } from "src/utils/lang-util";

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
	// default truncate options for all types and languages
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
			maxPreChars: 180,
			maxPostChars: 200,
			boundaryLineMinChars: 4,
		},
	};

	// truncate options set by language
	private static readonly limitsByLanguage: Record<
		LanguageEnum,
		AllTruncateOption
	> = {
		[LanguageEnum.other]: TruncateOption.default,
		[LanguageEnum.en]: TruncateOption.default,
		[LanguageEnum.zh]: {
			line: { ...this.default.line, maxPreChars: 30, maxPostChars: 230 },
			paragraph: {
				...this.default.paragraph,
				maxPreChars: 220,
				maxPostChars: 600,
			},
			subItem: {
				...this.default.subItem,
				maxPreChars: 60,
				maxPostChars: 80,
			},
		},
	};

	/**
	 * retrieve the truncate options for a given type in the current language.
	 */
	// TODO: use token if performance permits. token: normal char +1  wide char +2
	static forType(type: TruncateType, text?: string): TruncateLimit {
		// return the option by char type, normal char or wide char
		if (text && LangUtil.testWideChar(text)) {
			return this.limitsByLanguage[LanguageEnum.zh][type];
		} else {
			// return the default option
			return this.limitsByLanguage[LanguageEnum.en][type];
		}
	}
}
