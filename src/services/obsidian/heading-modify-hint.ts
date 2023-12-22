import { Editor, MarkdownView, Plugin } from "obsidian";
import { THIS_PLUGIN } from "src/utils/constants";
import { container } from "tsyringe";

export class HeadingModifyHint {
	private plugin: Plugin;
	private selectionCheckInterval: number;
	private lastSelection: string;

	constructor() {
		this.plugin = container.resolve(THIS_PLUGIN);
	}

	init() {
		this.plugin.registerEvent(
			this.plugin.app.workspace.on(
				"active-leaf-change",
				this.handleLeafChange.bind(this),
			),
		);
	}

	private handleLeafChange() {
		const markdownView =
			this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdownView) return;

		const editor = markdownView.editor as any;

		// logger.debug("codemirror: " + editor.cm as EditorView);
		window.clearInterval(this.selectionCheckInterval);
		this.selectionCheckInterval = window.setInterval(() => {
			this.checkForSelectionChange(editor);
		}, 500);
	}

	private checkForSelectionChange(editor: Editor) {
		const currentSelection = editor.getSelection();
		if (currentSelection && currentSelection !== this.lastSelection) {
			this.lastSelection = currentSelection;
			this.checkSelectionForHeadings(editor);
		}
	}

	checkSelectionForHeadings(editor: Editor) {
		// 获取选中文本的范围
		const selectionRange = editor.listSelections()[0];
		const startLine = Math.min(
			selectionRange.anchor.line,
			selectionRange.head.line,
		);
		const endLine = Math.max(
			selectionRange.anchor.line,
			selectionRange.head.line,
		);

		// 获取当前文件的所有标题
		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (activeFile) {
			const cache = this.plugin.app.metadataCache.getFileCache(activeFile);
			const headings = cache?.headings;

			// 检查选中文本中是否包含标题
			let includedHeadings: any[] = [];
			if (headings) {
				includedHeadings = headings.filter((heading) => {
					return (
						heading.position.start.line >= startLine &&
						heading.position.start.line <= endLine
					);
				});
			}

			// 打印包含的所有标题行
			includedHeadings.forEach((heading) => {
				console.log(
					`Heading: "${heading.heading}" at line ${heading.position.start.line}`,
				);
			});
		}
	}

	unregisterEvent() {
		window.clearInterval(this.selectionCheckInterval);
	}
}
