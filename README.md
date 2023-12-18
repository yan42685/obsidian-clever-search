# Obsidian Clever Search

## Demo

## Installation

- Install through [BRAT](https://github.com/TfTHacker/obsidian42-brat)
- (Manual) installation:
    1. Download the latest `main.js` and `manifest.json` from the [latest release](https://github.com/yan42685/obsidian-clever-search/releases)
    2. Create a folder with any name in `.obsidian/plugins` at your vault location.
    3. Move `main.js` and `manifest.json` into the folder you created
    4. click `reload plugins` at `Settings - Community plugins - installed plugins` and enable `Clever Search`

## Features

### Major

- [x] Fuzzy search inside current note
- [x] Realtime highlighting and Precise jump to the target location
- [x] Toggle privacy mode (Edit mode only)
- [ ] Search from selection
- [ ] Remember last query text
- [ ] AutoCompletion
- [ ] Persistent search history
- [ ] Fuzzy search in the vault
- [ ] Semantic search in the vault

### Subtle Tweaks for Better UX

- [x] keep focusing input bar even if clicking an item

## Supported Commands

| scope    | name                | hotkey                   |
| -------- | ------------------- | ------------------------ |
| item     | View Item Context   | `Left Click`             |
| modal    | Next Item           | `Ctrl-J` or `ArrowDown`  |
| modal    | Previous Item       | `Ctrl-K` or `ArrorUp`    |
| modal    | Confirm Item        | `Enter` or `Right Click` |
| obsidian | Search In File      | undefined                |
| obsidian | Toggle Privacy Mode | undefined                |
