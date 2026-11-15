import { lazy, Suspense, type ComponentProps } from "react";
const Editor = lazy(() =>
  import("./SqlEditorInner").then((m) => ({ default: m.SqlEditor })),
);
export function SqlEditor(props: ComponentProps<typeof Editor>) {
  return (
    <Suspense fallback={<div className="editor-loading">Opening editor…</div>}>
      <Editor {...props} />
    </Suspense>
  );
}
