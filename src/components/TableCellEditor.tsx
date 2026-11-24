import { Ellipsis } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "./Button";
import { Checkbox } from "./ui/checkbox";
import { Popover, PopoverContent, PopoverTitle } from "./ui/popover";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

// Reindent JSON tokens without converting numbers through JavaScript's number type.
function indentJson(source: string) {
  if (source.length > 65_536) return source;
  try {
    JSON.parse(source);
  } catch {
    return source;
  }
  const tokens =
    source.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:"]+/g) ?? [];
  let depth = 0;
  const newline = () => "\n" + "  ".repeat(Math.min(depth, 20));
  return tokens
    .map((token, i) => {
      if (token === "{" || token === "[") {
        depth++;
        return (
          token +
          (tokens[i + 1] === (token === "{" ? "}" : "]") ? "" : newline())
        );
      }
      if (token === "}" || token === "]") {
        depth--;
        return (
          (tokens[i - 1] === (token === "}" ? "{" : "[") ? "" : newline()) +
          token
        );
      }
      if (token === ",") return token + newline();
      if (token === ":") return ": ";
      return token;
    })
    .join("");
}

export function TableCellEditor({
  anchor,
  column,
  json = false,
  required,
  initialValue,
  onStage,
  onClose,
}: {
  anchor: HTMLElement;
  column: string;
  json?: boolean;
  required: boolean;
  initialValue: string | null;
  onStage: (value: string | null) => void;
  onClose: () => void;
}) {
  const [formatted] = useState(() =>
    json && initialValue !== null
      ? indentJson(initialValue)
      : (initialValue ?? ""),
  );
  const [value, setValue] = useState(formatted);
  const [isNull, setNull] = useState(initialValue === null);
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverContent
        anchor={anchor}
        align="start"
        sideOffset={-32}
        className="w-[min(calc(100vw-24px),clamp(280px,var(--anchor-width),540px))] gap-0 p-0"
      >
        <PopoverTitle className="sr-only">Edit {column}</PopoverTitle>
        <form
          className="table-cell-form"
          onSubmit={(event) => {
            event.preventDefault();
            onStage(
              isNull
                ? null
                : value === formatted && initialValue !== null
                  ? initialValue
                  : value,
            );
          }}
        >
          <Textarea
            aria-label="Cell value"
            value={value}
            disabled={isNull}
            rows={json ? 8 : 4}
            className="field-sizing-fixed max-h-[42vh] resize-y rounded-b-none border-0"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.metaKey || event.ctrlKey) &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="table-cell-editor-actions">
            {!required && (
              <label className="table-cell-null">
                <Checkbox checked={isNull} onCheckedChange={setNull} /> Set to
                NULL
              </label>
            )}
            <span className="spacer" />
            <Button type="button" className="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="primary">
              Stage change
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

export function TableInlineEditor({
  initialValue,
  onStage,
  onClose,
  onOpenFull,
}: {
  initialValue: string;
  onStage: (value: string) => void;
  onClose: () => void;
  onOpenFull: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const finished = useRef(false);
  function finish(action: () => void) {
    if (finished.current) return;
    finished.current = true;
    action();
  }
  return (
    <div
      className="table-inline-editor"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          finish(() => onStage(value));
      }}
    >
      <Input
        aria-label="Cell value"
        autoFocus
        value={value}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter" || event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Escape") finish(onClose);
            else if (event.metaKey || event.ctrlKey)
              finish(() => onOpenFull(value));
            else finish(() => onStage(value));
          }
        }}
      />
      <Button
        type="button"
        size="icon-xs"
        className="quiet"
        aria-label="Open full cell editor"
        onClick={() => finish(() => onOpenFull(value))}
      >
        <Ellipsis size={13} aria-hidden="true" />
      </Button>
    </div>
  );
}
