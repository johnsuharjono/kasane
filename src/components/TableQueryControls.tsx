import { ArrowDownUp, Filter, Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { uid, type TableFilter, type TableSettings } from "../types";
import { Button } from "./Button";
import { SelectField } from "./SelectField";
import { Input } from "./ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "./ui/popover";

const filterOperators = [
  { value: "contains", label: "contains" },
  { value: "equals", label: "equals" },
  { value: "is-null", label: "is null" },
];
const directions = [
  { value: "asc", label: "Ascending" },
  { value: "desc", label: "Descending" },
];
const newFilter = () => ({
  id: uid(),
  column: "",
  operator: "contains" as const,
  value: "",
});
type QueryControls = {
  columns: { value: string; label: string }[];
  disabled: boolean;
};

export function TableFilterControl({
  columns,
  disabled,
  filters,
  onApply,
}: QueryControls & {
  filters: TableFilter[];
  onApply: (filters: TableFilter[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const popup = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<(TableFilter & { id: string })[]>([]);
  function update(id: string, change: Partial<TableFilter>) {
    setDraft((current) =>
      current.map((filter) =>
        filter.id === id ? { ...filter, ...change } : filter,
      ),
    );
  }
  const valid = draft.every(
    ({ column, operator, value }) =>
      column && (operator !== "contains" || value !== ""),
  );
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraft(
            filters.length
              ? filters.map((filter) => ({ ...filter, id: uid() }))
              : [newFilter()],
          );
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <Button size="sm" aria-label="Filter rows" disabled={disabled} />
        }
      >
        <Filter size={14} aria-hidden="true" />
        Filter{" "}
        {filters.length > 0 && (
          <span className="filter-count">{filters.length}</span>
        )}
      </PopoverTrigger>
      <PopoverContent
        ref={popup}
        align="start"
        sideOffset={6}
        className="w-[min(34rem,var(--available-width))] gap-0 p-0"
      >
        <form
          className="table-query-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || disabled) return;
            onApply(
              draft.map(({ column, operator, value }) => ({
                column,
                operator,
                value,
              })),
            );
            setOpen(false);
          }}
        >
          <PopoverTitle className="table-query-heading">
            Filter rows
          </PopoverTitle>
          <div className="table-query-fields">
            {draft.map(({ id, column, operator, value }, index) => (
              <div className="table-filter-row" key={id}>
                {index > 0 && <span className="table-filter-and">AND</span>}
                <SelectField
                  portalContainer={popup}
                  label="Filter column"
                  className="w-full min-w-0"
                  value={column}
                  options={columns}
                  onChange={(column) => update(id, { column })}
                />
                <SelectField
                  portalContainer={popup}
                  label="Filter operator"
                  className="w-full min-w-0"
                  disabled={!column}
                  value={operator}
                  options={filterOperators}
                  onChange={(operator) =>
                    update(id, {
                      operator: operator as TableFilter["operator"],
                    })
                  }
                />
                {operator !== "is-null" ? (
                  <Input
                    aria-label="Filter value"
                    placeholder="Value"
                    value={value}
                    disabled={!column}
                    onChange={(event) =>
                      update(id, { value: event.target.value })
                    }
                  />
                ) : (
                  <span />
                )}
                <Button
                  type="button"
                  className="quiet icon"
                  aria-label={`Remove filter ${index + 1}`}
                  onClick={() =>
                    setDraft((current) =>
                      current.filter((filter) => filter.id !== id),
                    )
                  }
                >
                  <X size={14} aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
          <div className="table-query-actions">
            <Button
              type="button"
              size="sm"
              onClick={() => setDraft((current) => [...current, newFilter()])}
            >
              <Plus size={14} aria-hidden="true" /> Add filter
            </Button>
            <span className="spacer" />
            <Button
              type="button"
              className="quiet small"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="primary small"
              disabled={!valid || disabled}
            >
              Apply
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

export function TableSortControl({
  columns,
  disabled,
  sort,
  onApply,
}: QueryControls & {
  sort: TableSettings["sort"];
  onApply: (sort: TableSettings["sort"]) => void;
}) {
  const [open, setOpen] = useState(false);
  const popup = useRef<HTMLDivElement>(null);
  const [column, setColumn] = useState("");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setColumn(sort?.column ?? "");
          setDirection(sort?.direction ?? "asc");
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={<Button size="sm" aria-label="Sort rows" disabled={disabled} />}
      >
        <ArrowDownUp size={14} aria-hidden="true" />
        Sort {sort && <span className="filter-count">1</span>}
      </PopoverTrigger>
      <PopoverContent
        ref={popup}
        align="start"
        sideOffset={6}
        className="w-[min(24rem,var(--available-width))] gap-0 p-0"
      >
        <form
          className="table-query-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled) return;
            onApply(column ? { column, direction } : undefined);
            setOpen(false);
          }}
        >
          <PopoverTitle className="table-query-heading">Sort rows</PopoverTitle>
          <div className="table-query-fields">
            <div className="table-sort-row">
              <SelectField
                portalContainer={popup}
                label="Sort column"
                className="w-full min-w-0"
                value={column}
                options={columns}
                onChange={setColumn}
              />
              <SelectField
                portalContainer={popup}
                label="Sort direction"
                className="w-full min-w-0"
                value={direction}
                options={directions}
                disabled={!column}
                onChange={(value) =>
                  setDirection(value === "desc" ? "desc" : "asc")
                }
              />
            </div>
          </div>
          <div className="table-query-actions">
            {sort && (
              <Button
                type="button"
                className="quiet small"
                disabled={disabled}
                onClick={() => {
                  onApply(undefined);
                  setOpen(false);
                }}
              >
                Clear sort
              </Button>
            )}
            <span className="spacer" />
            <Button
              type="button"
              className="quiet small"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="primary small"
              disabled={!column || disabled}
            >
              Apply
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
