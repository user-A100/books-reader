# Books

Books is a personal, cross-platform desktop reader for building a calm local reading library. It supports common ebook formats, local shelves, reader appearance settings, custom symbol-color rules, background images, online-library shortcuts, and configurable book-source imports.

## Download

Windows users can download the latest portable build from the [Releases](https://github.com/user-A100/books-reader/releases) page. Extract the downloaded archive and launch `Books.exe`.

The portable build keeps the application self-contained. Your library and application data are stored in the location selected in Books and are not included in the release archive.

## Build the desktop app

Requirements: Node.js 20 or newer, Python, and Visual Studio C++ build tools with LLVM (Clang-cl) for native dependencies.

```powershell
npm install --legacy-peer-deps
npm run rebuild
npm run release
```

The Windows build is written to `dist/`. For a local portable build without an installer, use:

```powershell
npx electron-builder --win portable
```

## Development

```powershell
yarn install
yarn dev:background
```

The development reader runs in the background so the terminal can be closed. Use `yarn dev:stop` to stop it.

## License and attribution

Books is a rebuilt personal fork based on [Koodo Reader](https://github.com/koodo-reader/koodo-reader). It retains the upstream Apache License 2.0; see [LICENSE](./LICENSE) and [NOTICE.md](./NOTICE.md). The Books name, logo, local reading features, and subsequent changes are maintained independently.
