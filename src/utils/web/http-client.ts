import { requestUrl } from "obsidian";
import { PluginSettings } from "src/services/obsidian/settings";
import { MyNotice } from "src/services/obsidian/transformed-api";
import { throttle } from "throttle-debounce";
import { container } from "tsyringe";
import { logger } from "../logger";
import { my } from "../my-lib";

export class HttpClient {
	private settings = container.resolve(PluginSettings);
	private noticeThrottled = throttle(
		5000,
		(text: string) => new MyNotice(text),
	);

	private gptapiOption: any = {
		method: "POST",
		url: `https://${this.settings.apiProvider1.domain}/v1/embeddings`,
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
		url: `https://${this.settings.apiProvider2.domain}/v1/embeddings`,
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

	// Obsidian.reque
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
				const info = `Invalid key for ${my.getDomainFromUrl(
					options.url,
				)}`;
				logger.error(info);
				this.noticeThrottled(info);
			} else {
				logger.warn("Maybe the domain is wrong");
			}

			logger.error(err);
		}
	}
}
