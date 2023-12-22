import { requestUrl } from "obsidian";
import { PluginSettings } from "src/services/obsidian/settings";
import { MyNotice } from "src/services/obsidian/transformed-api";
import { container } from "tsyringe";
import { logger } from "../logger";

const domainRegex = /https:\/\/(.*?)\//;
export class HttpClient {
	private settings = container.resolve(PluginSettings);

	private gptapiOption: any = {
		method: "POST",
		url: `https://${this.settings.apiProvider1.domain}/v1/embeddings`,
		headers: {

			Authorization:
				`Bearer ${this.settings.apiProvider1.key}`,
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
		async function test(option: any) {
			try {
				const res = await requestUrl(option);
				logger.debug(res);
				logger.debug(res.json);
			} catch (err) {
				if (err.message.includes("401")) {
					new MyNotice(
						`Invalid key for ${
							option.url.match(domainRegex)[1] || "wrong domain"
						}`,
					);
				}
				logger.error(err);
				logger.warn("Maybe the domain is wrong");
			}
		}
		test(this.gptapiOption);

		test(this.openaiOption);
	}
}
