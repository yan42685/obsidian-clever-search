import { App, type TFile } from "obsidian";
import { container } from "tsyringe";

/*
 * APIs in this file are not declared in the official obsidian.d.ts but are available in js
 */
class ObsidianPrivateAPI {
    app: App = container.resolve(App);
    getFileBacklinks(file: TFile) {
        // @ts-ignore
        this.app.metadataCache.getBacklinksForFile(file);
    }
}

export const obPrivateApi = new ObsidianPrivateAPI();