module.exports = {
	clearMocks: true,
	collectCoverage: false,
	moduleDirectories: ["node_modules", "<rootDir>"],
	moduleFileExtensions: ["ts", "js"],
	roots: ["<rootDir>/tests/src/services/search"],
	testEnvironment: "node",
	testMatch: ["**/hnsw-recall.bench.ts"],
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
