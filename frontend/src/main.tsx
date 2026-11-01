import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import {AppBoundary} from "./components/AppBoundary";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppBoundary><App /></AppBoundary>
  </React.StrictMode>,
);
