/**
 * Local static server for the sites in dist/, with optional live reload.
 *
 *   bun run start   # serve dist/ as-is
 *   bun run dev     # watch + live reload
 *
 * This server is for LOCAL use (development + manual preview) and serves dist/
 * openly — the production password gate lives in the Vercel Edge middleware
 * (middleware.ts), which runs before any static file is served. Serving (path
 * hardening, security headers, dev live-reload injection) lives in
 * src/utils/static-files.ts; the dev watch/reload loop in
 * src/utils/dev-server.ts; shared paths/flags/headers in src/utils/env.ts.
 * No external server package — just Bun.serve. PORT overrides the port.
 */
import { liveReloadWebSocket, startLiveReload, upgradeLiveReload } from './utils/dev-server.ts';
import { isDev } from './utils/env.ts';
import { serveStatic } from './utils/static-files.ts';

const PORT = Number(process.env.PORT) || 7700;

const server = Bun.serve({
    port: PORT,
    async fetch(req, srv) {
        const url = new URL(req.url);
        if (isDev && url.pathname === '/__livereload') return upgradeLiveReload(req, srv, url);
        return serveStatic(url.pathname);
    },
    websocket: liveReloadWebSocket,
    // Never surface Bun's verbose fallback page (it embeds source + paths) in prod.
    error() {
        return new Response('Internal Server Error', { status: 500 });
    },
});

if (!isDev) {
    console.log(`serving dist/ on http://localhost:${server.port} (preview). PORT overrides the port.`);
} else {
    console.log(
        `dev: http://localhost:${server.port} (live reload) — watching dist/, reloading on change. Ctrl+C to stop.`,
    );
    await startLiveReload();
}
