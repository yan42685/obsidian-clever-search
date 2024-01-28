import { requestUrl, type RequestUrlResponsePromise } from "obsidian";

export class RequestOption {
	baseUrl: string;
	protocol: "http" | "https" = "http";
}
export class HttpClient {
	option: RequestOption;
	constructor(option: RequestOption) {
		this.option = option;
	}

	public get(
		url: string,
		params?: Record<string, any>,
		headers?: Record<string, string>,
	) {
		url = `${this.option.protocol}://${this.option.baseUrl}${url}`;
		const fullUrl = this.buildUrlWithParams(url, params);
		return this.request("GET", fullUrl, undefined, headers);
	}

	public post(url: string, body: any, headers?: Record<string, string>) {
		url = `${this.option.protocol}://${this.option.baseUrl}${url}`;
		return this.request("POST", url, body, headers);
	}

	public put(url: string, body: any, headers?: Record<string, string>) {
		url = `${this.option.protocol}://${this.option.baseUrl}${url}`;
		return this.request("PUT", url, body, headers);
	}

	public delete(
		url: string,
		params?: Record<string, any>,
		headers?: Record<string, string>,
	) {
		url = `${this.option.protocol}://${this.option.baseUrl}${url}`;
		const fullUrl = this.buildUrlWithParams(url, params);
		return this.request("DELETE", fullUrl, undefined, headers);
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

	private buildUrlWithParams(
		url: string,
		params?: Record<string, any>,
	): string {
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
