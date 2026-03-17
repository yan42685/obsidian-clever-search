// src/utils/view-helper.ts
import { App, MarkdownView, TFile, Vault, type EditorPosition } from "obsidian";
import { NULL_NUMBER } from "src/globals/constants";
import { ObsidianCommandEnum } from "src/globals/enums";
import { OuterSetting } from "src/globals/plugin-setting";
import {
	FileItem,
	FileSubItem,
	Item,
	LineItem,
	SearchType,
} from "src/globals/search-types";
import { PrivateApi } from "src/services/obsidian/private-api";
import { ViewType } from "src/services/obsidian/view-registry";
import { SemanticEngine } from "src/services/search/semantic-engine";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
// TODO: When DOMPurify 3.1.8 is released, remove @types/dompurify due to an unreleased PR: https://github.com/cure53/DOMPurify/pull/1006
import DOMPurify from "dompurify";

@singleton()
export class ViewHelper {
  private readonly app = getInstance(App);
  private readonly privateApi = getInstance(PrivateApi);
  private readonly setting = getInstance(OuterSetting);

  // avoid XSS
  purifyHTML(rawHtml: string): string {
    return DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
  }

  updateSubItemIndex(
    subItems: FileSubItem[],
    currSubIndex: number,
    direction: "next" | "prev",
  ): number {
    const subItem = subItems[currSubIndex];
    const maxIndex = subItems.length - 1;
    this.scrollTo("center", subItem, "auto");
    if (direction === "next") {
      return currSubIndex < maxIndex ? currSubIndex + 1 : currSubIndex;
    } else {
      return currSubIndex > 0 ? currSubIndex - 1 : currSubIndex;
    }
  }

  async handleConfirmAsync(
    onConfirmExternal: () => void,
    sourcePath: string,
    searchType: SearchType,
    selectedItem: Item,
    currSubItemIndex: number,
    queryText: string,
  ) {
    onConfirmExternal();
    if (selectedItem) {
      if (searchType === SearchType.IN_FILE) {
        const lineItem = selectedItem as LineItem;
        await this.jumpInVaultAsync(
          sourcePath,
          lineItem.line.row,
          lineItem.line.col,
          queryText,
        );
      } else if (searchType === SearchType.IN_VAULT) {
        const fileItem = selectedItem as FileItem;
        const viewType = fileItem.viewType;
        if (currSubItemIndex !== NULL_NUMBER) {
          const subItem = fileItem.subItems[currSubItemIndex];
          if (viewType === ViewType.MARKDOWN) {
            // TODO: reuse tab for html
            // if (fileItem.extension === "html") {
            // 	const absolutePath =
            // 		this.privateApi.getAbsolutePath(fileItem.path);
            // 	const matchedText = subItem.text.replace(
            // 		/<mark>|<\/mark>/g,
            // 		"",
            // 	);
            // 	// logger.info(matchedText);
            // 	window.open(
            // 		`file:///${absolutePath}#:~:text=${matchedText}`,
            // 		"",
            // 	);
            // } else {
            await this.jumpInVaultAsync(
              fileItem.path,
              subItem.row,
              subItem.col,
              queryText,
            );
            // }
          } else {
            throw Error("unsupported viewType to jump");
          }
        } else {
          // no content text matched, but filenames or folders are matched
          await this.jumpInVaultAsync(fileItem.path, 0, 0, queryText);
        }
      } else {
        throw Error(`unsupported search type to jump ${searchType}`);
      }
    }
  }

  // for scroll bar
  scrollTo(
    direction: ScrollLogicalPosition,
    item: Item | undefined,
    behavior: ScrollBehavior,
  ) {
    // wait until the dom states are updated
    setTimeout(() => {
      if (item && item.element) {
        item.element.scrollIntoView({
          behavior: behavior,
          // behavior: "auto",
          // behavior: "instant",
          //@ts-ignore  the type definition mistakenly spell `block` as `lock`, so there will be a warning
          block: direction, // vertical
          // inline: "center"    // horizontal
        });
      }
    }, 0);
  }

  focusInput() {
    setTimeout(() => {
      const inputElement = document.getElementById("cs-search-input");
      inputElement?.focus();
    }, 0);
  }

  showNoResult(isSemantic: boolean) {
    if (isSemantic) {
      if (!this.setting.semantic.isEnabled) {
        return "Semantic search need to be enabled at the setting tab";
      }
      const semanticEngineStatus = getInstance(SemanticEngine).status;
      if (semanticEngineStatus === "ready") {
        return "No matched content";
      } else {
        return `Semantic engine is ${semanticEngineStatus}`;
      }
    } else {
      return "No matched content";
    }
  }

