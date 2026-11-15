# Testing

Start and seed the local fixture, install the browser engines, then run the checks:

```sh
make db-up db-seed
npx playwright install chromium webkit
make check
```

Run individual checks with:

```sh
npm run build
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml -- --include-ignored
npm test
```

## Coverage

Rust tests use real PostgreSQL sessions and temporary files. They cover exact database values, catalog primary keys, session isolation, temporary tables, cancellation, errors, result limits, and SQL document persistence.

Playwright runs the UI in WebKit and Chromium against real PostgreSQL through a test bridge. Connection profiles, document storage, clipboard, and native dialogs are isolated test substitutes. The tests cover:

- Connections, catalog browsing, table paging, filtering, sorting, and exact counts.
- SQL completion, execution shortcuts, document save/reopen, and tab reuse.
- Notebook command/edit modes, insertion from prompts and outputs, deletion/undo, execution shortcuts, and shortcut help.
- Independent notebook outputs: neighboring edits, inserts, deletes, reorders, and runs preserve results; editing the source invalidates its own output.
- Workspace switching and restoration without query replay.
- Grid selection, copying, inspection, column resizing, and virtualization.
- Panel resizing, appearance, editor preferences, and compact notebook results.

Browser tests do not exercise native Keychain access, Tauri IPC, or the macOS window. Check those in the desktop app before a release.

## Multiple connections

```sh
make db-multi-up
make db-seed-analytics
make db-multi-check
```

This uses a second local database on port 55433 to test workspace isolation and late catalog responses. See the [fixture guide](../dev/db/README.md).

## Grid measurements

The workspace test scrolls an 81-column result for 100 animation frames and records frame intervals and rendered cell counts in `test-results/*-metrics.json`. Screenshots are written to `test-results/` and `artifacts/`.

These are headless development-build measurements, not release WKWebView benchmarks. Profile native scrolling, memory, IPC transfer, and large schemas before making performance claims. The result retention limit does not bound PostgreSQL server work or the size of a protocol message.
