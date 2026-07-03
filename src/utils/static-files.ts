/**
 * Serve a file from the dist/ directory for an incoming request path, with
 * path-traversal hardening (malformed escapes, NUL bytes, literal/encoded `..`,
 * and symlink escapes) and security headers. In development it injects the
 * live-reload client into HTML responses. Returns a 400 / 403 / 404 Response for
 * a bad, out-of-bounds, or missing path.
 */
import { realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { injectReloadSnippet } from './dev-server.ts';
import { DIST, isDev, SECURITY_HEADERS } from './env.ts';

export async function serveStatic(pathname: string): Promise<Response> {
    let rel: string;
    try {
        rel = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
    } catch {
        return new Response('Bad request', { status: 400 }); // malformed %-escape
    }
    if (rel.includes('\0')) return new Response('Bad request', { status: 400 }); // NUL byte
    // Directory paths (trailing slash) map to their index.html.
    if (rel.endsWith('/')) rel += 'index.html';

    let filePath = resolve(DIST, `.${rel}`);
    if (!filePath.startsWith(DIST + sep)) return new Response('Forbidden', { status: 403 });

    if (!(await Bun.file(filePath).exists())) {
        // Extensionless path → try its directory index.
        const lastSeg = rel.slice(rel.lastIndexOf('/') + 1);
        const idx = resolve(DIST, `.${rel}/index.html`);
        if (lastSeg.includes('.') || !idx.startsWith(DIST + sep) || !(await Bun.file(idx).exists())) {
            return new Response('Not found', { status: 404 });
        }
        filePath = idx;
    }
    const file = Bun.file(filePath);
    // Defence-in-depth: resolve symlinks and re-check the real path stays in dist.
    const real = await realpath(filePath).catch(() => null);
    if (!real || (real !== DIST && !real.startsWith(DIST + sep))) return new Response('Forbidden', { status: 403 });

    if (isDev && filePath.endsWith('.html')) {
        return new Response(injectReloadSnippet(await file.text()), {
            headers: { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8' },
        });
    }
    const headers = new Headers(SECURITY_HEADERS);
    if (file.type) headers.set('content-type', file.type); // Bun infers from the extension
    return new Response(file, { headers });
}
