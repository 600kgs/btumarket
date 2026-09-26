import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./lib/i18n";
import "./style.css";
import "./detail-pages.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
