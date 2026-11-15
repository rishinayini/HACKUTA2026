import { defineConfig, type HtmlTagDescriptor, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import type { ServerResponse } from "node:http";

import siteConfiguration from "./.figma/make/site.json";

// Vite config — https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // .figma/make/deploy-preview passes `--mode development` for cached-preview builds.
  const emitSourcemaps = mode === "development";

  return {
    base: process.env.FIGMA_PUBLIC_URL ? `${process.env.FIGMA_PUBLIC_URL}/` : "/",
    build: {
      sourcemap: emitSourcemaps ? "inline" : false,
      minify: !emitSourcemaps,
    },
    plugins: [
      react(),
      tailwindcss(),
      figmaSiteConfiguration(siteConfiguration),
      figmaErrorOverlayReplay(),
      figmaReactRefreshBoundaryFallback(),
      figmaMakeKitPlugin({ storiesGlob: "/src/**/*.stories.{ts,tsx,js,jsx}" }),
      figmaLinkedPackageSourcemaps(),
      callEvents(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: process.env.FIGMA_DEV_SERVER_HOST || "0.0.0.0",
      port: parseInt(process.env.PORT || "8443"),
      strictPort: true,
      watch: {
        ignored: ["**/.figma/**"],
      },
    },
    preview: {
      host: process.env.FIGMA_DEV_SERVER_HOST || "0.0.0.0",
      port: parseInt(process.env.PORT || "8443"),
    },
  };
});

type FigmaSiteConfiguration = {
  title?: string;
  description?: string;
  language?: string;
  robots?: {
    index?: boolean;
  };
  icons?: {
    icon?: string;
  };
  openGraph?: {
    image?: string;
  };
  analytics?: {
    googleAnalyticsId?: string;
  };
  customScripts?: {
    headStart?: string;
    headEnd?: string;
    bodyStart?: string;
    bodyEnd?: string;
  };
  accessibility?: {
    addBypassLinks?: boolean;
  };
};

