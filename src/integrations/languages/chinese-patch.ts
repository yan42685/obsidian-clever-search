import init, { cut_for_search } from "jieba-wasm/pkg/web/jieba_rs_wasm";
import { OuterSetting } from "src/globals/plugin-setting";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { AssetsProvider } from "src/utils/web/assets-provider";
import { singleton } from "tsyringe";

/**
 * better segmentation for Chinese, Japanese and Korean
 */
@singleton()
export class ChinesePatch {
	private isReady = false;
	private reportedError = false;
	async initAsync() {
		if (getInstance(OuterSetting).enableChinesePatch) {
			const jiebaBinary = getInstance(AssetsProvider).assets.jiebaBinary;
			await init(jiebaBinary);
			// perform an initial cut_for_search to warm up the system,
			// as the first cut operation tends to be slow
			cut_for_search("", false);
			this.isReady = true;
		}
	}

	cut(text: string, hmm: boolean): string[] {
		if (!this.isReady && !this.reportedError) {
			logger.error("jieba segmenter isn't ready");
			this.reportedError = true;
			return [text];
		}
		return cut_for_search(text, hmm);
	}
}
