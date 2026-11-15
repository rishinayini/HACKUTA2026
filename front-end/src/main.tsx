import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Widget from "./Widget";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).has("widget") ? <Widget /> : <App />}
  </React.StrictMode>,
);
