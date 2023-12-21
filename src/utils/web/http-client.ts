import { requestUrl } from "obsidian";
import { logger } from "../logger";

const gptapiOption: any = {
	//   url: `https://api.openai.com/v1/chat/completions`,
	method: "POST",
	url: "https://api.gptapi.us/v1/embeddings",
	headers: {
		// Authorization: `Bearer ${this.plugin.settings.api_key}`,
		Authorization:
			"Bearer sk-qpfgXwBbVd7fb5nQ56E0Af601dD2487489A7EeAc0e26D923",
		"Content-Type": "application/json",
	},
	contentType: "application/json",
	body: JSON.stringify({
		input: "test",
		model: "text-embedding-ada-002",
	}),
};









const openaiOption: any = {
	url: "https://api.openai.com/v1/embeddings",
	method: "POST",
	headers: {
		Authorization:
			"Bearer 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",
		"Content-Type": "application/json",
	},
	contentType: "application/json",
	body: JSON.stringify({
		input: "test",
		model: "text-embedding-ada-002",
	}),
};

// Obsidian.reque
export async function testRequest() {
	async function test(option: any) {
		try {
			const res = await requestUrl(option);

			logger.debug(res);
            logger.debug(res.json);
		} catch (err) {
			logger.error(err);
		}
	}
    // test(gptapiOption);
    test(openaiOption);

}
