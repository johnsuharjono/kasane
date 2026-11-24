import {
  autocompletion,
  type Completion,
  type CompletionSection,
  type CompletionSource,
} from "@codemirror/autocomplete";
import {
  PostgreSQL,
  keywordCompletionSource,
  schemaCompletionSource,
  type SQLNamespace,
} from "@codemirror/lang-sql";
import { EditorView } from "@codemirror/view";
import { quoteIdent } from "./api";
import type { Relation } from "./types";

const sections = {
  schema: { name: "Schemas", rank: 0 },
  table: { name: "Tables & views", rank: 1 },
  column: { name: "Columns", rank: 2 },
  alias: { name: "Aliases", rank: 3 },
  function: { name: "Functions", rank: 4 },
  keyword: { name: "SQL keywords", rank: 5 },
  type: { name: "PostgreSQL types", rank: 6 },
} satisfies Record<string, CompletionSection>;

// The PostgreSQL dialect classifies these names as keywords for parsing.
const commonFunctions = new Set(
  "ABS ARRAY_AGG AVG CEIL CHAR_LENGTH COALESCE CONCAT COUNT DATE_TRUNC DENSE_RANK EXTRACT FLOOR GREATEST JSON_AGG JSONB_AGG LAG LEAD LEAST LENGTH LOWER MAX MIN NOW NULLIF RANK REPLACE ROUND ROW_NUMBER STRING_AGG SUBSTRING SUM TRIM UPPER".split(
    " ",
  ),
);

function identifier(
  label: string,
  section: CompletionSection,
  detail?: string,
): Completion {
  return {
    label,
    section,
    detail,
    apply: /^[a-z_][a-z0-9_$]*$/.test(label) ? undefined : quoteIdent(label),
  };
}

function catalogNamespace(catalog: Relation[]): SQLNamespace {
  const schemas = new Map<string, Record<string, SQLNamespace>>();
  for (const relation of catalog) {
    let tables = schemas.get(relation.schema);
    if (!tables) {
      tables = Object.create(null) as Record<string, SQLNamespace>;
      schemas.set(relation.schema, tables);
    }
    tables[relation.name.replaceAll(".", "\\.")] = {
      self: identifier(relation.name, sections.table, relation.kind),
      children: relation.columns.map(({ name, type }) =>
        identifier(name, sections.column, type),
      ),
    };
  }
  return Object.fromEntries(
    Array.from(schemas, ([name, children]) => [
      name.replaceAll(".", "\\."),
      { self: identifier(name, sections.schema), children },
    ]),
  );
}

const words = keywordCompletionSource(PostgreSQL, true, (label, type) => ({
  label,
  section: commonFunctions.has(label)
    ? sections.function
    : type === "type"
      ? sections.type
      : sections.keyword,
  boost: -1,
}));
const unqualifiedWords: CompletionSource = (context) =>
  context.matchBefore(/\.\s*[\p{L}\p{N}_$]*$/u) ? null : words(context);

export function sqlCompletion(catalog: Relation[]) {
  const names = schemaCompletionSource({
    dialect: PostgreSQL,
    schema: catalogNamespace(catalog),
    defaultSchema: "public",
  });
  const catalogNames: CompletionSource = async (context) => {
    const result = await names(context);
    if (!result) return null;
    return {
      ...result,
      options: result.options.map((option) =>
        option.section
          ? option
          : {
              ...option,
              section:
                option.type === "constant" ? sections.alias : sections.schema,
            },
      ),
    };
  };
  return autocompletion({
    override: [catalogNames, unqualifiedWords],
    filterStrict: true,
    icons: false,
    tooltipClass: () => "kasane-sql-suggestions",
  });
}

export const sqlCompletionTheme = EditorView.theme({
  ".cm-tooltip.kasane-sql-suggestions": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "9px",
    padding: "4px",
    boxShadow: "0 6px 20px color-mix(in srgb, black 18%, transparent)",
  },
  ".cm-tooltip.kasane-sql-suggestions > ul": {
    minWidth: "min(260px, calc(100vw - 24px))",
    maxWidth: "min(420px, calc(100vw - 24px))",
    maxHeight: "min(260px, 40vh)",
    fontFamily: "var(--app-sans)",
    fontSize: "12px",
    scrollbarWidth: "thin",
  },
  ".cm-tooltip.kasane-sql-suggestions > ul > completion-section": {
    color: "var(--muted-foreground)",
    padding: "7px 8px 4px",
    fontSize: "11px",
    fontWeight: "600",
    opacity: "1",
    border: "0",
  },
  ".cm-tooltip.kasane-sql-suggestions > ul > li": {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    minHeight: "27px",
    padding: "4px 8px",
    borderRadius: "5px",
  },
  ".cm-tooltip.kasane-sql-suggestions > ul > li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
  ".kasane-sql-suggestions .cm-completionLabel": {
    flex: "1",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  ".kasane-sql-suggestions .cm-completionMatchedText": {
    textDecoration: "none",
    fontWeight: "650",
  },
  ".kasane-sql-suggestions .cm-completionDetail": {
    color: "var(--muted-foreground)",
    fontSize: "11px",
    fontStyle: "normal",
    marginLeft: "auto",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "45%",
  },
});