/** Applies /.figma/make/site.json to the generated document shell. */
function figmaSiteConfiguration(config: FigmaSiteConfiguration): Plugin {
  function sanitizeHtmlValue(value: string | undefined): string {
    return value?.replace(/[^a-zA-Z0-9_-]/g, "") || "";
  }
  function escapeHtmlText(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function replaceHtmlCommentSlot(html: string, slotName: string, content: string): string {
    return html.replace(`<!-- ${slotName} -->`, content);
  }

  const title = config.title ?? "Figma Make App";
  const description = config.description ?? "";
  // Imported HTML keeps its own favicon. New Makes use PNG because Google Search does not
  // support SVG favicons, even though browsers do.
  const favicon = config.icons?.icon ?? "/favicon.png";
  const socialImage = config.openGraph?.image ?? "";
  const language = sanitizeHtmlValue(config.language) || "en";
  const googleAnalyticsId = sanitizeHtmlValue(config.analytics?.googleAnalyticsId);
  const headStart = config.customScripts?.headStart ?? "";
  const headEnd = config.customScripts?.headEnd ?? "";
  const bodyStart = config.customScripts?.bodyStart ?? "";
  const bodyEnd = config.customScripts?.bodyEnd ?? "";
  const robotsTxt = config.robots?.index === false ? "User-agent: *\nDisallow: /\n" : "";

  return {
    name: "figma-site-configuration",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!robotsTxt || req.url?.split("?")[0] !== "/robots.txt") return next();

        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(robotsTxt);
      });
    },
    generateBundle() {
      if (!robotsTxt) return;

      this.emitFile({
        type: "asset",
        fileName: "robots.txt",
        source: robotsTxt,
      });
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        let result = html;
        result = replaceHtmlCommentSlot(result, "figma:lang", language);
        result = replaceHtmlCommentSlot(result, "figma:title", escapeHtmlText(title));
        result = replaceHtmlCommentSlot(result, "figma:head-start", headStart);
        result = replaceHtmlCommentSlot(result, "figma:head-end", headEnd);
        result = replaceHtmlCommentSlot(result, "figma:body-start", bodyStart);
        result = replaceHtmlCommentSlot(result, "figma:body-end", bodyEnd);

        const tags: HtmlTagDescriptor[] = [];
        if (description) {
          tags.push({
            tag: "meta",
            attrs: { name: "description", content: description },
            injectTo: "head",
          });
        }
        if (config.robots?.index === false) {
          tags.push({
            tag: "meta",
            attrs: { name: "robots", content: "noindex, nofollow" },
            injectTo: "head",
          });
        }
        if (favicon) {
          tags.push({ tag: "link", attrs: { rel: "icon", href: favicon }, injectTo: "head" });
        }
        if (title) {
          tags.push({
            tag: "meta",
            attrs: { property: "og:title", content: title },
            injectTo: "head",
          });
        }
        if (description) {
          tags.push({
            tag: "meta",
            attrs: { property: "og:description", content: description },
            injectTo: "head",
          });
        }
        if (socialImage) {
          tags.push(
            {
              tag: "meta",
              attrs: { property: "og:image", content: socialImage },
              injectTo: "head",
            },
            {
              tag: "meta",
              attrs: { name: "twitter:card", content: "summary_large_image" },
              injectTo: "head",
            },
            {
              tag: "meta",
              attrs: { name: "twitter:image", content: socialImage },
              injectTo: "head",
            },
          );
        }

        if (googleAnalyticsId) {
          tags.push(
            {
              tag: "script",
              attrs: {
                async: true,
                src: `https://www.googletagmanager.com/gtag/js?id=${googleAnalyticsId}`,
              },
              injectTo: "head",
            },
            {
              tag: "script",
              children: `
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', ${JSON.stringify(googleAnalyticsId)});
`,
              injectTo: "head",
            },
          );
        }

        if (config.accessibility?.addBypassLinks) {
          tags.push(
            {
              tag: "style",
              children: `
  .figma-bypass-link {
    position: fixed;
    top: 8px;
    left: 8px;
    z-index: 2147483647;
    transform: translateY(-150%);
    border-radius: 6px;
    background: #111827;
    color: #fff;
    padding: 8px 12px;
    font: 600 14px/1.2 system-ui, sans-serif;
    text-decoration: none;
  }
  .figma-bypass-link:focus {
    transform: translateY(0);
  }
`,
              injectTo: "head",
            },
            {
              tag: "a",
              attrs: { class: "figma-bypass-link", href: "#root" },
              children: "Skip to content",
              injectTo: "body-prepend",
            },
          );
        }

        return {
          html: result,
          tags,
        };
      },
    },
  };
}

/**
 * Replay the most recent build error to clients that connect after
 * it was first broadcast. Vite buffers an error payload only while
 * no clients are connected and clears the buffer on the first
 * reconnect (see `bufferedMessage` in `createWebSocketServer`), so
 * if the preview iframe reloads after Vite already delivered an
 * error to a live socket, the new socket misses the payload and
 * the overlay stays hidden even though the build is still broken.
 * We intercept `ws.send` to remember the latest error and replay
 * it on every new connection; the cache clears on a successful
 * `update` or `full-reload` so a stale overlay can't survive a
 * fixed build.
 */
function figmaErrorOverlayReplay(): Plugin {
  return {
    name: "figma-error-overlay-replay",
    apply: "serve",
    configureServer(server) {
      let lastError: object | null = null;

      const origSend = server.ws.send.bind(server.ws) as (...args: any[]) => void;
      server.ws.send = ((...args: any[]) => {
        const payload = args[0];
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
          const type = (payload as { type?: string }).type;
          if (type === "error") {
            lastError = payload as object;
          } else if (type === "update" || type === "full-reload") {
            lastError = null;
          }
        }
        return origSend(...args);
      }) as typeof server.ws.send;

      server.ws.on("connection", (socket) => {
        if (lastError !== null) {
          socket.send(JSON.stringify(lastError));
        }
      });
    },
  };
}

/**
 * Reload when a module that previously defined a React Refresh boundary stops
 * defining one. This happens when an agent moves a component into a new file
 * and replaces the old module with a re-export:
 *
 *   export { default } from './app/App'
 *
 * Vite otherwise accepts the update using the previous module's HMR boundary,
 * but the re-export-only transform no longer registers a replacement for the
 * mounted component family. React reports a successful refresh while leaving
 * the old tree mounted until the page is reloaded.
 */
