import { OuterSetting } from "src/globals/plugin-setting";
import { SettingManager } from "src/services/obsidian/setting-manager";
import { singleton } from "tsyringe";
import { SearchType } from "../globals/search-types";
import { TO_BE_IMPL, getInstance } from "../utils/my-lib";
import MountedModal from "./MountedModal.svelte";

@singleton()
export class FloatingWindowManager {
	toggle(windowType: "inFile" | "inVault") {
		if (windowType === "inFile") {
			getInstance(InFileFloatingWindow).toggle();
		} else {
			throw Error(TO_BE_IMPL);
		}
	}

	resetAllPositions() {
		const uiSetting = getInstance(OuterSetting).ui;

		uiSetting.inFileFloatingWindowLeft = "2.7em";
		uiSetting.inFileFloatingWindowTop = "2.5em";
		getInstance(FloatingWindowManager).toggle("inFile");
		getInstance(FloatingWindowManager).toggle("inFile");
	}

	onunload() {
		getInstance(InFileFloatingWindow).onClose();
	}
}
abstract class FloatingWindow {
	private isDragging = false;
	private dragStartX = 0;
	private dragStartY = 0;
	protected uiSetting = getInstance(OuterSetting).ui;
	protected containerEl: HTMLDivElement;
	private frameEl: HTMLDivElement;
	protected contentEl: HTMLDivElement;
	protected mountedElement: MountedModal | null = null;

	toggle(): FloatingWindow {
		if (this.mountedElement !== null) {
			this.onClose();
			return this;
		}
		this.containerEl = document.body.createDiv({ cls: "cs-floating-window-container" });
		this.frameEl = this.containerEl.createDiv({ cls: "cs-floating-window-frame" });
		this.contentEl = this.containerEl.createDiv({ cls: "cs-floating-window-content" });

		this.frameEl.addEventListener("mousedown", this.handleMouseDown);
		document.addEventListener("mousemove", this.handleMouseMove);
		document.addEventListener("mouseup", this.handleMouseUp);

		// load position and other states from setting
		this.loadContainerElStates();

		const closeButton = this.frameEl.createSpan({ text: "✖", cls: "cs-floating-window-close-button" });
		closeButton.addEventListener("click", this.onClose);

		this.mountComponent();
		return this;
	}

	// should be called on unload
	onClose = () => {
		document.removeEventListener("mousemove", this.handleMouseMove);
		document.removeEventListener("mouseup", this.handleMouseUp);
		// destroy svelte component
		this.mountedElement?.$destroy();
		this.mountedElement = null;
		this.containerEl?.remove();
	};

	protected abstract loadContainerElStates(): void;
	protected abstract saveContainerElStates(): void;
	protected abstract mountComponent(): void;

	private handleMouseDown = (e: MouseEvent) => {
		this.isDragging = true;
		this.containerEl.classList.add("cs-floating-window-dragging");
		this.dragStartX = e.pageX - this.containerEl.offsetLeft;
		this.dragStartY = e.pageY - this.containerEl.offsetTop;
		e.preventDefault(); // prevents text selection during drag
	};

	private handleMouseMove = (e: MouseEvent) => {
		if (this.isDragging) {
			this.containerEl.style.left = `${e.pageX - this.dragStartX}px`;
			this.containerEl.style.top = `${e.pageY - this.dragStartY}px`;
		}
	};

	private handleMouseUp = () => {
		this.isDragging = false;
		this.containerEl.classList.remove("cs-floating-window-dragging");
		// remember position and other stated
		this.saveContainerElStates();
		getInstance(SettingManager).postSettingUpdated();
	};
}

@singleton()
class InFileFloatingWindow extends FloatingWindow {
	protected mountComponent(): void {
		this.mountedElement = new MountedModal({
			target: this.contentEl,
			props: {
				uiType: "floatingWindow",
				onConfirmExternal: () => {},
				searchType: SearchType.IN_FILE,
				queryText: "",
			},
		});
	}
	protected loadContainerElStates(): void {
		this.containerEl.style.top = this.uiSetting.inFileFloatingWindowTop;
		this.containerEl.style.left = this.uiSetting.inFileFloatingWindowLeft;
	}
	protected saveContainerElStates(): void {
		this.uiSetting.inFileFloatingWindowLeft = this.containerEl.style.left;
		this.uiSetting.inFileFloatingWindowTop = this.containerEl.style.top;
	}
}
