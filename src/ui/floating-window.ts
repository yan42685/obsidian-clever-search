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
	private isResizing = false;
	private resizeStartX = 0;
	private resizeStartY = 0;
	private resizeStartWidth = 0;
	private resizeStartHeight = 0;
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

		this.containerEl = document.body.createDiv();
		this.frameEl = this.containerEl.createDiv();
		this.frameEl.addClass('cs-floating-window-header');
		this.contentEl = this.containerEl.createDiv();

		this.frameEl.addEventListener("mousedown", this.handleMouseDown);
		document.addEventListener("mousemove", this.handleMouseMove);
		document.addEventListener("mouseup", this.handleMouseUp);

		this.containerEl.addClass("cs-floating-window-container");
		this.containerEl.style.position = "fixed";
		this.containerEl.style.minWidth = "200px";
		this.containerEl.style.minHeight = "100px";
		// load position and other states from setting
		this.loadContainerElStates();
		this.containerEl.style.zIndex = "20";
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

		// 关闭按钮
		const closeButton = this.frameEl.createSpan();
		closeButton.addClass("cs-close-btn");
		closeButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<line x1="18" y1="6" x2="6" y2="18"></line>
			<line x1="6" y1="6" x2="18" y2="18"></line>
		</svg>`;
		closeButton.style.cursor = "pointer";
		closeButton.style.padding = "2px";
		closeButton.style.margin = "5px";
		closeButton.style.display = "flex";
		closeButton.style.alignItems = "center";
		closeButton.style.justifyContent = "center";
		closeButton.style.borderRadius = "4px";
		closeButton.style.transition = "background-color 0.2s ease";
		closeButton.addEventListener("mouseover", () => {
			closeButton.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
		});
		closeButton.addEventListener("mouseout", () => {
			closeButton.style.backgroundColor = "transparent";
		});
		closeButton.addEventListener("click", this.onClose);
		this.frameEl.appendChild(closeButton);

		this.contentEl.style.padding = "10px 0 10px 10px";
		// 添加滚动条支持
		this.contentEl.style.overflow = "auto";
		this.contentEl.style.height = "calc(100% - 40px)"; // 减去标题栏高度
		this.contentEl.style.boxSizing = "border-box";

		// 添加调整大小的手柄
		const resizeHandle = this.containerEl.createDiv();
		resizeHandle.addClass("cs-resize-handle");
		resizeHandle.style.position = "absolute";
		resizeHandle.style.right = "0";
		resizeHandle.style.bottom = "0";
		resizeHandle.style.width = "10px";
		resizeHandle.style.height = "10px";
		resizeHandle.style.cursor = "se-resize";
		
		resizeHandle.addEventListener("mousedown", this.handleResizeStart);
		document.addEventListener("mousemove", this.handleResize);
		document.addEventListener("mouseup", this.handleResizeEnd);

		// 添加窗口大小变化监听
		window.addEventListener("resize", this.handleWindowResize);

		this.mountComponent();
		return this;
	}

	// should be called on unload
	onClose = () => {
		document.removeEventListener("mousemove", this.handleMouseMove);
		document.removeEventListener("mouseup", this.handleMouseUp);
		document.removeEventListener("mousemove", this.handleResize);
		document.removeEventListener("mouseup", this.handleResizeEnd);
		window.removeEventListener("resize", this.handleWindowResize);
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
		this.containerEl.style.opacity = "0.75";
		this.dragStartX = e.pageX - this.containerEl.offsetLeft;
		this.dragStartY = e.pageY - this.containerEl.offsetTop;
		e.preventDefault(); // prevents text selection during drag
	};

	private handleMouseMove = (e: MouseEvent) => {
		if (this.isDragging) {
			const newLeft = e.pageX - this.dragStartX;
			const newTop = e.pageY - this.dragStartY;
			
			this.containerEl.style.left = `${newLeft}px`;
			this.containerEl.style.top = `${newTop}px`;
			
			// 在拖动时也进行位置调整
			this.adjustPosition();
		}
	};

	private handleMouseUp = () => {
		this.isDragging = false;
		this.containerEl.style.opacity = "1";
		// remember position and other stated
		this.saveContainerElStates();
		getInstance(SettingManager).postSettingUpdated();
	};

	private handleResizeStart = (e: MouseEvent) => {
		this.isResizing = true;
		this.resizeStartX = e.pageX;
		this.resizeStartY = e.pageY;
		this.resizeStartWidth = this.containerEl.offsetWidth;
		this.resizeStartHeight = this.containerEl.offsetHeight;
		e.preventDefault();
	};

	private handleResize = (e: MouseEvent) => {
		if (!this.isResizing) return;
		
		const newWidth = this.resizeStartWidth + (e.pageX - this.resizeStartX);
		const newHeight = this.resizeStartHeight + (e.pageY - this.resizeStartY);
		
		// 设置最小尺寸限制
		const width = Math.max(200, newWidth);
		const height = Math.max(100, newHeight);
		
		// 确保调整大小时不会超出视口
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const rect = this.containerEl.getBoundingClientRect();

		// 设置一个尺寸比例限制，让浮动窗口可以一定程度超出范围
		const ratio = 0.5;
		
		if (rect.left * ratio + width <= viewportWidth) {
			this.containerEl.style.width = `${width}px`;
		}
		if (rect.top * ratio + height <= viewportHeight) {
			this.containerEl.style.height = `${height}px`;
		}
	};

	private handleResizeEnd = () => {
		if (!this.isResizing) return;
		this.isResizing = false;
		this.saveContainerElStates();
		getInstance(SettingManager).postSettingUpdated();
	};

	private handleWindowResize = () => {
		if (this.containerEl) {
			this.adjustPosition();
		}
	};

	private adjustPosition() {
		const rect = this.containerEl.getBoundingClientRect();
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;

		// 计算新位置，确保窗口完全在视口内
		let newLeft = parseInt(this.containerEl.style.left);
		let newTop = parseInt(this.containerEl.style.top);

		// 设置一个尺寸比例限制，让浮动窗口可以一定程度超出范围
		const ratio = 0.5;

		// 处理右边界
		if (rect.right - rect.width * ratio > viewportWidth) {
			newLeft = viewportWidth - rect.width * ratio;
		}
		// 处理下边界
		if (rect.bottom - rect.height * ratio > viewportHeight) {
			newTop = viewportHeight - rect.height * ratio;
		}
		// 处理左边界
		if (rect.left < 0) {
			newLeft = 0;
		}
		// 处理上边界
		if (rect.top < 0) {
			newTop = 0;
		}

		// 应用新位置
		this.containerEl.style.left = `${newLeft}px`;
		this.containerEl.style.top = `${newTop}px`;

		// 保存新位置到设置
		this.saveContainerElStates();
		getInstance(SettingManager).postSettingUpdated();
	}
}

@singleton()
class InFileFloatingWindow extends FloatingWindow {
	protected mountComponent(): void {
		// 获取当前选中的文本
		const selection = window.getSelection();
		const selectedText = selection ? selection.toString().trim() : "";

		this.mountedElement = new MountedModal({
			target: this.contentEl,
			props: {
				uiType: "floatingWindow",
				onConfirmExternal: () => {},
				searchType: SearchType.IN_FILE,
				isSemantic: false,
				queryText: selectedText,
			},
		});
	}

	protected loadContainerElStates(): void {
		this.containerEl.style.top = this.uiSetting.inFileFloatingWindowTop;
		this.containerEl.style.left = this.uiSetting.inFileFloatingWindowLeft;
		this.containerEl.style.width = this.uiSetting.inFileFloatingWindowWidth || "300px";
		this.containerEl.style.height = this.uiSetting.inFileFloatingWindowHeight || "200px";
	}

	protected saveContainerElStates(): void {
		this.uiSetting.inFileFloatingWindowLeft = this.containerEl.style.left;
		this.uiSetting.inFileFloatingWindowTop = this.containerEl.style.top;
		this.uiSetting.inFileFloatingWindowWidth = this.containerEl.style.width;
		this.uiSetting.inFileFloatingWindowHeight = this.containerEl.style.height;
	}
}
