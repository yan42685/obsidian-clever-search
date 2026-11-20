const base = require("./jest.config.js");

module.exports = {
	...base,
	moduleNameMapper: {
		...base.moduleNameMapper,
		"^jieba-wasm/pkg/web/jieba_rs_wasm$":
			"<rootDir>/tests/__mocks__/jieba-wasm-real-node.js",
	},
	roots: ["<rootDir>/tests/src/services/search"],
	testMatch: ["**/coverage-lexical-v3-startup-synthetic-benchmark.bench.ts"],
	testTimeout: 300000,
};
