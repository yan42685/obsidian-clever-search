import {
  ViewRegistry,
  type ViewType,
} from "src/services/obsidian/view-registry";
import type { LocaleKey } from "src/services/obsidian/translations/locale-helper";
import { FileUtil } from "src/utils/file-util";
import { getInstance } from "src/utils/my-lib";
export type IndexedDocument = {
  path: string;
  basename: string;
  folder: string;
  content?: string;
  aliases?: string;
  tags?: string;
  headings?: string;
};

export type DocumentFields = Array<keyof IndexedDocument>;

export type DocumentWeight = {
  [K in keyof IndexedDocument]?: number;
};

export type BaseIndexedFileRef = {
  path: string;
  generation: number;
  size?: number;
};

export type InFileDataSource = {
  lines: Line[];
  path: string;
};

export class Line {
  text: string;
  row: number;
  constructor(text: string, row: number) {
    this.text = text;
    this.row = row;
  }
}

export type LineFields = Array<keyof Line>;

// text: highlighted text
// col: the first highlighted col text
export type HighlightedContext = Line & { col: number };

export type MatchedLine = Line & { positions: Set<number> }; // positions: columns of matched chars

export type HighlightRange = {
  start: number;
  end: number;
};

export type MatchedFile = {
  path: string;
  queryTerms: string[];
  matchedTerms: string[];
  score?: number;
  basenameHighlightRanges?: HighlightRange[];
  folderHighlightRanges?: HighlightRange[];
  directSubItems?: FileSubItem[];
  nativeSubItemsReady?: boolean;
};

export class SearchResult {
  sourcePath: string;
  items: Item[];
  hybridFallbackNoticeKey?: LocaleKey | null;
  hybridEmbeddingIncomplete?: boolean;
  constructor(
    currPath: string,
    items: Item[],
    hybridFallbackNoticeKey?: LocaleKey | null,
    hybridEmbeddingIncomplete?: boolean,
  ) {
    this.sourcePath = currPath;
    this.items = items;
    this.hybridFallbackNoticeKey = hybridFallbackNoticeKey ?? null;
    this.hybridEmbeddingIncomplete = hybridEmbeddingIncomplete ?? false;
  }
}

export enum SearchType {
  NONE,
  IN_FILE,
  IN_VAULT,
}

export type HybridSearchMode = "default" | "lexical-lane";

export enum EngineType {
  LEXICAL,
  SEMANTIC,
}

export abstract class Item {
  element?: HTMLElement;
}

export class LineItem extends Item {
  line: HighlightedContext;
  context: string;

  constructor(line: HighlightedContext, context: string) {
    super();
    this.line = line;
    this.context = context;
  }
}

export class FileItem extends Item {
  engineType: EngineType;
  path: string;
  queryTerms: string[];
  matchedTerms: string[];
  basenameHighlightRanges?: HighlightRange[];
  folderHighlightRanges?: HighlightRange[];
  subItems: FileSubItem[]; // for markdown viewType
  nativeSubItemsReady: boolean;
  // TODO: impl this
  previewContent: any; // for non-markdown viewType
  // TODO: store the view type rather than relying on obsidian api
  get viewType(): ViewType {
    return getInstance(ViewRegistry).viewTypeByPath(this.path);
  }
  get basename() {
    return FileUtil.getBasename(this.path);
  }
  get extension() {
    return FileUtil.getExtension(this.path);
  }
  get folderPath() {
    return FileUtil.getFolderPath(this.path);
  }

  constructor(
    engineType: EngineType,
    path: string,
    queryTerms: string[],
    matchedTerms: string[],
    subItems: FileSubItem[],
    previewContent: any,
    nativeSubItemsReady = false,
    basenameHighlightRanges?: HighlightRange[],
    folderHighlightRanges?: HighlightRange[],
  ) {
    super();
    this.engineType = engineType;
    this.path = path;
    this.queryTerms = queryTerms;
    this.matchedTerms = matchedTerms;
    this.subItems = subItems;
    this.previewContent = previewContent;
    this.nativeSubItemsReady = nativeSubItemsReady;
    this.basenameHighlightRanges = basenameHighlightRanges;
    this.folderHighlightRanges = folderHighlightRanges;
  }
}

export class FileSubItem extends Item {
  text: string;
  row: number; // for precisely jumping to the original file location
  col: number;
  score?: number;
  snippetText?: string;
  highlightRanges?: HighlightRange[];
  private cachedSnippet?: string;
  private snippetBuilder?: () => string;

  get snippet(): string {
    if (this.cachedSnippet === undefined && this.snippetBuilder) {
      this.cachedSnippet = this.snippetBuilder();
    }
    return this.cachedSnippet ?? this.text;
  }

  set snippet(value: string) {
    this.cachedSnippet = value;
    this.snippetBuilder = undefined;
  }

  constructor(
    text: string,
    row: number,
    col: number,
    score?: number,
    snippet?: string | (() => string),
  ) {
    super();
    this.text = text;
    this.row = row;
    this.col = col;
    this.score = score;
    if (typeof snippet === "function") {
      this.snippetBuilder = snippet;
      this.cachedSnippet = undefined;
      return;
    }
    this.cachedSnippet = snippet ?? text;
  }
}

export type Location = {
  row: number;
  col: number;
};

export type LocatableFile = Location & {
  viewType: ViewType;
  path: string;
};
