# Kasane development database

Disposable, synthetic PostgreSQL data for browsing, notebooks, types, and grid benchmarks. Uses Docker Compose project **kasane-dev**, its own named volume, and **127.0.0.1:55432**.

From the repository root, with Bun, Node 24+, and Docker running:

```sh
make setup
make db-up
make db-seed
make db-verify
```

`make db-reset` destroys Kasane's volume, starts a fresh PostgreSQL instance, seeds it, and verifies it. `make db-down` stops/removes the container while retaining its volume. `make db-destroy` deletes Kasane's container and volume. `make db-shell` opens psql.

Connection: host `127.0.0.1`, port `55432`, database `kasane_dev`, username `kasane`, password `kasane_dev_only`, TLS disabled. These are public, development-only credentials. The container port is bound to loopback.

The app's connection form uses these defaults; enter the password once to save it in macOS Keychain.

## Data

Faker seed **20261115** and fixed date boundaries make the data reproducible with the locked Faker version. The default fixture contains:

- `commerce.customers`: 1,000 synthetic customers.
- `commerce.categories`: 12 categories, including a parent/child relationship.
- `commerce.products`: 250 products with arrays and JSON attributes.
- `commerce.orders`: 8,000 orders with enum status and optional values.
- `commerce.order_items`: 24,000 items with a composite primary key and generated exact decimal total.
- `commerce.payments`: 4,142 payments derived from order totals inside PostgreSQL.
- `commerce.events`: 15,000 events; some intentionally anonymous.
- `commerce.order_summary`: a join/aggregate view.
- `lab.wide_results`: 5,000 rows × 81 columns, with long and null values.
- `lab.type_samples`: bigint extremes, 60-digit decimals, microsecond timestamps, binary values, intervals, arrays, nested JSON, Unicode, null/empty/literal NULL, long text and nonfinite values.
- `lab."Odd table"`: quoted/reserved/Unicode identifiers.

Seven foreign keys and 20 indexes include unique, composite/covering, partial, expression, GIN, and BRIN definitions. Table/column comments and generated/default expressions provide structure-view fixtures. `queries.sql` includes joins, introspection, cancellation, and notebook temporary-table examples.

For a larger dataset:

```sh
SEED_SCALE=5 make db-seed
make db-verify
```

Scale accepts integers 1–20. It multiplies customers, orders, items, events, and wide rows. Categories/products remain fixed; payment count follows generated order statuses. No runtime dependency on Faker is included in the desktop app.

`db-seed` transactionally recreates **only the commerce and lab schemas**, using an advisory lock to serialize seeds. It can roll back a failed seed. It rejects non-local URLs and database names other than `kasane_dev`. You can override the local endpoint with `KASANE_DEV_DATABASE_URL`; `db-reset` always manages the Compose instance, so avoid endpoint overrides with that target. Recreating the volume disconnects active sessions; reconnect deliberately in Kasane.

## Second connection fixture

The optional `multi` Compose profile adds a separate PostgreSQL container and volume on **127.0.0.1:55433**. The commerce and analytics fixtures have separate databases and volumes.

```sh
make db-multi-up
make db-seed-analytics
make db-multi-check
```

Add a saved connection in Kasane with display name **Analytics sandbox**, database **kasane_analytics**, host **127.0.0.1**, port **55433**, user **kasane**, password **kasane_dev_only**, TLS disabled. The display name and database subtitle are two labels for one profile.

The deterministic seed (20261116) contains `workspace.organizations` (120), `workspace.members` (900), `workspace.projects` (450), `workspace.deployments` (5,000), `workspace.project_activity` (view), and `billing.invoices` (240). Five foreign keys plus unique/composite/partial/GIN indexes provide structure examples in a different database. The seed transaction recreates only `workspace` and `billing` inside the guarded local database `kasane_analytics`; it verifies its row counts and foreign keys afterward. Use `KASANE_ANALYTICS_DATABASE_URL` to override its local endpoint.

`make db-multi-reset` destroys/recreates/reseeds both Kasane fixtures. `make db-down` stops both while keeping their data; `make db-destroy` removes both fixture volumes. The ordinary `make db-reset` removes both Kasane volumes but recreates only the original commerce fixture; run the multi targets to recreate analytics afterward.

The multi-connection Playwright test uses both real PostgreSQL servers with a browser-side Tauri test bridge. Test connection profiles and document libraries are in-memory and are not written into your personal Kasane app data or Keychain. The test verifies connection-scoped tabs and libraries, independent sessions, switching back without query replay, and source-only workspace restoration after a reload. Actual app-data file persistence is covered by the Rust tests.
