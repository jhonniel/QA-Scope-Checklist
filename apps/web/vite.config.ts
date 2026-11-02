import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// React is the primary framework. Vue is compiled by the same build so that
// independently mounted Vue modules (see src/vue) share the design tokens,
// contracts and dev server without a second toolchain.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));
  // Production builds against a real API drop the in-memory mock (sample users, fixtures) from the bundle.
  const dropMock = command === "build" && Boolean(env.VITE_API_URL);

  return {
    plugins: [react({ exclude: [/\.vue$/] }), vue(), tailwindcss()],
    resolve: {
      alias: [
        ...(dropMock ? [{ find: /^@\/services\/mock\/mockApi$/, replacement: src("services/mock/mockApi.unavailable.ts") }] : []),
        { find: "@", replacement: src("") .replace(/[\\/]$/, "") },
      ],
    },
    server: {
      port: 5173,
      strictPort: false,
      // Same-origin `/api` in development so the session cookie needs no CORS setup.
      proxy: {
        "/api": {
          target: process.env.API_PROXY_TARGET ?? "http://localhost:4000",
          changeOrigin: false,
        },
      },
    },
    build: {
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-router"],
            motion: ["framer-motion"],
            vue: ["vue"],
          },
        },
      },
    },
  };
});
