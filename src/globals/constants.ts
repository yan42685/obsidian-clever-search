/**
 * Use this string as the key to retrieve the CleverSearch instance from the tsyringe container.
 */
export const THIS_PLUGIN = "CleverSearch";
export const ICON_COLLAPSE = '"▶"';
export const ICON_EXPAND = '"▼"';
export const NULL_NUMBER = -1;
export const HTML_4_SPACES = "&nbsp;&nbsp;&nbsp;&nbsp;";

// large charset language can apply fuzzier params and should show less preChars when previewing
// currently only support Chinese
export const LARGE_CHARSET_LANG_REGEX = /[\u4e00-\u9fa5]/;

export const DEFAULT_BLACKLIST_EXTENSION = [
	".zip",
	".rar",
	".7z",
	".tar",
	".gz",
	".bz2",
	".xz",
	".lz",
	".lzma",
	".tgz",
];