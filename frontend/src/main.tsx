import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/App";
import "@/index.css";

const container = document.getElementById("root");
if (!container) {
  // index.html is ours; a missing #root means the build is broken, and failing
  // loudly here beats a silently blank page.
  throw new Error('Root element "#root" was not found in the document.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
