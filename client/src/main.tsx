import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

window.addEventListener("unhandledrejection", (event) => {
  const stack = event.reason?.stack || event.reason?.message || String(event.reason);
  if (stack.includes("chrome-extension://") || stack.includes("moz-extension://") || stack.includes("MetaMask") || stack.includes("ethereum")) {
    event.preventDefault();
  }
});

window.addEventListener("error", (event) => {
  const src = (event.filename || "");
  if (src.includes("chrome-extension://") || src.includes("moz-extension://")) {
    event.preventDefault();
  }
});

createRoot(document.getElementById("root")!).render(<App />);
