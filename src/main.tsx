import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppearanceProvider, initializeAppearance } from "./appearance";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource/commit-mono/400.css";
import "@fontsource/commit-mono/500.css";
import "@fontsource/commit-mono/700.css";
import "./theme.css";
import "./styles.css";
import { TooltipProvider } from "./components/ui/tooltip";
initializeAppearance();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppearanceProvider>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </AppearanceProvider>
  </StrictMode>,
);
