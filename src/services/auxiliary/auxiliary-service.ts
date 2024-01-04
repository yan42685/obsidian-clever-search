import { singleton } from "tsyringe";

@singleton()
export class AuxiliaryService {
	privacyModeEnabled = false;

	togglePrivacyMode() {
		this.privacyModeEnabled = !this.privacyModeEnabled;
		if (this.privacyModeEnabled) {
			document.body.classList.add("cs-privacy-blur");
		} else {
			document.body.classList.remove("cs-privacy-blur");
		}
	}
}