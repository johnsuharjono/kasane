import type { Connection, ConnectionColor } from "./types";

/** Fixed swatches. Colors carry no meaning; the user picks what each one represents. */
export const CONNECTION_COLORS: { id: ConnectionColor; label: string }[] = [
  { id: "gray", label: "Gray" },
  { id: "blue", label: "Blue" },
  { id: "teal", label: "Teal" },
  { id: "green", label: "Green" },
  { id: "amber", label: "Amber" },
  { id: "orange", label: "Orange" },
  { id: "rose", label: "Rose" },
  { id: "violet", label: "Violet" },
];

export const connectionColor = (c?: Pick<Connection, "color">) =>
  `var(--connection-${c?.color ?? "gray"})`;

export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? words[0][0] + words[1][0]
      : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}
