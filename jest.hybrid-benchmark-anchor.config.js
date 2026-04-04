module.exports = {
	clearMocks: true,
	collectCoverage: false,
	moduleDirectories: ["node_modules", "<rootDir>"],
	moduleFileExtensions: ["ts", "js"],
	moduleNameMapper: {
		"^obsidian$": "<rootDir>/tests/__mocks__/obsidian.js",
	},
	roots: ["<rootDir>/tests/src/services/search"],
	setupFilesAfterEnv: ["<rootDir>/tests/src/jest-hybrid-benchmark-anchor-setup.js"],
	testEnvironment: "node",
	testMatch: ["**/hybrid-benchmark-anchor.test.ts"],
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
