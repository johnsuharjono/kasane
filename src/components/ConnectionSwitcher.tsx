import {
  Check,
  ChevronDown,
  Database,
  Plus,
  RefreshCw,
  Settings2,
  Unplug,
} from "lucide-react";
import { Button } from "./Button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";
import type { Connection } from "../types";

export function ConnectionSwitcher({
  connections,
  selected,
  connected,
  connecting,
  busy,
  onSelect,
  onAdd,
  onEdit,
  onConnect,
  onDisconnect,
}: {
  connections: Connection[];
  selected: string;
  connected: boolean;
  connecting: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onEdit: (connection: Connection) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const active = connections.find((c) => c.id === selected);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            className="connection-switcher"
            aria-label="Switch connection"
          />
        }
      >
        <Database size={17} />
        <span className="connection-switcher-label">
          <strong>{active?.name ?? "Choose a connection"}</strong>
          <small>
            {connecting
              ? "Connecting…"
              : active
                ? `${active.database} · ${connected ? "Connected" : "Disconnected"}`
                : "PostgreSQL"}
          </small>
        </span>
        <ChevronDown size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-64" align="start">
        {connections.map((c) => (
          <DropdownMenuItem
            key={c.id}
            onClick={() => onSelect(c.id)}
            aria-label={`Switch to ${c.name}`}
          >
            <Database size={15} />
            <span className="connection-menu-label">
              <strong>{c.name}</strong>
              <small>
                {c.database} · {c.host}:{c.port}
              </small>
            </span>
            {selected === c.id && <Check size={14} className="ml-auto" />}
          </DropdownMenuItem>
        ))}
        {connections.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={onAdd}>
          <Plus size={15} />
          New connection…
        </DropdownMenuItem>
        {active && (
          <>
            <DropdownMenuItem disabled={busy} onClick={() => onEdit(active)}>
              <Settings2 size={15} />
              Edit connection…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onConnect} disabled={connecting}>
              <RefreshCw size={15} />
              {connected ? "Refresh schema" : "Connect"}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={busy || (!connected && !connecting)}
              onClick={onDisconnect}
            >
              <Unplug size={15} />
              Disconnect
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
