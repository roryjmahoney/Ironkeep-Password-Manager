import "@fontsource-variable/manrope";
import "@fontsource-variable/newsreader";
import { App } from "@ironkeep/extension-ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Ironkeep popup root is missing");
createRoot(root).render(<StrictMode><App /></StrictMode>);
