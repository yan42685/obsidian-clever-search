import { logger } from "src/utils/logger";
import { MyLib, formatMillis, monitorExecution } from "src/utils/my-lib";

describe("MyLib", () => {
	let originalConsoleError: any;
	let mockLoggerDebug: jest.SpyInstance;

	beforeAll(() => {
		originalConsoleError = console.error;
		console.error = jest.fn();

		// Mock logger.debug
		mockLoggerDebug = jest
			.spyOn(logger, "debug")
			.mockImplementation(() => {});
	});

	afterAll(() => {
		console.error = originalConsoleError;
		mockLoggerDebug.mockRestore();
	});

	describe("extractDomainFromUrl", () => {
		it("should extract the domain from a valid HTTPS URL", () => {
			const url = "https://www.example.com/page";
			expect(MyLib.extractDomainFromHttpsUrl(url)).toBe(
				"www.example.com",
			);
		});

		it("should return empty string for non-HTTPS URL", () => {
			const url = "http://www.example.com/page";
			expect(MyLib.extractDomainFromHttpsUrl(url)).toBe("");
		});
	});


	describe("formatMillis", () => {
		it("formats milliseconds correctly", () => {
			expect(formatMillis(500)).toBe("500 ms");
			expect(formatMillis(1000)).toBe("1 s 0 ms");
			expect(formatMillis(65000)).toBe("1 min 5 s 0 ms");
		});
	});
	describe("monitorExecution", () => {
		it("monitors and logs execution time of a function", async () => {
			const mockFn = jest.fn().mockResolvedValue("test");
			await monitorExecution(mockFn);

			expect(mockFn).toHaveBeenCalled();
			expect(mockLoggerDebug).toHaveBeenCalled();
		});
	});
});
