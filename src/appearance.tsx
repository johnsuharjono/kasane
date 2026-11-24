import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Monitor, Moon, Sun } from "lucide-react";
import { native } from "./api";
import { usePreferences, type AppPalette } from "./preferences";

export const appearanceOptions = {
  system: { value: "system", label: "System", icon: Monitor },
  light: { value: "light", label: "Light", icon: Sun },
  dark: { value: "dark", label: "Dark", icon: Moon },
} as const;

export type Appearance = keyof typeof appearanceOptions;
const key = "kasane.appearance";
function stored(): Appearance {
  try {
    const v = localStorage.getItem(key);
    return v === "dark" || v === "light" ? v : "system";
  } catch {
    return "system";
  }
}
const systemDark = "(prefers-color-scheme: dark)";

function applyScheme(appearance: Appearance, prefersDark: boolean) {
  const dark =
    appearance === "dark" || (appearance === "system" && prefersDark);
  const scheme = dark ? "dark" : "light";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = scheme;
  return scheme;
}

function applyPalette(appPalette: AppPalette) {
  document.documentElement.dataset.palette = appPalette;
}

export function initializeAppearance() {
  applyScheme(stored(), matchMedia(systemDark).matches);
  applyPalette(usePreferences.getState().appPalette);
}
const Context = createContext<{
  appearance: Appearance;
  resolved: "dark" | "light";
  setAppearance: (v: Appearance) => void;
}>({ appearance: "system", resolved: "light", setAppearance: () => {} });
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setChoice] = useState<Appearance>(stored);
  const appPalette = usePreferences((state) => state.appPalette);
  const [resolved, setResolved] = useState<"dark" | "light">(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  useLayoutEffect(() => {
    const media = matchMedia(systemDark);
    const apply = () => setResolved(applyScheme(appearance, media.matches));
    apply();
    media.addEventListener("change", apply);
    if (native)
      void getCurrentWindow()
        .setTheme(appearance === "system" ? null : appearance)
        .catch((e) =>
          console.warn("Could not set native window appearance", e),
        );
    return () => media.removeEventListener("change", apply);
  }, [appearance]);
  useLayoutEffect(() => {
    applyPalette(appPalette);
  }, [appPalette]);
  return (
    <Context.Provider
      value={{
        appearance,
        resolved,
        setAppearance: (v) => {
          try {
            localStorage.setItem(key, v);
          } catch {
            /* Still apply for this session. */
          }
          setChoice(v);
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useAppearance = () => useContext(Context);
