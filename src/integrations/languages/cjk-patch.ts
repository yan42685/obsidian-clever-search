import init, { cut_for_search } from "jieba-wasm/pkg/web/jieba_rs_wasm";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { AssetsProvider } from "src/utils/web/assets-provider";
import { singleton } from "tsyringe";

/**
 * better segmentation for Chinese, Japanese and Korean
 */
@singleton()
export class CjkPatch {
	private isReady = false;
	private reportedError = false;
	async initAsync() {
		const assets = getInstance(AssetsProvider)
		const jiebaBinary = assets.loadLibrary(assets.jiebaTargetUrl);
		await init(jiebaBinary);
		this.isReady = true;
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
