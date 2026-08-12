# Calibre format conversion — archived implementation

Status: paused and removed from the active application on 2026-08-12.

## What was proven

- Calling calibre's standalone `ebook-convert` process produced a valid EPUB
  from the project's HTML on Windows.
- The tested runtime was calibre 9.13.0.
- The staged Windows runtime was about 705 MB including the matching 46 MB
  source archive and licensing material.
- React production compilation succeeded with the conversion UI enabled.
- The runtime was successfully copied to `resources/calibre` by
  electron-builder before packaging reached the host's unrelated Windows
  signing/symlink-permission failure.

## Recommended architecture if resumed

Keep calibre as an independent GPLv3 command-line program. Do not copy its
Python modules into the Electron application and do not copy only
`ebook-convert`, because it requires calibre's complete runtime and plugins.

At build time:

1. Pin a calibre version and official platform artifact.
2. Download it from `https://download.calibre-ebook.com/<version>/`.
3. Verify its pinned SHA-512 hash before extraction.
4. Extract the complete platform runtime into
   `vendor/calibre-runtime/current`.
5. Run `ebook-convert --version` and require the pinned version.
6. Include the runtime with electron-builder `extraResources`, targeting
   `resources/calibre`.
7. Include calibre's GPLv3 license, copyright notices, and matching
   corresponding source archive.

At runtime, resolve the executable in this order:

1. `CALIBRE_EBOOK_CONVERT`, for developer overrides.
2. The bundled executable below `process.resourcesPath/calibre`.
3. A system calibre installation as an optional fallback.

Run it with `child_process.execFile(executable, [input, output])`, never through
a shell. Validate sender, input path, input/output formats, and prevent the
output path from matching the source. The completed prototype exposed EPUB,
AZW3, MOBI, PDF, DOCX, FB2, and TXT output.

## Pinned 9.13.0 artifacts

Official artifacts:

- Windows x64: `calibre-64bit-9.13.0.msi`
- macOS universal: `calibre-9.13.0.dmg`
- Linux x64: `calibre-9.13.0-x86_64.txz`
- Linux ARM64: `calibre-9.13.0-arm64.txz`
- Source: `calibre-9.13.0.tar.xz`

The official checksums are published under
`https://calibre-ebook.com/signatures/`. Re-fetch and pin them when resuming;
do not trust a moving `latest` URL.

Platform limitations observed during research:

- Current Windows calibre builds are x64 only. Do not enable the bundled
  engine in a Books ia32 package. Windows ARM64 would depend on x64 emulation.
- Linux provides separate x64 and ARM64 runtimes.
- The macOS DMG contains a universal application; preserve the complete
  `calibre.app` bundle.

## Product integration that was removed

- `main.js`: format allowlists, bundled/system executable lookup,
  `execFile` conversion runner, and `convert-book-format` IPC handler.
- Book “More actions”: target-format submenu, conversion status toasts, and
  success-file reveal.
- `package.json`: `prepare:calibre`, release hook, `extraResources`, and the
  temporary Windows signing exclusion.
- English and Simplified Chinese conversion strings.
- `NOTICE.md` calibre redistribution notice.
- `scripts/prepare-calibre-runtime.js` and generated runtime files.

If this feature is resumed, add cancellation and progress events before
shipping. Calibre emits progress lines such as `67% message` which can be
parsed from stdout/stderr.

## Licensing note

Calibre is GPLv3. Redistribution is permitted, but a release that includes its
object code must also preserve notices and provide the corresponding source as
required by GPLv3. The previous prototype placed the exact source archive next
to the runtime. This note is technical guidance, not legal advice.

References:

- https://manual.calibre-ebook.com/conversion.html
- https://manual.calibre-ebook.com/generated/en/ebook-convert.html
- https://calibre-ebook.com/download_linux
- https://github.com/kovidgoyal/calibre/blob/master/LICENSE
- https://github.com/kovidgoyal/calibre/blob/master/COPYRIGHT
