import { useRef, type ReactNode, type Ref } from "react";
import { SqlEditor } from "./SqlEditor";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "./ui/resizable";
import type { Relation } from "../types";
export function QueryPane({
  source,
  onChange,
  onRun,
  runRef,
  catalog,
  height = 240,
  onResize,
  children,
}: {
  source: string;
  onChange: (v: string) => void;
  onRun: (statement: string) => void;
  runRef: Ref<() => void>;
  catalog: Relation[];
  height?: number;
  onResize: (height: number) => void;
  children: ReactNode;
}) {
  const measuredHeight = useRef(height);
  return (
    <ResizablePanelGroup
      orientation="vertical"
      className="query-document"
      onLayoutChanged={(_, meta) => {
        if (meta.isUserInteraction) onResize(measuredHeight.current);
      }}
    >
      <ResizablePanel
        id="editor"
        defaultSize={height}
        minSize={100}
        onResize={(size) => {
          measuredHeight.current = size.inPixels;
        }}
      >
        <div className="query-editor-pane">
          <div className="editor-label">
            <span>SQL</span>
            <span>PostgreSQL</span>
          </div>
          <SqlEditor
            fill
            value={source}
            onChange={onChange}
            onRun={onRun}
            runMode="statement"
            runRef={runRef}
            catalog={catalog}
          />
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="Resize SQL editor and results" />
      <ResizablePanel id="results" minSize={130}>
        <div className="query-results-pane">{children}</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
