import { createBrowserRouter } from "react-router";
import { AppShell } from "./layout/AppShell";
import { ErrorPage } from "./ErrorPage";
import { NotFoundPage } from "./NotFoundPage";
import { RedirectIfAuthenticated, RequireAdmin, RequireAuth } from "./guards";
import { DashboardPage } from "@/modules/dashboard/DashboardPage";
import { ProjectsPage } from "@/modules/projects/ProjectsPage";
import { ProjectPage } from "@/modules/projects/ProjectPage";
import { SectionPage } from "@/modules/checklist/SectionPage";
import { ActivityPage } from "@/modules/collaboration/ActivityPage";
import { InvitationsPage } from "@/modules/collaboration/InvitationsPage";
import { ProfilePage } from "@/modules/auth/ProfilePage";
import { LoginPage } from "@/modules/auth/LoginPage";
import { RegisterPage } from "@/modules/auth/RegisterPage";
import { ForgotPasswordPage } from "@/modules/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "@/modules/auth/ResetPasswordPage";
import { usingClerk } from "@/services/auth/externalAuth";

// The administration area is loaded on demand: regular users never download it.
const adminModule = () => import("@/modules/admin");

export const router = createBrowserRouter([
  {
    errorElement: <ErrorPage />,
    children: [
      {
        element: <RedirectIfAuthenticated />,
        children: [
          { index: true, element: <LoginPage /> },
          // `/*` so Clerk's multi-step sign-in/sign-up paths (factor-two, sso-callback, verify…) stay on these pages.
          { path: usingClerk ? "/login/*" : "/login", element: <LoginPage /> },
          { path: usingClerk ? "/register/*" : "/register", element: <RegisterPage /> },
          { path: "/forgot-password", element: <ForgotPasswordPage /> },
        ],
      },
      // Reachable while signed in too (someone may follow the e-mail link from an active session).
      { path: "/reset-password", element: <ResetPasswordPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: "dashboard", element: <DashboardPage /> },
              { path: "projects", element: <ProjectsPage /> },
              { path: "projects/:projectUuid", element: <ProjectPage /> },
              { path: "projects/:projectUuid/sections/:sectionUuid", element: <SectionPage /> },
              { path: "activity", element: <ActivityPage /> },
              { path: "invitations", element: <InvitationsPage /> },
              { path: "invitations/:token", element: <InvitationsPage /> },
              { path: "profile", element: <ProfilePage /> },
              {
                element: <RequireAdmin />,
                children: [
                  {
                    path: "admin",
                    lazy: async () => ({ Component: (await adminModule()).AdminLayout }),
                    children: [
                      { index: true, lazy: async () => ({ Component: (await adminModule()).AdminOverviewPage }) },
                      { path: "users", lazy: async () => ({ Component: (await adminModule()).AdminUsersPage }) },
                      { path: "projects", lazy: async () => ({ Component: (await adminModule()).AdminProjectsPage }) },
                      { path: "audit", lazy: async () => ({ Component: (await adminModule()).AdminAuditPage }) },
                      { path: "productivity", lazy: async () => ({ Component: (await adminModule()).AdminProductivityPage }) },
                      { path: "errors", lazy: async () => ({ Component: (await adminModule()).AdminErrorsPage }) },
                    ],
                  },
                ],
              },
              { path: "*", element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
]);
