import { create } from "zustand";
import { persist } from "zustand/middleware";
export type Preferences = {
  autoPreview: boolean;
  editorFontSize: 12 | 13 | 14 | 16;
  lineWrapping: boolean;
};
export const usePreferences = create<
  Preferences & { update: (values: Partial<Preferences>) => void }
>()(
  persist(
    (set) => ({
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
