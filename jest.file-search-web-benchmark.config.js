const base = require("./jest.config.js");

module.exports = {
	...base,
	roots: ["<rootDir>/tests/src/services/search"],
	testMatch: ["**/file-search-web-benchmark.bench.ts"],
	testTimeout: 180000,
};
