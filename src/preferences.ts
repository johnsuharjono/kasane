import { create } from "zustand";
import { persist } from "zustand/middleware";

export const appPalettes = [
  { value: "kasane", label: "Kasane" },
  { value: "moss", label: "Moss" },
  { value: "dusk", label: "Dusk" },
  { value: "mono", label: "Mono" },
] as const;
export type AppPalette = (typeof appPalettes)[number]["value"];

export type Preferences = {
  appPalette: AppPalette;
  autoPreview: boolean;
  editorFontSize: 12 | 13 | 14 | 16;
  lineWrapping: boolean;
};
export const usePreferences = create<
  Preferences & { update: (values: Partial<Preferences>) => void }
>()(
  persist(
    (set) => ({
      appPalette: "kasane",
      autoPreview: true,
      editorFontSize: 13,
      lineWrapping: false,
      update: (values) => set(values),
    }),
    {
      name: "kasane.preferences",
      version: 1,
      merge: (persisted, current) => {
        const value = persisted as Partial<Preferences> | undefined;
        return {
          ...current,
          appPalette:
            appPalettes.find(({ value: id }) => id === value?.appPalette)
              ?.value ?? current.appPalette,
          autoPreview:
            typeof value?.autoPreview === "boolean" ? value.autoPreview : true,
          editorFontSize: [12, 13, 14, 16].includes(value?.editorFontSize ?? 0)
            ? value!.editorFontSize!
            : 13,
          lineWrapping: value?.lineWrapping === true,
        };
      },
    },
  ),
);