function figmaReactRefreshBoundaryFallback(): Plugin {
  type ModuleNode = import("vite").ModuleNode;
  const hadRefreshBoundary = new Map<string, boolean>();
  const lostRefreshBoundaries = new Set<string>();
  let sendFullReload: (() => void) | null = null;

  return {
    name: "figma-react-refresh-boundary-fallback",
    apply: "serve",
    enforce: "post",
    configureServer(server) {
      sendFullReload = () => server.ws.send({ type: "full-reload", path: "*" });
    },
    handleHotUpdate({ modules, server, timestamp }) {
      if (lostRefreshBoundaries.size === 0) return;

      const visited = new Set<ModuleNode>();
      const pending = [...modules];
      while (pending.length > 0) {
        const current = pending.pop();
        if (!current || visited.has(current)) continue;
        visited.add(current);

        const moduleId = current.id?.split("?")[0];
        if (moduleId && lostRefreshBoundaries.has(moduleId)) {
          const invalidated = new Set<ModuleNode>();
          for (const updatedModule of modules) {
            server.moduleGraph.invalidateModule(updatedModule, invalidated, timestamp, true);
          }
          sendFullReload?.();
          return [];
        }

        pending.push(...current.importers);
      }
    },
    transform(code, id) {
      if (!/\.[jt]sx?(?:\?|$)/.test(id) || id.includes("/node_modules/")) return null;

      const moduleId = id.split("?")[0] ?? id;
      const hasRefreshBoundary = code.includes("registerExportsForReactRefresh");
      const previousHadRefreshBoundary = hadRefreshBoundary.get(moduleId);
      hadRefreshBoundary.set(moduleId, hasRefreshBoundary);

      if (hasRefreshBoundary) lostRefreshBoundaries.delete(moduleId);
      if (previousHadRefreshBoundary && !hasRefreshBoundary) {
        lostRefreshBoundaries.add(moduleId);
        queueMicrotask(() => sendFullReload?.());
      }

      return null;
    },
  };
}

/**
 * Serves a blank render-target page at /.figma/make/kit.html that
 * the Figma preview script drives directly. The page exposes a
 * registry of every file matching `storiesGlob` on
 * window.__FIGMA__.stories so the design surface can dynamically
 * import + mount each entry into its own grid view.
 *
 * Dev-only: `apply: 'serve'` gates the plugin to `vite dev`. Prod
 * builds (`vite build`) skip it entirely so the route doesn't leak
 * into shipped bundles.
 */
