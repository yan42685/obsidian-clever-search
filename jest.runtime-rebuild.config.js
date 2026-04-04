module.exports = {
	clearMocks: true,
	collectCoverage: false,
	moduleDirectories: ["node_modules", "<rootDir>"],
	moduleFileExtensions: ["ts", "js"],
	moduleNameMapper: {
		"^jieba-wasm/pkg/web/jieba_rs_wasm$": "<rootDir>/tests/__mocks__/jieba-wasm-mock.js",
		"^obsidian$": "<rootDir>/tests/__mocks__/obsidian.js",
	},
	roots: ["<rootDir>/tests/src/services/search"],
	setupFilesAfterEnv: ["<rootDir>/tests/src/jest-setup.js"],
	testEnvironment: "node",
	testMatch: ["**/runtime-rebuild.bench.ts"],
	transform: {
		"^.+\\.(js|ts)$": [
			"babel-jest",
			{
				presets: [
					[
						"@babel/preset-env",
						{
							targets: { node: "current" },
							modules: "commonjs",
						},
					],
					"@babel/preset-typescript",
				],
				plugins: [["@babel/plugin-proposal-decorators", { legacy: true }]],
			},
		],
	},
};
