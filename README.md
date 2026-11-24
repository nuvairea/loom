<h1 align="center">Loom</h1>

<p align="center">Weave your inspiration.</p>

<p align="center">
  <a href="https://nuvairea.github.io/loom/"><img alt="Live demo" src="https://img.shields.io/badge/demo-live-6b4fd8?style=flat-square&logo=githubpages&logoColor=white" /></a>
  <img alt="Design: Material 3 Expressive" src="https://img.shields.io/badge/design-Material_3_Expressive-6b4fd8?style=flat-square&logo=materialdesign&logoColor=white" />
  <img alt="JavaScript" src="https://img.shields.io/badge/JavaScript-ES_modules-e8f56a?style=flat-square&logo=javascript&logoColor=e8f56a&labelColor=1c1245" />
  <img alt="Storage: IndexedDB" src="https://img.shields.io/badge/storage-IndexedDB-e8f56a?style=flat-square&labelColor=1c1245&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZThmNTZhIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCI+PGVsbGlwc2UgY3g9IjEyIiBjeT0iNSIgcng9IjgiIHJ5PSIzIi8+PHBhdGggZD0iTTQgNXYxNGMwIDEuNyAzLjYgMyA4IDNzOC0xLjMgOC0zVjVNNCAxMmMwIDEuNyAzLjYgMyA4IDNzOC0xLjMgOC0zIi8+PC9zdmc+" />
  <a href="https://github.com/nuvairea/loom/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/nuvairea/loom?style=flat-square&labelColor=1c1245&color=6b4fd8&logo=github&logoColor=white" /></a>
</p>

<p align="center">
  <img src="./docs/loom.png" alt="Loom screenshot" />
</p>

## Table of Contents

- [How It Works](#how-it-works)
- [Design](#design)
- [Tech Stack](#tech-stack)
- [Usage](#usage)
- [Project Structure](#project-structure)
- [Limitations](#limitations)

## How It Works

Loom turns your collected images into a single visual board. Paste an image URL or upload files, drag to arrange them, and keep as many boards as you like. Uploads are downscaled to 2400px and saved as WebP.

Boards are saved in your browser with IndexedDB. Export a board as a PNG or send it with the Web Share API. Themes follow your system, and a wavy meter appears when storage reaches 80%.

## Design

Loom's look is inspired by [Material 3 Expressive](https://m3.material.io/), Google's design language: springy motion, shapes that morph, bold color, and a wavy progress indicator.

It's an independent project, not affiliated with or endorsed by Google.

## Tech Stack

- HTML, CSS, and JavaScript (ES modules)
- [Muuri](https://muuri.dev/) for the draggable masonry grid
- [html2canvas](https://html2canvas.hertzen.com/) for PNG export
- [idb](https://github.com/jakearchibald/idb) for IndexedDB access
- [Google Sans Flex](https://fonts.google.com/specimen/Google+Sans+Flex) and Material Symbols from Google Fonts

All libraries load from a CDN, so an internet connection is required.

## Usage

1. Paste an image URL and press **Add to weave**, or use the upload button to pick files from your device.
2. Drag images to rearrange them.
3. Rename the board by clicking its title.
4. Use the export button to save the board as a PNG, or the share button to send it to another app.
5. Remove an image with its **x** button, or use the reset button to clear everything.

## Project Structure

```
loom/
├── index.html
├── css/               load order matters, see index.html
│   ├── tokens.css     colors, dark mode
│   ├── base.css       reset, body, pill buttons
│   ├── dock.css       bottom bar and tools
│   ├── topbar.css     wordmark, board chip, count
│   ├── boards.css     board switcher panel and menu
│   ├── meter.css      wavy storage meter
│   ├── tiles.css      masonry, items, empty state
│   ├── utilities.css  .hidden, reduced motion
│   └── overlays.css   modals, toast, broken image overlay
├── docs/              screenshots
└── js/
    ├── main.js        app wiring, grid setup, restore flow
    ├── moodboard.js   creates and removes board items
    ├── storage.js     IndexedDB persistence, boards, and migrations
    ├── optimize.js    image downscaling and WebP encoding
    ├── export.js      PNG export and sharing
    ├── meter.js       wavy storage meter
    ├── validation.js  image URL validation
    ├── boards.js      board switcher, rename, duplicate, delete
    └── dom.js         shared DOM references
```

## Limitations

- Images added by URL must be publicly accessible, and the host must allow cross-origin requests
- Uploads are limited to 20MB each
- Boards live in your browser. Clearing site data erases them, and they do not sync across devices
