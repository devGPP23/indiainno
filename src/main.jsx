import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "./contexts/AuthContext";
import { LanguageProvider } from "./contexts/LanguageContext";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <LanguageProvider>
          <App />
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: "#ffffff",
                color: "#1e293b",
                border: "1px solid #cbd5e1",
                borderRadius: "4px",
                fontSize: "14px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.12)"
              },
              success: { iconTheme: { primary: "#16a34a", secondary: "#fff" } },
              error: { iconTheme: { primary: "#dc2626", secondary: "#fff" } },
            }}
          />
        </LanguageProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
