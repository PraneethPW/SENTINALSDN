import React from "react";
import ReactDOM from "react-dom/client";
import Root from "./Root";
import {AppBoundary} from "./components/AppBoundary";
import { MotionProvider } from "./motionPreference";
import "./styles.css";
import "./entry.css";
import "./research.css";
import "./cinematic.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppBoundary><MotionProvider><Root /></MotionProvider></AppBoundary>
  </React.StrictMode>,
);
