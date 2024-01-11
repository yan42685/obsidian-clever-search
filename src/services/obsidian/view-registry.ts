import { THIS_PLUGIN } from "src/globals/constants";
import type CleverSearch from "src/main";
import { FileUtil } from "src/utils/file-util";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";

// inspired by https://github.com/MeepTech/obsidian-custom-file-extensions-plugin

@singleton()
export class ViewRegistry {
	private readonly markdownExtensions = ["md", "txt"];
	private readonly pdfExtensions = ["pdf"];
	private readonly canvasExtensions = ["canvas"];
	private readonly imageExtensions = ["jpg", "jpeg", "png", "gif", "svg"];
	private readonly audioExtensions = ["mp3", "wav"];
	private readonly videoExtensions = ["mp4", "webm"];
	private readonly extensionViewMap = new Map<string, ViewType>();
	private readonly plugin: CleverSearch = getInstance(THIS_PLUGIN);

	init() {
		this.fillMap(this.markdownExtensions, ViewType.MARKDOWN);
		this.fillMap(this.pdfExtensions, ViewType.PDF);
		this.fillMap(this.canvasExtensions, ViewType.CANVAS);
		this.fillMap(this.imageExtensions, ViewType.IMAGE);
		this.fillMap(this.audioExtensions, ViewType.AUDIO);
		this.fillMap(this.videoExtensions, ViewType.VIDEO);
		// register additional extensions with existing obsidian ViewType
		// so that users can open files in the obsidian with these extensions
		// see all viewTypes by (getInstance(App) as any).viewRegistry.viewByType
		try {
			this.plugin.registerExtensions(["txt"], ViewType.MARKDOWN);
		} catch (e) {
			// do nothing to suppress the error when using hot-reload for development which triggers the `plugin.onload()` multiple times
		}
	}

	// return the viewType in obsidian by path
	viewTypeByPath(path: string): ViewType {
		const viewType = this.extensionViewMap.get(FileUtil.getExtension(path));
		return viewType === undefined ? ViewType.UNSUPPORTED : viewType;
	}

	supportedExtensions(): Set<string> {
		// TODO: support more extensions
		return new Set(this.markdownExtensions);
	}

	private fillMap(extensions: string[], viewType: ViewType) {
		for (const ext of extensions) {
			this.extensionViewMap.set(ext, viewType);
		}
	}
}

export enum ViewType {
	UNSUPPORTED = "unsupported",
	MARKDOWN = "markdown",
	PDF = "pdf",
	CANVAS = "canvas",
	IMAGE = "image",
	AUDIO = "audio",
	VIDEO = "video",
}
