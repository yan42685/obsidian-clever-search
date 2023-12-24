import { requestUrl } from "obsidian";
import { PluginSetting } from "src/services/obsidian/setting";
import { MyNotice } from "src/services/obsidian/transformed-api";
import { throttle } from "throttle-debounce";
import { container } from "tsyringe";
import { logger } from "../logger";
import { MyLib } from "../my-lib";

export class HttpClient {
	private settings = container.resolve(PluginSetting);
	private noticeThrottled = throttle(
		5000,
		(text: string) => new MyNotice(text),
	);

	private gptapiOption: any = {
		method: "POST",
		url: `https://${this.getDomain1()}/v1/embeddings`,
		headers: {
			Authorization: `Bearer ${this.settings.apiProvider1.key}`,
			"Content-Type": "application/json",
		},
		contentType: "application/json",
		body: JSON.stringify({
			input: "test",
			model: "text-embedding-ada-002",
		}),
	};

	private openaiOption: any = {
		url: `https://${this.getDomain2()}/v1/embeddings`,
		method: "POST",
		headers: {
			Authorization: `Bearer ${this.settings.apiProvider2.key}`,
			"Content-Type": "application/json",
		},
		contentType: "application/json",
		body: JSON.stringify({
			input: "test",
			model: "text-embedding-ada-002",
		}),
	};
	private getDomain1() {
		return MyLib.extractDomainFromHttpsUrl(this.settings.apiProvider1.domain);
	}
	private getDomain2() {
		return MyLib.extractDomainFromHttpsUrl(this.settings.apiProvider2.domain);

	}

	async testRequest() {
		this.request(this.gptapiOption);

		this.request(this.openaiOption);
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
					`Failed to connect to [${this.settings.apiProvider1.domain}], maybe the domain is wrong or the api provider is not available now or there is something wrong with your Internet connection`;
				logger.error(info);
				this.noticeThrottled(info);
			}
			logger.error(err);
		}
	}
}

