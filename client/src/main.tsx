import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installDemoMode } from "./lib/demoMode";

if (import.meta.env.VITE_DEMO_MODE === "true") {
  installDemoMode();
}

createRoot(document.getElementById("root")!).render(<App />);
