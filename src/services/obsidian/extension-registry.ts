import { THIS_PLUGIN } from "src/globals/constants";
import type CleverSearch from "src/main";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";

@singleton()
export class ExtensionRegistry {
	readonly markdownExtensions = ["md", "txt"];
	readonly pdfExtensions = ["pdf"];
	readonly canvasExtensions = ["canvas"];
	readonly imageExtensions = ["jpg", "jpeg", "png", "gif"];
	readonly audioExtensions = ["mp3", "wav"];
	readonly videoExtensions = ["mp4"];
	private readonly extensionViewMap = new Map<string, ViewType>();
	private readonly plugin: CleverSearch = getInstance(THIS_PLUGIN);

	init() {
		this.registerExt(this.markdownExtensions, ViewType.markdown);
		this.registerExt(this.pdfExtensions, ViewType.pdf);
		this.registerExt(this.canvasExtensions, ViewType.canvas);
		this.registerExt(this.imageExtensions, ViewType.image);
		this.registerExt(this.audioExtensions, ViewType.audio);
		this.registerExt(this.videoExtensions, ViewType.video);
	}

	getViewType(extension: string): ViewType {
		const viewType = this.extensionViewMap.get(extension);
		return viewType === undefined ? ViewType.unsupported : viewType;
	}

	supportedExtensions(): Set<string> {
        // TODO: support more extensions
		return new Set(this.markdownExtensions);
	}

	private registerExt(extensions: string[], viewType: ViewType) {
		for (const ext of extensions) {
			this.extensionViewMap.set(ext, viewType);
		}
		this.plugin.registerExtensions(extensions, viewType.toString());
	}
}

export enum ViewType {
	"unsupported",
	"markdown",
	"pdf",
	"canvas",
	"image",
	"audio",
	"video",
}
