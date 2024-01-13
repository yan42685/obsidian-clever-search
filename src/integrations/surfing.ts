import { App } from "obsidian";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";

@singleton()
export class SurfingIntegration {
    isEnabled() {
        const app: any = getInstance(App);
        const surfing =  app.plugins.plugins.surfing;
        return surfing && surfing._loaded;
    }
}