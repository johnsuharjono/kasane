import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { X, Database, ShieldCheck, Check } from "lucide-react";
import { Button } from "./Button";
import { api } from "../api";
import { asError, uid, type Connection } from "../types";
import {
  CONNECTION_COLORS,
  connectionColor,
  initials,
} from "../connection-colors";
export function ConnectionDialog({
  open,
  onOpenChange,
  onSaved,
  initial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: (id?: string) => void;
  initial?: Connection;
}) {
  const [form, setForm] = useState<Connection>(
    initial ?? {
      id: uid(),
      name: "Local playground",
      host: "127.0.0.1",
      port: 55432,
      database: "kasane_dev",
      username: "kasane",
      tls: false,
    },
  );
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) onOpenChange(v);
      }}
    >
      <DialogContent
        className="dialog-popup sm:max-w-[450px]"
        showCloseButton={false}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api.saveConnection(
                form,
                initial && !password ? undefined : password,
              );
              onSaved(form.id);
              onOpenChange(false);
            } catch (e) {
              setError(asError(e).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="dialog-heading">
            <div
              className="dialog-symbol connection-mark"
              style={{ background: connectionColor(form) }}
              aria-hidden="true"
            >
              {form.name.trim() ? initials(form.name) : <Database size={20} />}
            </div>
            <DialogClose
              render={
                <Button
                  className="quiet icon"
                  aria-label="Close connection dialog"
                  disabled={busy}
                />
              }
            >
              <X size={16} />
            </DialogClose>
          </div>
          <DialogTitle>
            {initial ? "Edit connection" : "A new connection"}
          </DialogTitle>
          <DialogDescription>PostgreSQL connection settings.</DialogDescription>
          <label>
            Connection name
            <Input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
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
                    onClick={() => setForm({ ...form, color: c.id })}
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
                onChange={(e) => setForm({ ...form, host: e.target.value })}
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
                onChange={(e) =>
                  setForm({ ...form, port: Number(e.target.value) })
                }
              />
            </label>
          </div>
          <label>
            Database
            <Input
              required
              value={form.database}
              onChange={(e) => setForm({ ...form, database: e.target.value })}
            />
          </label>
          <div className="form-row">
            <label>
              Username
              <Input
                required
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
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
          <label className="checkbox-label">
            <Checkbox
              checked={form.tls}
              onCheckedChange={(checked) => setForm({ ...form, tls: checked })}
            />
            Require TLS and verify server certificate
          </label>
          <div className="keychain-note">
            <ShieldCheck size={15} />
            Password stored in macOS Keychain.
          </div>
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          <div className="dialog-footer">
            {initial && (
              <Button
                className="danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.deleteConnection(initial.id);
                    onSaved();
                    onOpenChange(false);
                  } catch (e) {
                    setError(asError(e).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Delete connection
              </Button>
            )}
            <DialogClose render={<Button disabled={busy} />}>
              Cancel
            </DialogClose>
            <Button className="primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save connection"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
