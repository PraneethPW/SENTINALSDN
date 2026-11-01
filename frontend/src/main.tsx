import React from "react";
import ReactDOM from "react-dom/client";
import Root from "./Root";
import {AppBoundary} from "./components/AppBoundary";
import "./styles.css";
import "./landing.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppBoundary><Root /></AppBoundary>
  </React.StrictMode>,
);
