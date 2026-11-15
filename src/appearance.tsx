import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { native } from "./api";
export type Appearance = "system" | "light" | "dark";
const key = "kasane.appearance";
function stored(): Appearance {
  try {
    const v = localStorage.getItem(key);
    return v === "dark" || v === "light" ? v : "system";
  } catch {
    return "system";
  }
}
export function initializeAppearance() {
  const choice = stored();
  document.documentElement.classList.toggle(
    "dark",
    choice === "dark" ||
      (choice === "system" &&
        matchMedia("(prefers-color-scheme: dark)").matches),
  );
  document.documentElement.style.colorScheme =
    document.documentElement.classList.contains("dark") ? "dark" : "light";
}
const Context = createContext<{
  appearance: Appearance;
  resolved: "dark" | "light";
  setAppearance: (v: Appearance) => void;
}>({ appearance: "system", resolved: "light", setAppearance: () => {} });
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setChoice] = useState<Appearance>(stored);
  const [resolved, setResolved] = useState<"dark" | "light">(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  useLayoutEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark =
        appearance === "dark" || (appearance === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
      setResolved(dark ? "dark" : "light");
    };
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
