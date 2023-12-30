import { FileUtil } from "src/utils/file-util";


describe("file-util test", () => {
	describe("getBasename", () => {
		it("should get the basename of a simple filepath", () => {
			const path = "/folder/file.txt";
			expect(FileUtil.getBasename(path)).toBe("file");
		});

		it("should handle filenames with multiple dots", () => {
			const path = "/folder/my.file.name.with.dots.tar.gz";
			expect(FileUtil.getBasename(path)).toBe(
				"my.file.name.with.dots.tar",
			);
		});

		it("should handle filenames without extension", () => {
			const path = "/folder/myfile";
			expect(FileUtil.getBasename(path)).toBe("myfile");
		});

		it("should handle hidden files with extension", () => {
			const path = "/folder/.hiddenfile.txt";
			expect(FileUtil.getBasename(path)).toBe(".hiddenfile");
		});
	});

	describe("getExtension", () => {
		it("should get the extension of a simple filepath", () => {
			const path = "/folder/file.txt";
			expect(FileUtil.getExtension(path)).toBe("txt");
		});

		it("should handle filenames with multiple dots", () => {
			const path = "/folder/my.file.name.with.dots.tar.gz";
			expect(FileUtil.getExtension(path)).toBe("gz");
		});

		it("should return empty string for filenames without extension", () => {
			const path = "/folder/myfile";
			expect(FileUtil.getExtension(path)).toBe("");
		});

		it("should handle hidden files with extension", () => {
			const path = "/folder/.hiddenfile.txt";
			expect(FileUtil.getExtension(path)).toBe("txt");
		});
	});

	describe("getFolderPath", () => {
		it("should return the folder path of a file", () => {
			expect(FileUtil.getFolderPath("path/to/file.txt")).toBe("path/to/");
		});

		it('should return "./" for files in the root directory', () => {
			expect(FileUtil.getFolderPath("/file.txt")).toBe("./");
		});

		it("should handle an empty path", () => {
			expect(FileUtil.getFolderPath("")).toBe("./");
		});

		if (process.platform === "win32") {
			it("should handle Windows-style paths", () => {
				expect(FileUtil.getFolderPath("C:\\path\\to\\file.txt")).toBe(
					"C:/path/to/",
				);
			});
		}
	});
});
