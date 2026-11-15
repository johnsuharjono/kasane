import pg from "pg";
export function client(fixture = "commerce") {
  if (!["commerce", "analytics"].includes(fixture))
    throw new Error("Unknown fixture");
  const database = fixture === "analytics" ? "kasane_analytics" : "kasane_dev";
  const port = fixture === "analytics" ? 55433 : 55432;
  const connectionString =
    (fixture === "analytics"
      ? process.env.KASANE_ANALYTICS_DATABASE_URL
      : process.env.KASANE_DEV_DATABASE_URL) ??
    `postgresql://kasane:kasane_dev_only@127.0.0.1:${port}/${database}`;
  const url = new URL(connectionString);
  if (
    url.pathname !== `/${database}` ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  ) {
    throw new Error(
      `Fixture scripts require a localhost database named ${database}.`,
    );
  }
  return new pg.Client({ connectionString });
}
