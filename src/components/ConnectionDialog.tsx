import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Input } from "./ui/input";
import {
  Check,
  Plus,
  ShieldCheck,
  X,
  CircleAlert,
  LoaderCircle,
} from "lucide-react";
import { Button } from "./Button";
import { api } from "../api";
import {
  asError,
  tlsModeOf,
  uid,
  type Connection,
  type ConnectionTest,
  type TlsMode,
} from "../types";
import {
  CONNECTION_COLORS,
  connectionColor,
  initials,
} from "../connection-colors";

const tlsOptions: { value: TlsMode; label: string; hint: string }[] = [
  {
    value: "disable",
    label: "Disabled",
    hint: "No encryption. Local databases only.",
  },
  {
    value: "require",
    label: "Require",
    hint: "Encrypted, but the server certificate is not checked.",
  },
  {
    value: "verify-full",
    label: "Verify certificate",
    hint: "Encrypted, and the certificate must match the host.",
  },
];
const blank = (): Connection => ({
  id: uid(),
  name: "Local playground",
  host: "127.0.0.1",
  port: 55432,
  database: "kasane_dev",
  username: "kasane",
  tls: false,
  tlsMode: "disable",
});

/** Two-pane manager: saved connections on the left, the selected one's settings on the right. */
export function ConnectionDialog({
  open,
  onOpenChange,
  connections,
  initialId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connections: Connection[];
  /** Connection to show first; undefined starts a new one. */
  initialId?: string;
  /** Called after a save (with its id) or a delete (without). */
  onSaved: (id?: string, edited?: string) => void;
}) {
  const [selected, setSelected] = useState<string | undefined>(initialId);
  const [busy, setBusy] = useState(false);
  const current = connections.find((c) => c.id === selected);
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) onOpenChange(v);
      }}
    >
      <DialogContent
        className="connections-dialog flex gap-0 p-0 sm:max-w-[880px]"
        showCloseButton={false}
      >
        <div className="connections-list">
          <div className="connections-list-heading">
            <DialogTitle className="text-[22px] leading-tight">
              Connections
            </DialogTitle>
            <DialogDescription>
              Each one is its own workspace.
            </DialogDescription>
          </div>
          <div
            className="connections-items"
            role="listbox"
            aria-label="Saved connections"
          >
            {connections.map((c) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={c.id === selected}
                disabled={busy}
                onClick={() => setSelected(c.id)}
              >
                <span
                  className="connection-mark"
                  style={{ background: connectionColor(c) }}
                  aria-hidden="true"
                >
                  {initials(c.name)}
                </span>
                <span className="connections-item-label">
                  <strong>{c.name}</strong>
                  <small>
                    {c.host}:{c.port}/{c.database}
                  </small>
                </span>
              </button>
            ))}
            {selected === undefined && (
              <button
                type="button"
                role="option"
                aria-selected
                className="draft"
              >
                <span className="connection-mark draft-mark" aria-hidden="true">
                  <Plus size={14} />
                </span>
                <span className="connections-item-label">
                  <strong>New connection</strong>
                  <small>Not saved yet</small>
                </span>
              </button>
            )}
          </div>
          <div className="connections-list-footer">
            <Button
              className="add-connection"
              disabled={busy || selected === undefined}
              onClick={() => setSelected(undefined)}
            >
              <Plus size={14} />
              New connection
            </Button>
          </div>
        </div>
        <ConnectionEditor
          key={selected ?? "new"}
          initial={current}
          busy={busy}
          setBusy={setBusy}
          onClose={() => onOpenChange(false)}
          onSaved={(id) => {
            onSaved(id, current?.id);
            onOpenChange(false);
          }}
          onDeleted={() => {
            onSaved(undefined, selected);
            setSelected(connections.find((c) => c.id !== selected)?.id);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ConnectionEditor({
  initial,
  busy,
  setBusy,
  onClose,
  onSaved,
  onDeleted,
}: {
  initial?: Connection;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onClose: () => void;
  onSaved: (id: string) => void;
  onDeleted: () => void;
}) {
  const [form, setForm] = useState<Connection>(() =>
    initial ? { ...initial, tlsMode: tlsModeOf(initial) } : blank(),
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [test, setTest] = useState<
    | { state: "running" }
    | { state: "ok"; result: ConnectionTest; key: string }
    | { state: "failed"; message: string; key: string }
  >();
  const mode = tlsModeOf(form);
  const formKey = JSON.stringify([form, password]);
  const update = (patch: Partial<Connection>) => setForm({ ...form, ...patch });
  // Keep the legacy flag meaningful for older builds reading connections.json.
  const toSave = (): Connection => ({ ...form, tls: mode !== "disable" });
  async function runTest() {
    setTest({ state: "running" });
    try {
      const result = await api.testConnection(toSave(), password || undefined);
      setTest({ state: "ok", result, key: formKey });
    } catch (e) {
      setTest({ state: "failed", message: asError(e).message, key: formKey });
    }
  }
  const stale = !!test && test.state !== "running" && test.key !== formKey;
  return (
    <form
      className="connection-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await api.saveConnection(
            toSave(),
            initial && !password ? undefined : password,
          );
          onSaved(form.id);
        } catch (e) {
          setError(asError(e).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="connection-editor-heading">
        <span
          className="connection-mark large"
          style={{ background: connectionColor(form) }}
          aria-hidden="true"
        >
          {form.name.trim() ? initials(form.name) : <Plus size={18} />}
        </span>
        <div>
          <strong>{form.name.trim() || "New connection"}</strong>
          <small>
            <ShieldCheck size={12} aria-hidden="true" />
            Password stored in macOS Keychain
          </small>
        </div>
        <span className="spacer" />
        <Button
          className="quiet icon"
          aria-label="Close connection dialog"
          disabled={busy}
          onClick={onClose}
        >
          <X size={16} />
        </Button>
      </div>
      <div className="connection-editor-body">
        <label>
          Connection name
          <Input
            required
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        </label>
        <fieldset className="swatch-field">
          <legend>Color</legend>
          <div className="swatches" role="radiogroup" aria-label="Color">
            {CONNECTION_COLORS.map((c) => {
              const checked = (form.color ?? "gray") === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-label={c.label}
                  title={c.label}
                  className="swatch"
                  style={{ background: connectionColor({ color: c.id }) }}
                  onClick={() => update({ color: c.id })}
                >
                  {checked && <Check size={13} strokeWidth={3} />}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="form-row">
          <label>
            Host
            <Input
              required
              value={form.host}
              onChange={(e) => update({ host: e.target.value })}
            />
          </label>
          <label className="port-field">
            Port
            <Input
              type="number"
              min="1"
              max="65535"
              required
              value={form.port}
              onChange={(e) => update({ port: Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="form-row three">
          <label>
            Database
            <Input
              required
              value={form.database}
              onChange={(e) => update({ database: e.target.value })}
            />
          </label>
          <label>
            Username
            <Input
              required
              value={form.username}
              onChange={(e) => update({ username: e.target.value })}
            />
          </label>
          <label>
            Password
            <Input
              type="password"
              autoComplete="off"
              placeholder={initial ? "Unchanged" : "Database password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        </div>
        <fieldset className="tls-field">
          <legend>TLS</legend>
          <div className="segmented" role="radiogroup" aria-label="TLS">
            {tlsOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={mode === o.value}
                onClick={() => update({ tlsMode: o.value })}
              >
                {o.label}
              </button>
            ))}
          </div>
          <small>{tlsOptions.find((o) => o.value === mode)!.hint}</small>
        </fieldset>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="connection-editor-footer">
        <Button
          disabled={busy || test?.state === "running"}
          onClick={() => void runTest()}
        >
          {test?.state === "running" && (
            <LoaderCircle size={14} className="animate-spin" />
          )}
          Test connection
        </Button>
        <span
          className={`test-result ${stale ? "" : (test?.state ?? "")}`}
          role="status"
        >
          {stale ? (
            "Not tested since last edit"
          ) : !test ? null : test.state === "running" ? (
            "Connecting…"
          ) : test.state === "ok" ? (
            <>
              <Check size={13} aria-hidden="true" />
              Connected · PostgreSQL {
                test.result.serverVersion.split(" ")[0]
              } · {Math.round(test.result.durationMs)} ms
            </>
          ) : (
            <>
              <CircleAlert size={13} aria-hidden="true" />
              {test.message}
            </>
          )}
        </span>
        <span className="spacer" />
        {initial && (
          <Button
            className="quiet delete-connection"
            disabled={busy}
            onBlur={() => setConfirmDelete(false)}
            onClick={async () => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              setBusy(true);
              try {
                await api.deleteConnection(initial.id);
                onDeleted();
              } catch (e) {
                setError(asError(e).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmDelete ? "Confirm delete" : "Delete"}
          </Button>
        )}
        <Button className="primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save connection"}
        </Button>
      </div>
    </form>
  );
}
