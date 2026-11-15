# Architecture

## Dependency decisions

Node and Cargo lockfiles pin dependencies.

- Tauri 2, React 19, TypeScript 7, Vite 8. The frontend contains no database driver and no persisted password.
- shadcn/ui Base UI variant (base-nova registry), Tailwind 4 with its Vite plugin, and semantic CSS-variable tokens in `src/theme.css`. Registry components cover buttons, inputs, textarea, select, checkbox, dialog, context menu, dropdown menu, tabs, tooltip, and resizable panels. Layouts and the data grid remain app-specific. App layout CSS lives in the components layer so Tailwind utilities can override it. Settings → Appearance provides persisted System/Light/Dark choices. System mode listens for OS preference changes; the root class, CSS color scheme, CodeMirror theme, and native window appearance follow it. Cmd+, and the Kasane application menu open Settings. See `THIRD_PARTY_NOTICES.md` for registry source/license provenance.
- CodeMirror 6 via the maintained React adapter, PostgreSQL dialect, namespace completion from catalog metadata. Its execution keymap has highest precedence over CodeMirror's default Cmd+Enter behavior. Editor code loads when needed; fonts are packaged locally.
- TanStack Table 9 for column definitions/sizing and TanStack Virtual 3 for independent horizontal/vertical windows. Fixed 32px rows, overscan, sticky headers, rectangle selection, and explicit viewport dimensions keep DOM size bounded. Long values render a 160-character preview; full values remain available in the inspector/clipboard. Grid components are memoized to avoid editor-driven rerenders.
- Zustand holds tabs, source, execution snapshots and stale flags. A source/layout-only persistence whitelist restores open workspaces from local webview storage; results and session handles remain in memory.
- `tokio-postgres` with native verified TLS supplies async I/O and cancellation tokens. Keychain calls run in blocking tasks, filesystem I/O uses Tokio, and each session owns a serialized client mutex. No query runs on the webview thread.
- Tauri's clipboard plugin has write-text permission only. Native open/save dialogs select local SQL files. Rust exposes bounded UTF-8 .sql reading/writing; no broad frontend filesystem API is exposed.

