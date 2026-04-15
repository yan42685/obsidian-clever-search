import { CURRENT_OUTER_SETTING_SCHEMA_VERSION } from "./plugin-setting";

type RawSettingRecord = Record<string, unknown>;

export type OuterSettingMigrationResult = {
	data: RawSettingRecord;
	didMigrate: boolean;
};

export function migrateOuterSetting(raw: unknown): OuterSettingMigrationResult {
	const data = cloneRawSettingRecord(raw);
	let didMigrate = !isRawSettingRecord(raw);
	let version = readOuterSettingSchemaVersion(data);

	while (version < CURRENT_OUTER_SETTING_SCHEMA_VERSION) {
		switch (version) {
			case 0:
				migrateOuterSettingV0ToV1(data);
				version = 1;
				didMigrate = true;
				break;
			case 1:
				migrateOuterSettingV1ToV2(data);
				version = 2;
				didMigrate = true;
				break;
			default:
				version = CURRENT_OUTER_SETTING_SCHEMA_VERSION;
				didMigrate = true;
				break;
		}
	}

	if (data.settingsSchemaVersion !== CURRENT_OUTER_SETTING_SCHEMA_VERSION) {
		data.settingsSchemaVersion = CURRENT_OUTER_SETTING_SCHEMA_VERSION;
		didMigrate = true;
	}

	return { data, didMigrate };
}

function migrateOuterSettingV0ToV1(data: RawSettingRecord): void {
	if (data.weakFilePruneMode === "standard") {
		data.weakFilePruneMode = "lenient";
	}

	delete data.hideWeaklyRelevantFiles;

	const hybrid = cloneOptionalRawSettingRecord(data.hybrid);
	if (hybrid) {
		delete hybrid.searchStrategy;
		delete hybrid.enableHighPerformanceMode;
		delete hybrid.highPerformanceMaxMb;
		data.hybrid = hybrid;
	}
}

function migrateOuterSettingV1ToV2(data: RawSettingRecord): void {
	if (typeof data.hideWeaklyRelatedResults !== "boolean") {
		data.hideWeaklyRelatedResults = data.weakFilePruneMode !== "off";
	}
	delete data.weakFilePruneMode;
	delete data.hideWeaklyRelevantFiles;
}

function readOuterSettingSchemaVersion(data: RawSettingRecord): number {
	const value = data.settingsSchemaVersion;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		return 0;
	}
	return value;
}

function cloneOptionalRawSettingRecord(value: unknown): RawSettingRecord | null {
	return isRawSettingRecord(value) ? { ...value } : null;
}

function cloneRawSettingRecord(value: unknown): RawSettingRecord {
	return cloneOptionalRawSettingRecord(value) ?? {};
}

function isRawSettingRecord(value: unknown): value is RawSettingRecord {
	return typeof value === "object" && value != null && !Array.isArray(value);
}
