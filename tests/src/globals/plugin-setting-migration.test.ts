/** @jest-environment jsdom */

import {
	CURRENT_OUTER_SETTING_SCHEMA_VERSION,
	DEFAULT_OUTER_SETTING,
} from "src/globals/plugin-setting";
import { migrateOuterSetting } from "src/globals/plugin-setting-migration";

describe("plugin setting migration", () => {
	test("migrates weak file prune mode from standard to lenient and removes legacy keys", () => {
		const result = migrateOuterSetting({
			weakFilePruneMode: "standard",
			hideWeaklyRelevantFiles: true,
			hybrid: {
				searchStrategy: "legacy",
				enableHighPerformanceMode: true,
				highPerformanceMaxMb: 256,
				excludedPaths: ["tmp"],
			},
		});

		expect(result.didMigrate).toBe(true);
		expect(result.data.settingsSchemaVersion).toBe(
			CURRENT_OUTER_SETTING_SCHEMA_VERSION,
		);
		expect(result.data.hideWeaklyRelatedResults).toBe(true);
		expect(result.data.weakFilePruneMode).toBeUndefined();
		expect(result.data.hideWeaklyRelevantFiles).toBeUndefined();
		expect(result.data.hybrid).toEqual({
			excludedPaths: ["tmp"],
		});
	});

	test("keeps current-version settings stable", () => {
		const result = migrateOuterSetting({
			...DEFAULT_OUTER_SETTING,
		});

		expect(result.didMigrate).toBe(false);
		expect(result.data).toEqual({
			...DEFAULT_OUTER_SETTING,
		});
	});
});
