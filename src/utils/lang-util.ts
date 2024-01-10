
// large charset language can apply fuzzier params and should show less preChars when previewing
// currently only support Chinese
const LARGE_CHARSET_LANGUAGE_REGEX = /[\u4e00-\u9fa5]/;
// match all
const LARGE_CHARSET_LANGUAGE_REGEX_G = /[\u4e00-\u9fa5]/g;

export const CHINESE_REGEX = /[\u4e00-\u9fa5]/;
// const JAPANESE_REGEX = /[\u3040-\u30ff\u31f0-\u31ff]/;
// const KOREAN_REGEX = /[\uac00-\ud7af]/;
// const CJK_REGEX = /[\u4e00-\u9fa5\uac00-\ud7af\u3040-\u30ff\u31f0-\u31ff]/;

export class LangUtil {
	static isLargeCharset(text: string): boolean {
		const threshold = 0.35;
		const matches = text.match(LARGE_CHARSET_LANGUAGE_REGEX_G) || [];
		return matches.length >= Math.ceil(text.length * threshold);
	}

	static testWideChar(text: string): boolean {
		return LARGE_CHARSET_LANGUAGE_REGEX.test(text);
	}

	static wideCharProportion(text: string): number {
		const matches = text.match(LARGE_CHARSET_LANGUAGE_REGEX_G) || [];
		return matches.length / text.length;
	}
}
