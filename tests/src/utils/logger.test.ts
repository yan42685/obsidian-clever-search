import { logger } from "src/utils/logger";

describe("Logger", () => {
	const originalConsole = { ...console };
	let consoleSpy: any;
	let consoleGroupCollapsedSpy: any;

	beforeEach(() => {
		consoleSpy = {
			trace: jest.spyOn(console, "trace").mockImplementation(() => {}),
			debug: jest.spyOn(console, "debug").mockImplementation(() => {}),
			info: jest.spyOn(console, "info").mockImplementation(() => {}),
			warn: jest.spyOn(console, "warn").mockImplementation(() => {}),
			error: jest.spyOn(console, "error").mockImplementation(() => {}),
		};
		consoleGroupCollapsedSpy = jest
			.spyOn(console, "groupCollapsed")
			.mockImplementation(() => {});
	});

	afterEach(() => {
		jest.restoreAllMocks();
		console = originalConsole;
	});
	it("should log trace messages when log level is trace", () => {
		logger.setLevel("trace");
		logger.trace("Trace message");
		expect(consoleGroupCollapsedSpy).toHaveBeenCalled();
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

	it("should log error messages when log level is error", () => {
		logger.setLevel("error");
		logger.error("Error message");
		expect(consoleSpy.error).toHaveBeenCalledWith(
			expect.anything(),
			"color: red;",
			"Error message",
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

	it("should not log trace messages when log level is debug or higher", () => {
		logger.setLevel("debug");
		logger.trace("Trace message");
		expect(consoleSpy.trace).not.toHaveBeenCalled();
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
