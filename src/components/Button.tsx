import { Button as ShadcnButton } from "./ui/button";
import type { ComponentProps } from "react";
export function Button({
  className = "",
  ...props
}: ComponentProps<typeof ShadcnButton>) {
  const tokens = (typeof className === "string" ? className : "").split(/\s+/);
  return (
    <ShadcnButton
      variant={
        tokens.includes("danger")
          ? "destructive"
          : tokens.includes("primary")
            ? "default"
            : tokens.includes("quiet")
              ? "ghost"
              : tokens.includes("selected-view")
                ? "secondary"
                : "outline"
      }
      size={
        tokens.includes("icon")
          ? "icon-sm"
          : tokens.includes("small")
            ? "sm"
            : "default"
      }
      className={className}
      {...props}
    />
  );
}
