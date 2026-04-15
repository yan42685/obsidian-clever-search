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
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import type { HighlightRange } from "src/globals/search-types";
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

  renderHighlightedText(
    text: string,
    ranges: ReadonlyArray<HighlightRange> = [],
  ): string {
    if (!text) {
      return "";
    }
    if (ranges.length === 0) {
      return escapeHtml(text);
    }
    const mergedRanges = mergeRanges(ranges);
    let cursor = 0;
    let rendered = "";
    for (const range of mergedRanges) {
      const start = Math.max(0, Math.min(text.length, range.start));
      const end = Math.max(start, Math.min(text.length, range.end));
      if (start > cursor) {
        rendered += escapeHtml(text.slice(cursor, start));
      }
      if (end > start) {
        rendered += `<mark>${escapeHtml(text.slice(start, end))}</mark>`;
      }
      cursor = end;
    }
    if (cursor < text.length) {
      rendered += escapeHtml(text.slice(cursor));
    }
    return rendered;
  }

  updateSubItemIndex(
    subItems: FileSubItem[],
    currSubIndex: number,
    direction: "next" | "prev",
  ): number {
    if (subItems.length === 0) {
      return NULL_NUMBER;
    }
    const maxIndex = subItems.length - 1;
    const nextIndex =
      currSubIndex === NULL_NUMBER
        ? direction === "next"
          ? 0
          : maxIndex
        : direction === "next"
          ? Math.min(currSubIndex + 1, maxIndex)
          : Math.max(currSubIndex - 1, 0);
    this.scrollTo("center", subItems[nextIndex], "auto");
    return nextIndex;
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

  showNoResult() {
    return "No matched content";
  }

  getStructuredSnippetSegments(
    subItem: FileSubItem,
  ): Array<{ text: string; highlight: boolean }> | null {
    const snippetText = subItem.snippetText;
    const highlightRanges = subItem.highlightRanges;
    if (
      snippetText === undefined ||
      !highlightRanges ||
      highlightRanges.length === 0
    ) {
      return null;
    }
    const mergedRanges = mergeRanges(highlightRanges);
    const segments: Array<{ text: string; highlight: boolean }> = [];
    let cursor = 0;
    for (const range of mergedRanges) {
      const start = Math.max(0, Math.min(snippetText.length, range.start));
      const end = Math.max(start, Math.min(snippetText.length, range.end));
      if (start > cursor) {
        segments.push({
          text: snippetText.slice(cursor, start),
          highlight: false,
        });
      }
      if (end > start) {
        segments.push({
          text: snippetText.slice(start, end),
          highlight: true,
        });
      }
      cursor = end;
    }
    if (cursor < snippetText.length) {
      segments.push({
        text: snippetText.slice(cursor),
        highlight: false,
      });
    }
    return segments.length > 0 ? segments : [{ text: snippetText, highlight: false }];
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
      this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
    } else {
      await this.app.workspace.openLinkText(
        path,
        "",
        this.setting.ui.openInNewPane,
      );

      targetLeaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;

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
      this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });

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
    // This command triggers a forced reflow warning, but it is still needed
    // to reliably focus the editor when reusing an existing markdown view.
    this.privateApi.executeCommandById(ObsidianCommandEnum.FOCUS_ON_LAST_NOTE);
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const cursorPos: EditorPosition = {
      line: row,
      ch: col,
    };

    if (view) {
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

      // A second jump is still needed because images render lazily.
      setTimeout(() => {
        view.editor.scrollIntoView(
          {
            from: cursorPos,
            to: cursorPos,
          },
          true,
        );

        const line = view.editor.getLine(row);
        const textLength = queryText.length;
        const startPos = line.indexOf(queryText, col);
        if (startPos !== -1) {
          const fromPos = { line: row, ch: startPos };
          const toPos = { line: row, ch: startPos + textLength };
          (view.editor as any).addHighlights(
            [{ from: fromPos, to: toPos }],
            "is-flashing",
            true,
          );
        }

        this.privateApi.executeCommandById(
          ObsidianCommandEnum.FOCUS_ON_LAST_NOTE,
        );
      }, 1);
    } else {
      logger.info("No markdown view to jump");
    }
  }

  private async waitForEditor(
    view: MarkdownView,
    timeout = 2000,
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (view.editor && (view.editor as any).cm) {
        return true;
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return false;
  }
}

function mergeRanges(
  ranges: ReadonlyArray<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  if (ranges.length <= 1) {
    return [...ranges];
  }
  const ordered = [...ranges].sort((left, right) => left.start - right.start);
  const merged = [{ start: ordered[0].start, end: ordered[0].end }];
  for (let index = 1; index < ordered.length; index++) {
    const current = ordered[index];
    const previous = merged[merged.length - 1];
    if (current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end);
      continue;
    }
    merged.push({ start: current.start, end: current.end });
  }
  return merged;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}



