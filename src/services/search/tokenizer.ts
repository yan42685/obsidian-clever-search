import { PluginSetting } from "src/globals/plugin-setting";
import { ChinesePatch } from "src/integrations/languages/chinese-patch";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { AssetsProvider } from "src/utils/web/assets-provider";
import { throttle } from "throttle-debounce";
import { singleton } from "tsyringe";

const SEGMENT_REGEX = /[\[\]{}()<>\s]+/u;
// Thanks to @scambier's Omnisearch, whose code was served as a reference

// ^=#%/*,.`:;?@_
const SEPERATOR_REGEX =
	/[\^=#%\/\*,\.`:;\?@\s\u00A0\u00A1\u00A7\u00AB\u00B6\u00B7\u00BB\u00BF\u037E\u0387\u055A-\u055F\u0589\u058A\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0609\u060A\u060C\u060D\u061B\u061E\u061F\u066A-\u066D\u06D4\u0700-\u070D\u07F7-\u07F9\u0830-\u083E\u085E\u0964\u0965\u0970\u09FD\u0A76\u0AF0\u0C77\u0C84\u0DF4\u0E4F\u0E5A\u0E5B\u0F04-\u0F12\u0F14\u0F3A-\u0F3D\u0F85\u0FD0-\u0FD4\u0FD9\u0FDA\u104A-\u104F\u10FB\u1360-\u1368\u1400\u166E\u1680\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DA\u1800-\u180A\u1944\u1945\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B60\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u2000-\u200A\u2010-\u2029\u202F-\u2043\u2045-\u2051\u2053-\u205F\u207D\u207E\u208D\u208E\u2308-\u230B\u2329\u232A\u2768-\u2775\u27C5\u27C6\u27E6-\u27EF\u2983-\u2998\u29D8-\u29DB\u29FC\u29FD\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E4F\u3000-\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA8FC\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAADE\uAADF\uAAF0\uAAF1\uABEB\uFD3E\uFD3F\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A\uFE6B\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65]+/u;

// const CAMEL_CASE_REGEX = /([a-z](?=[A-Z]))/g;
const HYPHEN_AND_CAMEL_CASE_REGEX = /[-_]|([a-z](?=[A-Z]))/g;

// large charset language can apply fuzzier params and should show less preChars when previewing
// currently only support Chinese
const LARGE_CHARSET_LANGUAGE_REGEX = /[\u4e00-\u9fa5]/;
const CHINESE_REGEX = /[\u4e00-\u9fa5]/;
// const JAPANESE_REGEX = /[\u3040-\u30ff\u31f0-\u31ff]/;
// const KOREAN_REGEX = /[\uac00-\ud7af]/;
// const CJK_REGEX = /[\u4e00-\u9fa5\uac00-\ud7af\u3040-\u30ff\u31f0-\u31ff]/;

@singleton()
export class Tokenizer {
	private readonly setting = getInstance(PluginSetting);
	private readonly chsSegmenter = getInstance(ChinesePatch);
	private logThrottled = throttle(300, (any: any) => logger.info(any));
	private readonly assetsProvider = getInstance(AssetsProvider);
	private readonly stopWordsZh = this.assetsProvider.assets.stopWordsZh;
	private readonly stopWordsEn = this.assetsProvider.assets.stopWordsEn;

	// TODO: synonym and lemmatization
	tokenize(text: string, mode: "index" | "search"): string[] {
		const tokens = new Set<string>();

		const segments = text.split(SEGMENT_REGEX);

		// TODO: extract path for search
		for (const segment of segments) {
			if (!segment) continue; // skip empty strings
			if (
				this.setting.enableChinesePatch &&
				CHINESE_REGEX.test(segment)
			) {
				const words = this.chsSegmenter.cut(segment, true);
				for (const word of words) {
					if (
						this.setting.enableStopWordsZh &&
						this.stopWordsZh?.has(word)
					) {
						if (mode === "search" && word.length > 1) {
							logger.debug(`excluded: ${word}`);
						}
						continue;
					}
					tokens.add(word);
				}
			} else {
				// don't add too short or too long segment for smallCharsetLanguage
				// TODO: is this step necessary?
				// if (segment.length > 1 && segment.length < 20) {
				// 	tokens.add(segment);
				// }

				const words = segment.split(SEPERATOR_REGEX);
				for (const word of words) {
					if (
						word.length < 2 || // don't index single char for small charset
						(this.setting.enableStopWordsEn &&
							this.stopWordsEn?.has(word))
					) {
						continue;
					}
					tokens.add(word);

					if (word.length > 3) {
						const subwords = word
							.replace(HYPHEN_AND_CAMEL_CASE_REGEX, "$1 ")
							.split(" ");
						for (const subword of subwords) {
							if (subword.length > 1) {
								tokens.add(subword);
							}
						}
					}
				}
			}
		}

		// logger.info(tokens.size);
		return Array.from(tokens);
	}

	isLargeCharset(text: string) {
		const threshold = 0.35;
		const requiredMatches = Math.ceil(text.length * threshold);
		let matchedCount = 0;

		for (const char of text) {
			if (LARGE_CHARSET_LANGUAGE_REGEX.test(char)) {
				matchedCount++;
				if (matchedCount >= requiredMatches) {
					return true;
				}
			} else {
				// end the loop in advance if it's not possible to reach the requiredMatches
				if (text.length - matchedCount < requiredMatches) {
					return false;
				}
			}
		}

		return matchedCount >= requiredMatches;
	}
}