  insertFileLinkToActiveMarkdown(path: string | undefined) {
    if (path) {
      const activeMarkdownView =
        this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!activeMarkdownView?.file) {
        logger.info("No markdown view to insert file link");
        return;
      }

      const targetFile = getInstance(Vault).getAbstractFileByPath(
        path,
      ) as TFile;
      const linkText = this.app.fileManager.generateMarkdownLink(
        targetFile,
        activeMarkdownView.file.path,
      );
      activeMarkdownView.editor.replaceSelection(linkText + "\n");
    }
  }

  private async jumpInVaultAsync(
    path: string,
    row: number,
    col: number,
    queryText: string,
  ) {
    // 1. 尝试寻找已打开的 Leaf
    let targetLeaf: any = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (
        leaf.view instanceof MarkdownView &&
        leaf.getViewState().state?.file === path
      ) {
        targetLeaf = leaf;
      }
    });

    if (targetLeaf) {
      // 如果已打开，强制激活并聚焦
      this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
    } else {
      // 2. 如果未打开，执行打开动作
      // 注意：openLinkText 之后，Obsidian 会异步创建新 Leaf
      await this.app.workspace.openLinkText(
        path,
        "",
        this.setting.ui.openInNewPane,
      );

      // 3. 关键：重新扫描一次，抓取那个刚刚被设为 Active 的新 Leaf
      targetLeaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;

      // 如果抓不到（比如库太慢），就再遍历一次确认路径
      if (!targetLeaf || (targetLeaf.view as any).file?.path !== path) {
        this.app.workspace.iterateAllLeaves((leaf) => {
          if (
            leaf.view instanceof MarkdownView &&
            leaf.view.file?.path === path
          ) {
            targetLeaf = leaf;
          }
        });
      }
    }

    if (targetLeaf && targetLeaf.view instanceof MarkdownView) {
      const view = targetLeaf.view;

      // 强制确保当前 Leaf 是活动状态（解决“只打开不切换”的问题）
      this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });

      // 4. 精准等待编辑器就绪，不再使用魔术数字 50ms
      const isReady = await this.waitForEditor(view);

      if (isReady) {
        this.scrollIntoViewForExistingView(row, col, queryText);
      } else {
        console.warn("Editor failed to initialize in time.");
      }
    }
  }

  private scrollIntoViewForExistingView(
    row: number,
    col: number,
    queryText: string,
  ) {
    // WARN: this command inside this function will cause a warning in the console:
    // [Violation] Forced reflow while executing JavaScript took 55ms
    // if removing the command in this function, we can't focus the editor when switching to an existing view
    this.privateApi.executeCommandById(ObsidianCommandEnum.FOCUS_ON_LAST_NOTE);
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const cursorPos: EditorPosition = {
      line: row,
      ch: col,
    };

    if (view) {
      // auto-switch to editing mode if it's reading mode in target view
      const tmpViewState = view.getState();
      tmpViewState.mode = "source";
      view.setState(tmpViewState, { history: false });

      view.editor.setCursor(cursorPos);

      view.editor.scrollIntoView(
        {
          from: cursorPos,
          to: cursorPos,
        },
        true,
      );
      // the second jump is necessary because the images are lazy-rendered
      setTimeout(() => {
        view.editor.scrollIntoView(
          {
            from: cursorPos,
            to: cursorPos,
          },
          true,
        );

        // It doesn't take effect , use ObsidianCommandEnum.FOCUS_ON_LAST_NOTE instead
        // 	view.editor.focus();
        // 选中搜索关键字
        const line = view.editor.getLine(row);
        const textLength = queryText.length;
        const startPos = line.indexOf(queryText, col);
        if (startPos !== -1) {
          const fromPos = { line: row, ch: startPos };
          const toPos = { line: row, ch: startPos + textLength };

          // 使用 Obsidian 内置的高亮方法
          // 第一个参数是范围数组，第二个参数是 CSS 类名（'is-flashing' 是 Obsidian 内置的闪烁高亮类）
          // 第三个参数 true 表示如果已经有高亮则清除之前的
          (view.editor as any).addHighlights(
            [{ from: fromPos, to: toPos }],
            "is-flashing",
            true,
          );
        }

        // this command need to be triggered again if the view mode has been switched to `editing` from `reading`
        this.privateApi.executeCommandById(
          ObsidianCommandEnum.FOCUS_ON_LAST_NOTE,
        );
      }, 1);
    } else {
      logger.info("No markdown view to jump");
    }
  }
  // 等待新的 editor tab 绘制完成
  private async waitForEditor(
    view: MarkdownView,
    timeout = 2000,
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      // 检查 CodeMirror 实例和编辑器对象是否都已存在
      if (view.editor && (view.editor as any).cm) {
        return true;
      }
      // 交出控制权，等待下一帧重绘
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return false; // 超时
  }
}
