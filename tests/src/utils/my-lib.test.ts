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

	describe("getBasename", () => {
		it("should get the basename of a simple filepath", () => {
			const path = "/folder/file.txt";
			expect(MyLib.getBasename(path)).toBe("file");
		});

		it("should handle filenames with multiple dots", () => {
			const path = "/folder/my.file.name.with.dots.tar.gz";
			expect(MyLib.getBasename(path)).toBe("my.file.name.with.dots.tar");
		});

		it("should handle filenames without extension", () => {
			const path = "/folder/myfile";
			expect(MyLib.getBasename(path)).toBe("myfile");
		});

		it("should handle hidden files with extension", () => {
			const path = "/folder/.hiddenfile.txt";
			expect(MyLib.getBasename(path)).toBe(".hiddenfile");
		});
	});

	describe("getExtension", () => {
		it("should get the extension of a simple filepath", () => {
			const path = "/folder/file.txt";
			expect(MyLib.getExtension(path)).toBe("txt");
		});

		it("should handle filenames with multiple dots", () => {
			const path = "/folder/my.file.name.with.dots.tar.gz";
			expect(MyLib.getExtension(path)).toBe("gz");
		});

		it("should return empty string for filenames without extension", () => {
			const path = "/folder/myfile";
			expect(MyLib.getExtension(path)).toBe("");
		});

		it("should handle hidden files with extension", () => {
			const path = "/folder/.hiddenfile.txt";
			expect(MyLib.getExtension(path)).toBe("txt");
		});
	});

	describe("getFolderPath", () => {
		it("should return the folder path of a file", () => {
			expect(MyLib.getFolderPath("path/to/file.txt")).toBe("path/to/");
		});

		it('should return "./" for files in the root directory', () => {
			expect(MyLib.getFolderPath("/file.txt")).toBe("./");
		});

		it("should handle an empty path", () => {
			expect(MyLib.getFolderPath("")).toBe("./");
		});

		if (process.platform === "win32") {
			it("should handle Windows-style paths", () => {
				expect(MyLib.getFolderPath("C:\\path\\to\\file.txt")).toBe(
					"C:/path/to/",
				);
			});
		}
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
