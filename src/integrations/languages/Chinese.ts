import init, { cut_for_search } from "jieba-wasm/pkg/web/jieba_rs_wasm";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { AssetsManager, jiebaTargetUrl } from "src/utils/web/assets-manager";
import { singleton } from "tsyringe";

@singleton()
export class ChinesePatch {
	private isReady = false;
	async initAsync() {
		const jiebaBinary =
			getInstance(AssetsManager).loadLibrary(jiebaTargetUrl);
		await init(jiebaBinary);
		this.isReady = true;
	}

	cutForSearch(text: string, hmm: boolean): string[] {
		if (!this.isReady) {
			logger.error("结巴分词没有初始化");
			return [text];
		}
		return cut_for_search(text, hmm);
	}
}
