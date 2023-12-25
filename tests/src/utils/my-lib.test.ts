import { MyLib } from "src/utils/my-lib";

describe("MyLib", () => {
	let originalConsoleError: any;

	beforeAll(() => {
		// 保存原始的 console.error
		originalConsoleError = console.error;
		// Mock console.error
		console.error = jest.fn();
	});

	afterAll(() => {
		// 恢复原始的 console.error
		console.error = originalConsoleError;
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
});
