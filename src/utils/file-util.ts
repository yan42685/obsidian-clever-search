import { TFile, Vault } from "obsidian";
import { DEFAULT_BLACKLIST_EXTENSION } from "src/globals/constants";
import { FileType } from "src/globals/search-types";
import { MyLib, getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { PluginSetting } from "../services/obsidian/setting";


@singleton()
export class FileUtil {
	private static readonly fileTypeMap: Map<string, FileType> = new Map();
	static {
		FileUtil.fileTypeMap.set("", FileType.PLAIN_TEXT);
		FileUtil.fileTypeMap.set("md", FileType.PLAIN_TEXT);
		FileUtil.fileTypeMap.set("markdown", FileType.PLAIN_TEXT);
		FileUtil.fileTypeMap.set("txt", FileType.PLAIN_TEXT);
		FileUtil.fileTypeMap.set("jpg", FileType.IMAGE);
		FileUtil.fileTypeMap.set("png", FileType.IMAGE);
	}
	private readonly setting: PluginSetting = getInstance(PluginSetting);
	private readonly extensionBlacklist;
	constructor() {
		this.extensionBlacklist = new Set([
			...DEFAULT_BLACKLIST_EXTENSION.map(MyLib.getExtension),
			...this.setting.excludeExtensions.map(MyLib.getExtension),
		]);
	}


	static getFileType(path: string): FileType {
		const result = FileUtil.fileTypeMap.get(MyLib.getExtension(path));
		// NOTE: shouldn't use `result ? FileType.UNSUPPORTED : result;`
		// because result might be 0 rather than undefined
		return result === undefined ? FileType.UNSUPPORTED : result;
	}

}
