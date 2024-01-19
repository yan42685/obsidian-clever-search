# Change Log

## 0.1.4

### New

- `Floating window for in-file search` option
- Copyable result text

### Fixed

- Sometimes it fails to scroll to the target location when opening a large file
- Can't jump if no content matched, though the filenames or folders are matched

### BREAKING

- Removed feature: keep focusing input bar
- New `style settings` option: Main Background Color. Your current modal background color may be changed due to the default value for the new option

## 0.1.3

### New

- Support arbitrary extensions for plaintext files
- Path blacklist

### Improved

- Loading index around 3x faster

## 0.1.2

### New

- Automatically reindex the vault when the database have been updated


## 0.1.1

### New

- Support for txt, html (rely on `Surfing` plugin)
- Customizable filetypes to be indexed

### Fixed

- Performance issue related with dexie
- Conflicts with Excalidraw
- Excessively frequent index updates


## 0.1.0

### New

- Lexical search in vault (fuzzy and prefix match)
- Language patch for Chinese
- Automatically move the scrollbar when navigating items by hotkey
- customizable stop words list
- Share the necessary program assets across vaults to avoid repeated downloads for each vault

### Improved

- Use debounced search and cached result to decrease the latency of input
- Better in-file search performance
- Better preview experience: most of the blank lines located at boundary won't appear anymore
- Lots of performance optimization
- Adjust the modal styles


### Thanks

Thanks a lot to @scambier's Omnisearch, whose code was served as a reference