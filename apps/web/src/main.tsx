import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { MotionConfig } from "framer-motion";
import "@fontsource-variable/inter";
import "@/design-system/tokens.css";
import { router } from "@/app/router";
import { AuthProviderRoot } from "@/app/AuthProviderRoot";
import { installGlobalErrorReporting } from "@/lib/errorReporting";

// Crashes outside React's render tree are reported to the admin error log too.
installGlobalErrorReporting();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* `reducedMotion="user"` makes every Framer Motion animation honour the OS setting. */}
    <MotionConfig reducedMotion="user">
      {/* Clerk's provider when configured; otherwise a pass-through. */}
      <AuthProviderRoot>
        <RouterProvider router={router} />
      </AuthProviderRoot>
    </MotionConfig>
  </StrictMode>,
);
