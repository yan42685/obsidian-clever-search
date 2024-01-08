# Obsidian Clever Search

> Enjoy swift access to your notes with minimal key presses

[中文文档](README-ZH.md) | [English Doc](README.md)

## Demo

### Realtime Search and Preview

![demo-search-in-file](assets/images/demo-search-in-file.gif)

### Privacy Mode

![demo-privacy-mode](assets/images/demo-privacy-mode.gif)

## Features

### Major

- [x] Fuzzy search in the vault
- [x] Fuzzy search inside current note
- [x] Realtime highlighting and Precise jump to the target location
- [x] Toggle privacy mode (Edit mode only)
- [ ] AutoCompletion
- [ ] Persistent search history
- [ ] Semantic search in the vault

### Subtle Tweaks for Better UX

- [x] keep focusing input bar even if clicking an item
- [x] Search from selection
- [ ] Remember last query text

### Integrate with other plugins

- [x] `Style Settings`
- [x] `Omnisearch`
    <details><summary>Details</summary>
        New command:<br>"Search in file with last Omnisearch query"<br><br>
        Use case:<br>
        When you confirm an in-vault search by Omnisearch and think there might be more matched text that are not listed by Omnisearch in current file, trigger this command will open a in-file search modal and fill the search bar with last query in Omnisearch.<br><br>
        Note: <br>This is just a temporary workaround for a better in-vault search. I will implement full-featured in-vault search without dependency on Omnisearch in the future.
    </details>


## Available Commands

| Scope    | Name                          |  Hotkey                   |
| -------- | ----------------------------- | ------------------------ |
| Item     | View item context             | `Left Click`             |
| Modal    | Next item                     | `Ctrl-J` or `ArrowDown`  |
| Modal    | Previous item                 | `Ctrl-K` or `ArrorUp`    |
| Modal    | Next subItem (in-vault)       | `Ctrl-N`                 |
| Modal    | previous subItem              | `Ctrl-P`                 |
| Modal    | Confirm item                  | `Enter` or `Right Click` |
| Obsidian | Search in vault               | undefined                |
| Obsidian | Search in File                | undefined                |
| Obsidian | Search in file with last Omnisearch query (to be deprecated) | undefined |
| Obsidian | Toggle privacy mode           | undefined                |

## Limitations

In-file Search performance may be slower when a file contains over 500k characters. I plan to enhance the system by automatically adjusting the fuzzy search level for larger files in the future.

## Installation

- Install through [BRAT](https://github.com/TfTHacker/obsidian42-brat) and turn on `Auto-update plugins at startup` option to automatically install the latest version when available.
- (Manual) installation:
    1. Download the latest `main.js`, `style.css` and `manifest.json` from the [latest release](https://github.com/yan42685/obsidian-clever-search/releases)
    2. Create a folder named `clever-search` in `.obsidian/plugins` at your vault location
    3. Move above files into the folder you created
    4. click `reload plugins` at `Settings - Community plugins - installed plugins` and enable `Clever Search`

## Support

If this plugin has been useful to you, I'd be sincerely thankful for your star⭐ or donation❤️.

[![image](assets/images/buymeacoffee.png)](https://www.buymeacoffee.com/AlexClifton)