Sources: [Tauri project setup](https://v2.tauri.app/start/create-project/), [Tauri clipboard](https://v2.tauri.app/plugin/clipboard/), [shadcn Vite](https://ui.shadcn.com/docs/installation/vite), [TanStack Table installation](https://tanstack.com/table/latest/docs/installation), [virtualization](https://tanstack.com/table/latest/docs/framework/react/guide/virtualization), [CodeMirror SQL source](https://github.com/codemirror/lang-sql), [tokio-postgres Client](https://docs.rs/tokio-postgres/latest/tokio_postgres/struct.Client.html), [Faker usage](https://fakerjs.dev/guide/usage.html), [PostgreSQL supported releases](https://www.postgresql.org/support/versioning/).

## Session ownership

The sidebar browser has its own connection. Each table document, standalone SQL file, and notebook owns a separate session. Notebook SQL executes in displayed order for Run all, without parallel execution; individual cells share that same connection. A per-document frontend guard prevents overlapping runs and a backend mutex serializes actual session work. Temporary tables, SET commands, transactions, and failed transaction states persist naturally.

The user can cancel the active request via its request ID and PostgreSQL cancellation token; a stale cancellation ID cannot cancel a later request. Cancellation does not imply a write was rolled back: PostgreSQL transaction semantics still apply. Run all stops on failure. Nothing retries SQL. A disconnected session is marked unavailable until the user chooses Reconnect session; that opens a new session without running user SQL. Reset session also destroys temporary/session state and marks results outdated.

## Connection workspaces

A compact sidebar switcher chooses one connection workspace. Each connection may carry a color from a fixed eight-swatch palette (`color` in connections.json, validated in Rust); it tints the switcher mark and has no semantic meaning. Selection automatically opens a dedicated explorer session and loads its catalog; switching closes that explorer session. An effect owns the asynchronous open/catalog lifecycle and disposes late responses, so an earlier selection cannot replace the current catalog. Explicit disconnect also closes that workspace's document sessions and marks results outdated. A failed connection offers explicit retry rather than looping.

Tabs, saved-document libraries, active-tab selection, table filters, and explorer search/collapse state are scoped to the connection. Switching leaves independent document sessions and results live, including running queries. Documents inherit the workspace connection and are never silently retargeted. Restart restoration retains sources and layout, removes all execution/session state, and marks restored table tabs passive until Refresh. Schema metadata loading never replays user SQL.

## Catalog extras

The catalog query also returns `pg_class.reltuples` as an approximate row count for the sidebar; it is absent for views and never-analyzed tables, and no `COUNT(*)` runs. Single-column foreign keys come back as `fk_schema`/`fk_table`/`fk_column`; result headers show the target, and the row inspector's **Open …** link opens the referenced table filtered with `equals` on that key. Composite keys are not linked. Result columns carry `isEnum` from the driver's type kind so enum and boolean values render as neutral chips without an extra catalog query.

## Connection TLS and testing

`tlsMode` is `disable`, `require` (encrypted, certificate and host name not checked) or `verify-full`. Older connection files only have `tls`; `true` maps to `verify-full`, and saves keep `tls` set whenever encryption is on. **Test connection** opens a throwaway session with the unsaved settings, runs `SHOW server_version`, and closes it; without a typed password it uses the stored Keychain item.

## Value boundary and execution

The backend describes a single statement to obtain column names, PostgreSQL types and OIDs, then executes it using the text protocol. Values are `string | null`; counts are strings and metadata OIDs are safe u32 numbers. This avoids lossy conversions for bigint, arbitrary-precision numeric, timestamp microseconds, JSON numbers, bytea, arrays, enums, domains and extension types. Text is PostgreSQL's canonical output, not a promise to reproduce the original input spelling/timezone. New sessions request ISO dates, UTC timezone, hex bytea and round-trippable float text.

The initial transport retains bounded row/value-text data, then drains the remainder. It deliberately does not rewrite arbitrary SQL or automatically cancel a data-modifying statement when a display cap is reached. See README limits: server cost and single-row protocol memory are not bounded by the frontend retention budget. Binary transfer, portals and paged fetching need a separate implementation before claiming robust streaming of arbitrarily large fields.

## Local documents

Rust writes source-only, versioned notebook JSON through temporary-file replacement. Filenames use validated UUIDs inside the app data directory. Newly written files use mode 0600 and app directories 0700. Notebooks reference connection IDs, while Keychain uses a separate service/account pair. Notebook result state and session handles are never serialized. Opening a notebook is passive.

Stored source can contain user-entered sensitive SQL. There is no assumption that separating connection passwords makes all notebook content public. Disk encryption/backup and source hygiene remain user concerns.

## Next structural layer

The fixture includes FK constraints, a self-reference, composite primary keys, multiple index methods, expression/partial/covering indexes, comments, enum columns and generated columns. A future Structure tab should query `pg_catalog` for ordered constraint columns, FK actions, index definitions/methods, comments and view definitions. Build a typed metadata model first; render the relationship graph from that model later. Avoid guessing relations from column names or parsing display SQL when catalog OIDs identify objects accurately.

## SQL files and panel layouts

Table tabs have Data and Structure views. Open SQL creates a separate SQL-file document without executing it. The new-document menu offers an SQL document or a notebook. SQL documents are versioned app-data records (`sql-documents/<uuid>.sql.json`) containing only version, ID, title, connection ID and source. They are listed beside notebooks in the sidebar; Cmd+S saves internally and reopening the same ID focuses its existing tab without executing SQL. External `.sql` import/export uses native dialogs as optional copy operations. The backend validates UUIDs, versions, titles and a 1 MiB source limit; source/results/passwords are not conflated.

shadcn Resizable wraps react-resizable-panels for sidebar/workspace and editor/results layouts, with pointer and keyboard interaction. Sidebar width persists locally. Editor height remains per document. Query panel dimensions are persisted after user resize completion, avoiding state updates inside ResizeObserver delivery; grid ResizeObserver updates are scheduled through animation frames.

## Identifier quoting

Generated SQL quotes each schema/table/column identifier separately and doubles embedded quotes. This supports names with spaces, capitals, reserved words and punctuation without ambiguity. It does not require users to quote ordinary lowercase identifiers: `commerce.orders` and `"commerce"."orders"` refer to the same fixture relation. Unquoted PostgreSQL identifiers fold to lowercase. See [PostgreSQL lexical structure](https://www.postgresql.org/docs/current/sql-syntax-lexical.html).

## Table pages and preferences

Table previews fetch 500 rows plus one lookahead row, using LIMIT/OFFSET. The extra row determines Next independently of the exact count. PK column ordinals come from pg_index; PK columns break sorted ties and define default ordering. Keyless relations use output columns cast to text with C collation as tie breakers. Offset paging is not a long-lived snapshot: concurrent writes may move rows, and deep offsets or keyless sorts can be expensive.

Each successful table load automatically executes a filtered count on the document session after rendering the page, with the same busy guard, request IDs and cancellation as data queries. Applying or clearing filters and refreshing update the total without a separate count button. Counts remain exact decimal strings and use BigInt for formatting/page arithmetic. They describe the last count snapshot, match the active filter, and are never persisted. Sorting and filtering reset to page one. A retention-budget-truncated page disables Next to avoid skipping unretained rows.

Notebook inputs and outputs render as separate areas associated with stable cell IDs. Inserting, deleting, moving, or running a neighboring cell preserves existing outputs; editing a cell only invalidates its own result. Changes to the connection or session still invalidate results. Deleted cells can be restored with their output using Z; this history is held in memory only.

Notebook keyboard handling follows Jupyter's command/edit model: Esc selects a cell, Enter edits it, A/B insert above/below, D D deletes, Z restores, M/Y switch Markdown/SQL, and arrows or J/K select neighbors. Shift+Enter runs and advances, Ctrl+Enter runs in place, and Alt+Enter runs and inserts below. H or ? opens the shortcut dialog, also available from the app's help button. Cell prompts, outputs, and controls support command shortcuts; active text editors keep ordinary typing. SQL completion tooltips mount outside the bounded editor under document.body to avoid clipping.

Preferences persist locally: automatic preview applies to newly opened tables; font size and line wrapping apply live to SQL editors. Notebook result viewports grow with row count up to 360px; standalone SQL and table grids fill their resizable workspace.

The color tokens use an ink-blue dark palette inspired by the [official Poimandres palette](https://github.com/drcmda/poimandres-theme/blob/main/src/theme.js) and a custom cool-white light counterpart. UI chrome uses blue accents, while mint/pink are reserved for syntax and semantic states.
