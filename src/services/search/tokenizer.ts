import { PluginSetting } from "src/globals/plugin-setting";
import { CjkPatch } from "src/integrations/languages/cjk-patch";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { throttle } from "throttle-debounce";
import { singleton } from "tsyringe";

// Thanks to @scambier's Omnisearch, whose code was served as a reference

// Constants and regex patterns defined outside of the class for performance.
const BRACKETS_AND_SPACE = /[|\[\]\(\)<>\{\} \t\n\r]/u;
const CAMEL_CASE_REGEX = /([a-z](?=[A-Z]))/g;
const HYPHEN_AND_CAMEL_CASE_REGEX = /-|([a-z](?=[A-Z]))/g;

const CJK_REGEX = /[\u4e00-\u9fa5\uac00-\ud7af\u3040-\u30ff\u31f0-\u31ff]/;
// const CHINESE_REGEX = /[\u4e00-\u9fa5]/;
// const JAPANESE_REGEX = /[\u3040-\u30ff\u31f0-\u31ff]/;
// const KOREAN_REGEX = /[\uac00-\ud7af]/;

@singleton()
export class Tokenizer {
	private readonly setting = getInstance(PluginSetting);
	private readonly cjkSegmenter = getInstance(CjkPatch);
	private logThrottled = throttle(300, (any: any) => logger.info(any));

    // TODO: synonym and lemmatization
	tokenize(text: string): string[] {
		const tokens = new Set<string>();

		// split by brackets and spaces first to get whole segments
		const segments = text.split(BRACKETS_AND_SPACE);

		for (const segment of segments) {
			if (!segment) continue; // skip empty strings

			// don't add long segment
			if (segment.length < 12) {
                // don't add single non-cjk char
				if (!(segment.length === 1 && !CJK_REGEX.test(segment))) {
					tokens.add(segment);
                }
			}

			if (this.setting.enableCjkPatch && CJK_REGEX.test(segment)) {
				const words = this.cjkSegmenter.cut(segment, true);
				for (const word of words) {
					tokens.add(word);
				}
			} else {
				this.splitCamelCaseAndHyphens(segment, tokens);
			}
		}
		// logger.info(tokens.size);
		return Array.from(tokens);
	}

	private splitCamelCase(text: string, tokens: Set<string>): void {
		const words = text.replace(CAMEL_CASE_REGEX, "$1 ").split(" ");

		for (const word of words) {
			if (word) tokens.add(word);
		}
	}

	private splitCamelCaseAndHyphens(text: string, tokens: Set<string>): void {
		const words = text
			.replace(HYPHEN_AND_CAMEL_CASE_REGEX, "$1 ")
			.split(" ");
		for (const word of words) {
			if (word) tokens.add(word);
		}
	}
}