function figmaMakeKitPlugin(options: { storiesGlob: string | string[] }): Plugin {
  const storiesGlob = Array.isArray(options.storiesGlob)
    ? options.storiesGlob
    : [options.storiesGlob];
  const ROUTE = "/.figma/make/kit.html";
  const VIRTUAL_ID = "virtual:figma-stories";
  const RESOLVED_ID = "\0" + VIRTUAL_ID;
  const STORIES_MODULE = `export const stories = import.meta.glob(${JSON.stringify(storiesGlob)})`;
  const HTML_BOOTSTRAP = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body>
<div id="figma-make-kit-root"></div>
<script type="module">
  import { stories } from 'virtual:figma-stories'
  window.__FIGMA__ = Object.assign(window.__FIGMA__ ?? {}, { stories })
  window.dispatchEvent(new CustomEvent('figma.ready'))
</script>
</body>
</html>`;

  return {
    name: "figma-make-kit",
    apply: "serve",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      return null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      return STORIES_MODULE;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || "";
        if (url.split("?")[0] !== ROUTE) return next();

        try {
          res.setHeader("Content-Type", "text/html");
          res.end(await server.transformIndexHtml(url, HTML_BOOTSTRAP));
        } catch (err) {
          next(err as Error);
        }
      });
    },
  };
}

/**
 * Reports the sources of dependencies linked from outside node_modules (pnpm
 * or npm workspaces, `file:`, `link:`) under `node_modules/<name>/`, the way
 * installed packages appear in sourcemaps. Vite otherwise reports their real
 * path, such as `libraries/<name>/`.
 */
function figmaLinkedPackageSourcemaps(): Plugin {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "package.json"), "utf8"));
  const linkedPackages = Object.keys({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  }).flatMap((name) => {
    const installedDir = path.resolve(__dirname, "node_modules", name);
    try {
      const realDir = fs.realpathSync(installedDir);
      return realDir.split(path.sep).includes("node_modules") ? [] : [{ installedDir, realDir }];
    } catch {
      return [];
    }
  });
  const sourceMappingUrl = /\/\/# sourceMappingURL=(\S+)\s*$/;

  function installedPath(file: string) {
    const linked = linkedPackages.find(({ realDir }) => file.startsWith(realDir + path.sep));
    return linked && path.join(linked.installedDir, path.relative(linked.realDir, file));
  }
  function readSourceMap(file: string, code: string) {
    const url = sourceMappingUrl.exec(code)?.[1];
    try {
      if (url?.startsWith("data:")) {
        return {
          map: JSON.parse(Buffer.from(url.split(",")[1], "base64").toString()),
          mapDir: path.dirname(file),
        };
      }
      if (url) {
        const mapFile = path.resolve(path.dirname(file), url);
        return { map: JSON.parse(fs.readFileSync(mapFile, "utf8")), mapDir: path.dirname(mapFile) };
      }
    } catch {}
    // Without a usable input map, map every line to itself.
    const mappings = code.split("\n").map((_, i) => (i ? "AACA" : "AAAA"));
    const map = {
      version: 3,
      sources: [file],
      sourcesContent: [code],
      names: [],
      mappings: mappings.join(";"),
    };
    return { map, mapDir: path.dirname(file) };
  }

  return {
    name: "figma-linked-package-sourcemaps",
    enforce: "pre",
    load(id) {
      // Leave queried imports such as ?raw and ?url to Vite's own loaders.
      if (id.includes("?") || !/\.[cm]?[jt]sx?$/.test(id) || !installedPath(id)) return null;

      const code = fs.readFileSync(id, "utf8");
      const { map, mapDir } = readSourceMap(id, code);
      const sourceRoot = path.resolve(mapDir, map.sourceRoot ?? "");
      map.sources = map.sources.map((source: string) => {
        const original = path.resolve(sourceRoot, source);
        return installedPath(original) ?? original;
      });
      delete map.sourceRoot;
      return { code: code.replace(sourceMappingUrl, ""), map };
    },
  };
}

/**
 * Live FaceTime call feed. The agent in ../facetime-agent appends one JSON line per event to
 * .cache/call-events.jsonl; this serves them to the page as server-sent events at
 * /api/call-events, replaying the latest call to a page that connects late. When a call starts
 * and no page is open, it opens the web app and the transcript widget.
 * Dev server only. Set CALL_AUTO_OPEN=off to stop it opening windows.
 */
function callEvents(): Plugin {
  const file = path.resolve(__dirname, "../facetime-agent/.cache/call-events.jsonl");
  const autoOpen = String(process.env.CALL_AUTO_OPEN ?? "").toLowerCase() !== "off";
  return {
    name: "call-events",
    apply: "serve",
    configureServer(server) {
      const clients = new Set<{ res: ServerResponse; role: string }>();
      let offset = 0;
      let current: string[] = [];
      const origin = () => `http://localhost:${server.config.server.port}`;
      const has = (role: string) => [...clients].some((client) => client.role === role);
      const openWindows = () => {
        if (!autoOpen) return;
        if (!has("app")) execFile("open", [`${origin()}/?live=1`], () => {});
        // The NoteWorthy Mac app when it has been built (../transcript-app/build.sh): opening it
        // again brings its panel forward on the chat log and live transcript. Without it, the
        // transcript opens as a small Chrome window.
        const app = path.resolve(__dirname, "../transcript-app/build/NoteWorthy.app");
        if (fs.existsSync(app)) execFile("open", ["-a", app], () => {});
        else if (!has("widget"))
          execFile(
            "open",
            ["-na", "Google Chrome", "--args", `--app=${origin()}/?widget=1`, "--window-size=380,620"],
            () => {},
          );
      };
      const closeFaceTime = () => {
        if (process.platform !== "darwin") return;
        execFile("osascript", ["-e", 'tell application "FaceTime" to quit'], () => {});
      };
      const poll = () => {
        let size = 0;
        try {
          size = fs.statSync(file).size;
        } catch {
          return;
        }
        if (size < offset) offset = 0; // the agent emptied the file for a new call
        if (size === offset) return;
        const buffer = Buffer.alloc(size - offset);
        const fd = fs.openSync(file, "r");
        fs.readSync(fd, buffer, 0, buffer.length, offset);
        fs.closeSync(fd);
        const end = buffer.lastIndexOf(10);
        if (end < 0) return; // wait for the rest of the line
        offset += end + 1;
        for (const line of buffer.subarray(0, end).toString("utf8").split("\n")) {
          let event: { type?: string; at?: number };
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event.type === "call_started") {
            current = [];
            if (Date.now() - (event.at ?? 0) < 30_000) openWindows();
          }
          if (event.type === "call_ended") closeFaceTime();
          current.push(line);
          for (const client of clients) client.res.write(`data: ${line}\n\n`);
        }
      };
      const timer = setInterval(poll, 300);
      server.httpServer?.on("close", () => clearInterval(timer));
      // Values from an env file, read on each request so edits need no restart.
      const readEnv = (envFile: string) => {
        const values: Record<string, string> = {};
        try {
          for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
            const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
            if (match) values[match[1]] = match[2].trim();
          }
        } catch {}
        return values;
      };
      const json = (res: ServerResponse, status: number, body: object) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
      // Start a call, end it, and hand out a watch-only LiveKit token. These act on this
      // computer and use its keys, so they answer only to this computer.
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith("/api/call/")) return next();
        const from = req.socket.remoteAddress ?? "";
        if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(from))
          return json(res, 403, { error: "local_only" });

        if (url.pathname === "/api/call/start" && req.method === "POST") {
          if (process.platform !== "darwin") return json(res, 501, { error: "not_macos" });
          const line = readEnv(path.resolve(__dirname, "../facetime-agent/.env.local")).FACETIME_LINE ?? "";
          if (!/^\+?[0-9]{7,15}$/.test(line)) return json(res, 501, { error: "no_line" });
          // FaceTime asks the person to confirm before it dials.
          execFile("open", [`facetime://${line}`], (error) =>
            json(res, error ? 500 : 200, error ? { error: "open_failed" } : { ok: true }),
          );
          return;
        }
        if (url.pathname === "/api/call/end" && req.method === "POST") {
          try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(path.join(path.dirname(file), "hangup"), String(Date.now()));
            // The agent also deletes the LiveKit room; quit the local FaceTime app for this call.
            closeFaceTime();
            return json(res, 200, { ok: true });
          } catch {
            return json(res, 500, { error: "write_failed" });
          }
        }
        if (url.pathname === "/api/call/token" && req.method === "GET") {
          const env = readEnv(path.resolve(__dirname, "../facetime-agent/.env.local"));
          const room = url.searchParams.get("room") ?? "";
          if (!room || !env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET)
            return json(res, 501, { error: "no_livekit" });
          // A hidden participant that can only watch: it publishes nothing, so the call's
          // one-speaker rule is untouched, and the other participants do not see it.
          const now = Math.floor(Date.now() / 1000);
          const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
            iss: env.LIVEKIT_API_KEY,
            sub: `web-viewer-${crypto.randomUUID().slice(0, 8)}`,
            nbf: now - 10,
            exp: now + 15 * 60,
            video: { room, roomJoin: true, canPublish: false, canPublishData: false, canSubscribe: true, hidden: true },
          })}`;
          const signature = crypto.createHmac("sha256", env.LIVEKIT_API_SECRET).update(body).digest("base64url");
          return json(res, 200, { url: env.LIVEKIT_URL, token: `${body}.${signature}` });
        }
        return json(res, 404, { error: "not_found" });
      });
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname !== "/api/call-events") return next();
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(`data: {"type":"reset"}\n\n`);
        for (const line of current) res.write(`data: ${line}\n\n`);
        const client = { res, role: url.searchParams.get("role") === "widget" ? "widget" : "app" };
        clients.add(client);
        req.on("close", () => clients.delete(client));
      });
    },
  };
}
