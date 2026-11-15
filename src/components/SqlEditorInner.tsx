import { closeCompletion } from "@codemirror/autocomplete";
import { usePreferences } from "../preferences";
import { useAppearance } from "../appearance";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { PostgreSQL, sql } from "@codemirror/lang-sql";
import { Prec } from "@codemirror/state";
import { keymap, EditorView, placeholder, tooltips } from "@codemirror/view";
import type { Relation } from "../types";
export function SqlEditor({
  value,
  onChange,
  onRun,
  onCommandMode,
  catalog,
  compact = false,
  fill = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  onCommandMode?: () => void;
  catalog: Relation[];
  compact?: boolean;
  fill?: boolean;
}) {
  const editorView = useRef<EditorView | null>(null);
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
  const schema = useMemo(() => {
    const namespaces: Record<string, Record<string, string[]>> = {};
    catalog.forEach((r) => {
      (namespaces[r.schema] ??= {})[r.name] = r.columns.map((c) => c.name);
    });
    return namespaces;
  }, [catalog]);
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
      sql({
        dialect: PostgreSQL,
        schema,
        defaultSchema: "public",
        upperCaseKeywords: true,
      }),
      placeholder("Write SQL…  ⌘↵ to run"),
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              onRun();
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
    [schema, onRun, onCommandMode, compact, fill, editorFontSize, lineWrapping],
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
        autocompletion: true,
      }}
      height={fill ? "100%" : undefined}
      maxHeight={fill ? "100%" : compact ? "340px" : "400px"}
      aria-label="SQL editor"
    />
  );
}
