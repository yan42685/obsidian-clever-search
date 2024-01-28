import { requestUrl, type RequestUrlResponsePromise } from "obsidian";

class HttpClient {
	// private retryInterval: number;
	// private maxRetries: number;

	// constructor(retryInterval = 1000, maxRetries = 3) {
	// 	this.retryInterval = retryInterval;
	// 	this.maxRetries = maxRetries;
	// }

	public get(url: string, headers?: Record<string, string>) {
		return this.request("GET", url, undefined, headers);
	}

	public post(url: string, body: any, headers?: Record<string, string>) {
		return this.request("POST", url, body, headers);
	}

	public put(url: string, body: any, headers?: Record<string, string>) {
		return this.request("PUT", url, body, headers);
	}

	public delete(url: string, headers?: Record<string, string>) {
		return this.request("DELETE", url, undefined, headers);
	}

	private async request(
		method: string,
		url: string,
		body?: any,
		headers?: Record<string, string>,
	): Promise<RequestUrlResponsePromise> {
		return requestUrl({
			url,
			method,
			contentType: "application/json",
			body: body ? JSON.stringify(body) : undefined,
			headers,
		});
	}
}

export const request = new HttpClient();

export { };

