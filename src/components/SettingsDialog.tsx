import { usePreferences } from "../preferences";
import { SelectField } from "./SelectField";
import { Checkbox } from "./ui/checkbox";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { useAppearance, type Appearance } from "../appearance";
export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { appearance, setAppearance } = useAppearance();
  const preferences = usePreferences();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Preferences for this Mac.</DialogDescription>
        <section className="space-y-3 py-3">
          <h3 className="text-sm font-medium">Appearance</h3>
          <div
            role="radiogroup"
            aria-label="Appearance"
            className="grid grid-cols-3 gap-3"
          >
            {(
              [
                { value: "system", label: "System", icon: Monitor },
                { value: "light", label: "Light", icon: Sun },
                { value: "dark", label: "Dark", icon: Moon },
              ] as const
            ).map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                role="radio"
                aria-checked={appearance === value}
                onClick={() => setAppearance(value as Appearance)}
                className="flex flex-col items-center gap-3 rounded-lg border border-input p-4 text-sm text-muted-foreground outline-none hover:bg-accent aria-checked:border-primary aria-checked:bg-accent aria-checked:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon size={22} />
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            System follows your macOS appearance.
          </p>
        </section>
        <section className="settings-section">
          <h3>Table browsing</h3>
          <label className="settings-row">
            <div>
              <strong>Load table data on open</strong>
              <p>Turn off to fetch only when you click Refresh.</p>
            </div>
            <Checkbox
              checked={preferences.autoPreview}
              onCheckedChange={(autoPreview) =>
                preferences.update({ autoPreview })
              }
            />
          </label>
        </section>
        <section className="settings-section">
          <h3>SQL editor</h3>
          <div className="settings-row">
            <div>
              <strong>Font size</strong>
              <p>Applies to queries and notebook SQL cells.</p>
            </div>
            <SelectField
              label="Editor font size"
              value={String(preferences.editorFontSize)}
              options={[12, 13, 14, 16].map((n) => ({
                value: String(n),
                label: `${n} px`,
              }))}
              onChange={(value) =>
                preferences.update({
                  editorFontSize: Number(value) as 12 | 13 | 14 | 16,
                })
              }
            />
          </div>
          <label className="settings-row">
            <div>
              <strong>Wrap long lines</strong>
              <p>Keep SQL within the editor width.</p>
            </div>
            <Checkbox
              checked={preferences.lineWrapping}
              onCheckedChange={(lineWrapping) =>
                preferences.update({ lineWrapping })
              }
            />
          </label>
        </section>
      </DialogContent>
    </Dialog>
  );
}
