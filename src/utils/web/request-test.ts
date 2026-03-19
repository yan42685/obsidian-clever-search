import { requestUrl } from "obsidian";
import { OuterSetting } from "src/globals/plugin-setting";
import { MyNotice } from "src/services/obsidian/transformed-api";
import { throttle } from "throttle-debounce";
import { logger } from "../logger";
import { MyLib, getInstance } from "../my-lib";

export class RequestTest {
	private settings = getInstance(OuterSetting);
	private noticeThrottled = throttle(
		5000,
		(text: string) => new MyNotice(text),
	);

	private buildRequestOption(): any {
		const domain = this.settings.hybrid.apiDomain?.trim() || "api.openai.com";
		return {
			method: "POST",
			url: `https://${domain.replace(/^https?:\/\//, "")}/v1/embeddings`,
			headers: {
				Authorization: `Bearer ${this.settings.hybrid.apiKey}`,
				"Content-Type": "application/json",
			},
			contentType: "application/json",
			body: JSON.stringify({
				input: "test",
				model: "text-embedding-3-small",
			}),
		};
	}

	async testRequest() {
		this.request(this.buildRequestOption());
	}
	async request(options: any) {
		try {
			const res = await requestUrl(options);
			logger.debug(res);
			logger.debug(res.json);
		} catch (err) {
			if (err.message.includes("401")) {
				const info = `Invalid key for ${MyLib.extractDomainFromHttpsUrl(
					options.url,
				)}`;
				logger.error(info);
				this.noticeThrottled(info);
			} else {
				const info =
					`Failed to connect to [${options.url}], maybe the domain is wrong or the api provider is not available now or there is something wrong with your Internet connection`;
				logger.error(info);
				this.noticeThrottled(info);
			}
			logger.error(err);
		}
	}
}

