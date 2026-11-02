import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import express, { type Express } from "express";

/**
 * Optional single-process deployment: serve the built web app (`apps/web/dist`)
 * from the API so one container answers both `/api/*` and the SPA routes.
 *
 * - Hashed assets under `/assets` are immutable and cached for a year.
 * - Everything else that is not `/api` falls back to `index.html` (client-side
 *   routing) with `no-store` and a strict Content-Security-Policy.
 * - When the web app is hosted elsewhere (CDN, nginx) leave `WEB_DIST` unset.
 */
export function serveWebApp(app: Express, distDir: string): void {
  const dir = resolve(distDir);
  const index = join(dir, "index.html");
  if (!existsSync(index) || !statSync(dir).isDirectory()) {
    throw new Error(`WEB_DIST points at "${dir}" but no index.html was found there. Run "npm run build" first.`);
  }

  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // Tailwind runtime tokens and Framer Motion inline styles
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  // The API-wide `Cache-Control: no-store` is overridden here: hashed assets are immutable, other files briefly cacheable.
  const cache = (value: string) => (res: express.Response) => res.setHeader("Cache-Control", value);
  app.use("/assets", express.static(join(dir, "assets"), { index: false, fallthrough: true, setHeaders: cache("public, max-age=31536000, immutable") }));
  app.use(express.static(dir, { index: false, fallthrough: true, setHeaders: cache("public, max-age=3600") }));
  app.get(/^(?!\/api(\/|$)).*/, (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    // Serve the shell for navigations (browsers send text/html) and bare probes (no Accept or */*);
    // requests for a missing file with an extension, or for JSON only, still get a 404.
    const accept = req.headers.accept ?? "*/*";
    const wantsHtml = accept.includes("text/html") || accept.includes("*/*");
    if (!wantsHtml || /\.[a-z0-9]{1,8}$/i.test(req.path)) return next();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", csp);
    res.sendFile(index);
  });
}
