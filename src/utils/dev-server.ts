/**
 * Development-only live reload for the static server (src/server.ts):
 * - a WebSocket the browser connects to (the client snippet is injected into HTML),
 * - a file watcher that reloads connected browsers when dist/ changes (debounced).
 *
 * Kept out of server.ts so that file stays small. All of this is inert in
 * production — server.ts only calls into it when NODE_ENV=development.
 */
import { watch } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import type { Server, ServerWebSocket } from 'bun';
import { DIST } from './env.ts';

/** Currently connected live-reload browsers. */
const clients = new Set<ServerWebSocket<undefined>>();

/** Tiny client injected into served HTML; reconnects and reloads on change. */
const RELOAD_SNIPPET = `<script>
  (() => {
    const connect = () => {
      const ws = new WebSocket(\`ws://\${location.host}/__livereload\`);
      ws.onmessage = () => location.reload();
      ws.onclose = () => setTimeout(connect, 500);
    };
    connect();
  })();
</script>`;

/** Bun.serve `websocket` handlers that track connected browsers. */
export const liveReloadWebSocket = {
    open: (ws: ServerWebSocket<undefined>) => {
        clients.add(ws);
    },
    close: (ws: ServerWebSocket<undefined>) => {
        clients.delete(ws);
    },
    message: () => {},
};

/**
 * Handle the `/__livereload` WebSocket upgrade, guarded against cross-site
 * hijacking by requiring a same-origin `Origin`. Returns a Response, or
 * undefined when the upgrade succeeds.
 */
export function upgradeLiveReload(req: Request, srv: Server<undefined>, url: URL): Response | undefined {
    const origin = req.headers.get('origin');
    if (origin) {
        let sameOrigin = false;
        try {
            sameOrigin = new URL(origin).host === url.host;
        } catch {
            sameOrigin = false;
        }
        if (!sameOrigin) return new Response('Forbidden', { status: 403 });
    }
    return srv.upgrade(req) ? undefined : new Response('expected websocket', { status: 426 });
}

/** Inject the live-reload client just before `</body>`. */
export function injectReloadSnippet(html: string): string {
    return html.replace('</body>', `${RELOAD_SNIPPET}\n</body>`);
}

export async function startLiveReload(): Promise<void> {
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleReload = () => {
        console.log('Detected dist/ change, reloading browsers...');
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
            for (const ws of clients) ws.send('reload');
        }, 60);
    };

    await mkdir(DIST, { recursive: true });
    watch(DIST, { recursive: true }, () => scheduleReload());
}
