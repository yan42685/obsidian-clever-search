import { jest } from "@jest/globals";
import { logger } from "src/utils/logger";

describe("Logger", () => {
	const originalConsole = { ...console };
	let consoleSpy: any;

	beforeEach(() => {
		consoleSpy = {
			debug: jest.spyOn(console, "debug").mockImplementation(() => {}),
			info: jest.spyOn(console, "info").mockImplementation(() => {}),
			warn: jest.spyOn(console, "warn").mockImplementation(() => {}),
			error: jest.spyOn(console, "error").mockImplementation(() => {}),
		};
	});

	afterEach(() => {
		jest.restoreAllMocks();
		console = originalConsole;
	});

	it("should log debug messages when log level is debug", () => {
		logger.setLevel("debug");
		logger.debug("Debug message");
		expect(consoleSpy.debug).toHaveBeenCalledWith(
			expect.anything(),
			"color: #5f6368;",
			"Debug message",
		);
	});

	it("should log info messages when log level is info", () => {
		logger.setLevel("info");
		logger.info("Info message");
		expect(consoleSpy.info).toHaveBeenCalledWith(
			expect.anything(),
			"color: blue;",
			"Info message",
		);
	});

	it("should log warning messages when log level is warn", () => {
		logger.setLevel("warn");
		logger.warn("Warning message");
		expect(consoleSpy.warn).toHaveBeenCalledWith(
			expect.anything(),
			"color: orange;",
			"Warning message",
		);
	});

	it("should log info messages when log level is debug", () => {
		logger.setLevel("debug");
		logger.info("Info message");
		expect(consoleSpy.info).toHaveBeenCalledWith(
			expect.anything(),
			"color: blue;",
			"Info message",
		);
	});

	it("should not log debug messages when log level is info", () => {
		logger.setLevel("info");
		logger.debug("Debug message");
		expect(consoleSpy.debug).not.toHaveBeenCalled();
	});

	it("should not log debug or info messages when log level is warn", () => {
		logger.setLevel("warn");
		logger.debug("Debug message");
		logger.info("Info message");
		expect(consoleSpy.debug).not.toHaveBeenCalled();
		expect(consoleSpy.info).not.toHaveBeenCalled();
	});

	it("should not log debug, info, or warn messages when log level is error", () => {
		logger.setLevel("error");
		logger.debug("Debug message");
		logger.info("Info message");
		logger.warn("Warning message");
		expect(consoleSpy.debug).not.toHaveBeenCalled();
		expect(consoleSpy.info).not.toHaveBeenCalled();
		expect(consoleSpy.warn).not.toHaveBeenCalled();
	});

	it("should not log any messages when log level is none", () => {
		logger.setLevel("none");
		logger.debug("Debug message");
		logger.info("Info message");
		logger.warn("Warning message");
		logger.error("Error message");
		expect(consoleSpy.debug).not.toHaveBeenCalled();
		expect(consoleSpy.info).not.toHaveBeenCalled();
		expect(consoleSpy.warn).not.toHaveBeenCalled();
		expect(consoleSpy.error).not.toHaveBeenCalled();
	});
});
