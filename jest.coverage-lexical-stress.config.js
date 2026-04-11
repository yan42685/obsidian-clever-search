const base = require("./jest.config.js");

module.exports = {
	...base,
	roots: ["<rootDir>/tests/src/services/search"],
	testMatch: ["**/coverage-lexical-candidate-cascade-stress.bench.ts"],
	testTimeout: 600000,
};
