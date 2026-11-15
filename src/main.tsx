import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppearanceProvider, initializeAppearance } from "./appearance";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/newsreader";
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
