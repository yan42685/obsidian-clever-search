import { jest } from "@jest/globals";
import { logger } from "src/utils/logger";
import { my } from "src/utils/my-lib";

describe("MyLib getDomainFromUrl", () => {
	// Mock logger.error
	logger.error = jest.fn();

	it("should return the domain from an https URL", () => {
		expect(my.getDomainFromUrl("https://www.example.com/path")).toBe(
			"www.example.com",
		);
	});

	it("should return an empty string and log an error for http URL", () => {
		expect(my.getDomainFromUrl("http://www.example.com/path")).toBe("");
		expect(logger.error).toHaveBeenCalledWith(
			"Only support https, current url starts with http",
		);
	});

	it("should return the domain from a URL without a protocol", () => {
		expect(my.getDomainFromUrl("www.example.com/path")).toBe(
			"www.example.com",
		);
	});

	it("should return the domain from a URL with trailing slash", () => {
		expect(my.getDomainFromUrl("https://www.example.com/")).toBe(
			"www.example.com",
		);
	});
});
