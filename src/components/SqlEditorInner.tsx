import { closeCompletion } from "@codemirror/autocomplete";
import { usePreferences } from "../preferences";
import { useAppearance } from "../appearance";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import {
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  type Ref,
} from "react";
import CodeMirror from "@uiw/react-codemirror";
import { PostgreSQL } from "@codemirror/lang-sql";
import { sqlCompletion, sqlCompletionTheme } from "../sql-completion";
import { Prec, type EditorState } from "@codemirror/state";
import { keymap, EditorView, placeholder, tooltips } from "@codemirror/view";
import type { Relation } from "../types";

function statementAtCursor({ doc, selection }: EditorState) {
  const cursor = selection.main.head;
  const line = doc.lineAt(cursor);
  const tree = PostgreSQL.language.parser.parse(doc.toString());
  // On indentation or trailing whitespace, use a statement on the same line.
  let statement;
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.from > line.to) break;
    if (
      node.name !== "Statement" ||
      node.firstChild?.name === ";" ||
      node.to < line.from
    )
      continue;

    if (node.from <= cursor && cursor < node.to) {
      statement = node;
      break;
    }
    if (node.from > cursor) {
      statement ??= node;
      break;
    }
    statement = node;
  }
  if (statement) return doc.sliceString(statement.from, statement.to);
}

export function SqlEditor({
  value,
  onChange,
  onRun,
  runMode = "document",
  runRef,
  onCommandMode,
  catalog,
  compact = false,
  fill = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onRun: (source: string) => void;
  runMode?: "document" | "statement";
  runRef?: Ref<() => void>;
  onCommandMode?: () => void;
  catalog: Relation[];
  compact?: boolean;
  fill?: boolean;
}) {
  const editorView = useRef<EditorView | null>(null);
  const run = useCallback(
    (view: EditorView) => {
      const source =
        runMode === "statement"
          ? statementAtCursor(view.state)
          : view.state.doc.toString();
      if (source !== undefined) onRun(source);
    },
    [onRun, runMode],
  );
  useImperativeHandle(
    runRef,
    () => () => {
      if (editorView.current) run(editorView.current);
    },
    [run],
  );
  const { resolved } = useAppearance();
  const { editorFontSize, lineWrapping } = usePreferences();
  const editorTheme = useMemo(
    () =>
      EditorView.theme(
        {
          "&": {
            backgroundColor: "var(--background)",
            color: "var(--foreground)",
          },
          ".cm-cursor": { borderLeftColor: "var(--foreground)" },
          ".cm-tooltip": {
            backgroundColor: "var(--popover)",
            color: "var(--popover-foreground)",
            borderColor: "var(--border)",
          },
        },
        { dark: resolved === "dark" },
      ),
    [resolved],
  );
  const completion = useMemo(() => sqlCompletion(catalog), [catalog]);
  const extensions = useMemo(
    () => [
      tooltips({ parent: document.body, position: "fixed" }),
      ...(lineWrapping ? [EditorView.lineWrapping] : []),
      syntaxHighlighting(
        HighlightStyle.define([
          { tag: tags.keyword, color: "var(--syntax-keyword)" },
          {
            tag: [tags.string, tags.special(tags.string)],
            color: "var(--syntax-string)",
          },
          {
            tag: [tags.number, tags.bool, tags.null],
            color: "var(--syntax-number)",
          },
          { tag: tags.comment, color: "var(--syntax-comment)" },
          {
            tag: [tags.name, tags.operator, tags.punctuation],
            color: "var(--foreground)",
          },
        ]),
      ),
      PostgreSQL.extension,
      completion,
      sqlCompletionTheme,
      placeholder("Write SQL…  ⌘↵ to run"),
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: (view) => {
              run(view);
              return true;
            },
          },
        ]),
      ),
      EditorView.theme({
        "&": {
          fontSize: `${editorFontSize}px`,
          backgroundColor: "transparent",
        },
        ".cm-content": {
          fontFamily: '"SF Mono", Menlo, monospace',
          padding: "16px 0",
          minHeight: fill ? "0" : compact ? "100px" : "200px",
        },
        ".cm-gutters": {
          backgroundColor: "transparent",
          border: "none",
          color: "var(--muted-foreground)",
        },
        ".cm-activeLine": { backgroundColor: "transparent" },
        "&.cm-focused .cm-activeLine": {
          backgroundColor:
            "color-mix(in srgb, var(--foreground) 5%, transparent)",
        },
        ".cm-activeLineGutter": { backgroundColor: "transparent" },
        ".cm-placeholder": { color: "var(--muted-foreground)" },
        "&.cm-focused": { outline: "none" },
        ".cm-scroller": { overflow: "auto" },
        ".cm-selectionBackground": {
          backgroundColor: "var(--accent) !important",
        },
      }),
    ],
    [completion, run, compact, fill, editorFontSize, lineWrapping],
  );
  return (
    <CodeMirror
      onCreateEditor={(view) => {
        editorView.current = view;
      }}
      onKeyDownCapture={(e) => {
        const view = editorView.current;
        if (
          e.key !== "Escape" ||
          !onCommandMode ||
          !view ||
          e.nativeEvent.isComposing
        )
          return;
        // Escape leaves notebook edit mode even when suggestions are open.
        closeCompletion(view);
        e.preventDefault();
        e.stopPropagation();
        onCommandMode();
      }}
      theme={editorTheme}
      value={value}
      onChange={onChange}
      extensions={extensions}
      basicSetup={{
        foldGutter: false,
        highlightActiveLine: true,
        autocompletion: false,
      }}
      height={fill ? "100%" : undefined}
      maxHeight={fill ? "100%" : compact ? "340px" : "400px"}
      aria-label="SQL editor"
    />
  );
}
