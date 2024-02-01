import { requestUrl, type RequestUrlResponse } from "obsidian";

export class HttpClientOption {
	baseUrl: string;
	protocol: "http" | "https" = "http";
	responseProcessor: (resp: RequestUrlResponse) => any | null;
	headers?: Record<string, string>;
}
export class HttpClient {
	option: HttpClientOption;
	constructor(option: HttpClientOption) {
		this.option = option;
	}

	async get(url: string, params?: Record<string, any>) {
		return this.request("GET", url, params, undefined);
	}

	async post(url: string, params?: Record<string, any>, body?: any) {
		return this.request("POST", url, params, body);
	}

	async put(url: string, params?: Record<string, any>, body?: any) {
		return this.request("PUT", url, params, body);
	}

	async delete(url: string, params?: Record<string, any>) {
		return this.request("DELETE", url, params, undefined);
	}

	private async request(
		method: string,
		url: string,
		params?: Record<string, any>,
		body?: any,
	): Promise<any | null> {
		url = this.buildUrlWithParams(url, params);
		return this.option.responseProcessor(
			await requestUrl({
				url,
				method,
				contentType: "application/json",
				body: body ? JSON.stringify(body) : undefined,
				headers: this.option.headers,
			}),
		);
	}

	private buildUrlWithParams(
		url: string,
		params?: Record<string, any>,
	): string {
		url = `${this.option.protocol}://${this.option.baseUrl}/${url}`;
		const queryString = params ? this.serializeParams(params) : "";
		return queryString ? `${url}?${queryString}` : url;
	}

	private serializeParams(params: Record<string, any>): string {
		return Object.keys(params)
			.map((key) => {
				const value = params[key];
				return `${encodeURIComponent(key)}=${encodeURIComponent(
					this.stringifyParam(value),
				)}`;
			})
			.join("&");
	}

	private stringifyParam(value: any): string {
		if (typeof value === "object") {
			return JSON.stringify(value);
		}
		return String(value);
	}
}
