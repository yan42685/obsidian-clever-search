# Change Log

## 0.1.2

### new

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