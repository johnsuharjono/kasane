import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { appPalettes, usePreferences } from "../preferences";
import { SelectField } from "./SelectField";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { appearanceOptions, useAppearance } from "../appearance";

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
        <section className="settings-section space-y-4">
          <div>
            <h3 id="settings-color-scheme">Color scheme</h3>
            <RadioGroup
              aria-labelledby="settings-color-scheme"
              className="grid grid-cols-3 gap-2"
              value={appearance}
              onValueChange={setAppearance}
            >
              {Object.values(appearanceOptions).map(
                ({ value, label, icon: Icon }) => (
                  <Radio.Root
                    key={value}
                    value={value}
                    className="appearance-option flex items-center justify-center gap-1.5 p-2"
                  >
                    <Icon size={15} aria-hidden="true" />
                    {label}
                  </Radio.Root>
                ),
              )}
            </RadioGroup>
          </div>
          <div>
            <h3 id="settings-app-theme">App theme</h3>
            <RadioGroup
              aria-labelledby="settings-app-theme"
              className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              value={preferences.appPalette}
              onValueChange={(appPalette) => preferences.update({ appPalette })}
            >
              {appPalettes.map(({ value, label }) => (
                <Radio.Root
                  key={value}
                  value={value}
                  className="appearance-option grid gap-2 p-2"
                >
                  <span className="grid grid-cols-2 gap-1" aria-hidden="true">
                    <span className="palette-sample" data-palette={value} />
                    <span
                      className="palette-sample palette-sample--dark"
                      data-palette={value}
                    />
                  </span>
                  <span className="px-1">{label}</span>
                </Radio.Root>
              ))}
            </RadioGroup>
          </div>
        </section>
        <section className="settings-section">
          <h3>SQL editor</h3>
          <div className="settings-row">
            <div>
              <strong>Font size</strong>
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
      </DialogContent>
    </Dialog>
  );
}
