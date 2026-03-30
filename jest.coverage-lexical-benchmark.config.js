const base = require("./jest.config.js");

module.exports = {
	...base,
	roots: ["<rootDir>/tests/src/services/search"],
	testMatch: ["**/coverage-lexical-automation-benchmark.bench.ts"],
	testTimeout: 30000,
};
