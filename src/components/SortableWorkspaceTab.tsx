import { useSortable } from "@dnd-kit/sortable";
import { X } from "lucide-react";
import type { PropsWithChildren } from "react";
import { Button } from "./Button";

type Props = PropsWithChildren<{
  id: string;
  title: string;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
  onMove: (direction: -1 | 1) => void;
}>;

export function SortableWorkspaceTab({
  id,
  title,
  active,
  onActivate,
  onClose,
  onMove,
  children,
}: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    isDragging,
    transform,
    transition,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      data-tab-id={id}
      data-dragging={isDragging || undefined}
      className={`tab ${active ? "active" : ""}`}
      style={{
        transform: transform ? `translateX(${transform.x}px)` : undefined,
        transition,
      }}
    >
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
        onClick={onActivate}
        onKeyDown={(event) => {
          if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
            return;
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          onMove(event.key === "ArrowLeft" ? -1 : 1);
        }}
      >
        {children}
      </button>
      <Button
        className="quiet icon"
        aria-label={`Close ${title}`}
        onClick={onClose}
      >
        <X size={12} />
      </Button>
    </div>
  );
}
