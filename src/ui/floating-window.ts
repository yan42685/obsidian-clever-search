import { SearchType } from "../globals/search-types";
import { getInstance } from "../utils/my-lib";
import MountedModal from "./MountedModal.svelte";
import { ViewHelper } from "./view-helper";

export class FloatingWindow {
	private isDragging = false;
	private dragStartX = 0;
	private dragStartY = 0;
	private containerEl: HTMLDivElement;
	private frameEl: HTMLDivElement;
	private contentEl: HTMLDivElement;
	private mountedElement: any;

	open() {
		this.containerEl = document.body.createDiv();
		this.frameEl = this.containerEl.createDiv();
		this.contentEl = this.containerEl.createDiv();

		this.frameEl.addEventListener("mousedown", this.handleMouseDown);
		document.addEventListener("mousemove", this.handleMouseMove);
		document.addEventListener("mouseup", this.handleMouseUp);

		this.containerEl.style.position = "fixed";
		this.containerEl.style.top = "20px";
		this.containerEl.style.left = "20px";
		this.containerEl.style.zIndex = "1000";
		this.containerEl.style.border = "1px solid #454545";
		this.containerEl.style.borderRadius = "10px";
		// avoid the frameEl overflowing so that borderRadius of containerEl is covered
		this.containerEl.style.overflow = "hidden";
		this.containerEl.style.boxShadow = "0 2px 4px rgba(0,0,0,0.2)";

		this.frameEl.style.width = "100%";
		this.frameEl.style.height = "20px";
		this.frameEl.style.backgroundColor = "#333";
		this.frameEl.style.cursor = "move";
		this.frameEl.style.color = "#fff";
		this.frameEl.style.display = "flex";
		this.frameEl.style.alignItems = "center";
		this.frameEl.style.justifyContent = "right";
		this.frameEl.style.padding = "10px 0 10px 10px";

		this.contentEl.style.padding = "10px 0 10px 10px";
		this.contentEl.style.backgroundColor = "#262626";

		const closeButton = this.frameEl.createDiv();
		closeButton.innerText = "✖";
		closeButton.style.cursor = "pointer";
		closeButton.style.fontSize = "13px";
		closeButton.style.margin = "5px";
		closeButton.addEventListener("click", () => {
			document.removeEventListener("mousemove", this.handleMouseMove);
			document.removeEventListener("mouseup", this.handleMouseUp);
			this.containerEl.remove();
		});

		this.mountedElement = new MountedModal({
			target: this.contentEl,
			props: {
				showRightPane: false,
				onConfirmExternal: () => {},
				searchType: SearchType.IN_FILE,
				queryText: "",
			},
		});
		getInstance(ViewHelper).focusInput();
	}

	private handleMouseDown = (e: MouseEvent) => {
		this.isDragging = true;
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
	};
}
