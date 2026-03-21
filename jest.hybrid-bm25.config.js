module.exports = {
	clearMocks: true,
	collectCoverage: false,
	moduleDirectories: ["node_modules", "<rootDir>"],
	moduleFileExtensions: ["ts", "js"],
	moduleNameMapper: {
		"^obsidian$": "<rootDir>/tests/__mocks__/obsidian.js",
	},
	roots: ["<rootDir>/tests/src/services/search"],
	setupFilesAfterEnv: ["<rootDir>/tests/src/jest-hybrid-bm25-setup.js"],
	testEnvironment: "node",
	testMatch: ["**/hybrid-bm25.test.ts"],
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
