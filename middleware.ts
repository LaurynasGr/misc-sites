/**
 * Vercel Edge Middleware — the password gate for the static site.
 *
 * Routing Middleware runs before any file is served (ahead of the edge cache and
 * static serving), so this gates the WHOLE site — HTML and images alike — which a
 * vercel.json rewrite could not (rewrites sit below static serving). With
 * APP_PASSWORD unset the site is served openly.
 *
 * Uses Web Crypto (crypto.subtle), not node:crypto, because this runs on the Edge
 * runtime. A correct password mints an HMAC-SHA256-signed session cookie; requests
 * with a valid, unexpired cookie fall through to the static file (next()), and
 * everything else is rewritten to the login page (/login/).
 */
import { next, rewrite } from '@vercel/functions';

const APP_PASSWORD = process.env.APP_PASSWORD ?? '';
/** HMAC key for the session-cookie signature (falls back to the password). */
const SESSION_SECRET = process.env.SESSION_SECRET || APP_PASSWORD;
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // seconds

// Run on every path except the login page (must stay reachable) and Vercel internals.
export const config = {
    matcher: ['/((?!_vercel/|login/).*)'],
};

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer): string {
    let bin = '';
    for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
    return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function base64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
    const b64 = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

let keyPromise: Promise<CryptoKey> | null = null;
function hmacKey(): Promise<CryptoKey> {
    keyPromise ??= crypto.subtle.importKey(
        'raw',
        encoder.encode(SESSION_SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify'],
    );
    return keyPromise;
}

async function sign(payload: string): Promise<string> {
    return base64url(await crypto.subtle.sign('HMAC', await hmacKey(), encoder.encode(payload)));
}

/** Constant-time password check: verify HMAC(input) against HMAC(APP_PASSWORD). */
async function passwordMatches(input: string): Promise<boolean> {
    const expected = await crypto.subtle.sign('HMAC', await hmacKey(), encoder.encode(APP_PASSWORD));
    return crypto.subtle.verify('HMAC', await hmacKey(), expected, encoder.encode(input));
}

/** Verify the session cookie's signature (constant-time) and that it hasn't expired. */
async function isAuthed(request: Request): Promise<boolean> {
    const cookie = request.headers.get('cookie') ?? '';
    const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
    if (!match) return false;
    const value = match[1];
    const dot = value.lastIndexOf('.');
    if (dot <= 0) return false;
    const payload = value.slice(0, dot);
    let valid = false;
    try {
        valid = await crypto.subtle.verify(
            'HMAC',
            await hmacKey(),
            base64urlToBytes(value.slice(dot + 1)),
            encoder.encode(payload),
        );
    } catch {
        valid = false;
    }
    if (!valid) return false;
    const issued = Number(payload);
    return Number.isFinite(issued) && Date.now() - issued < SESSION_MAX_AGE * 1000;
}

/** A signed `session=<issuedAt>.<sig>` cookie (always Secure — the edge is HTTPS). */
async function sessionCookie(): Promise<string> {
    const payload = String(Date.now());
    return [
        `session=${payload}.${await sign(payload)}`,
        'HttpOnly',
        'SameSite=Lax',
        'Path=/',
        'Secure',
        `Max-Age=${SESSION_MAX_AGE}`,
    ].join('; ');
}
const CLEAR_COOKIE = ['session=', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Secure', 'Max-Age=0'].join('; ');

export default async function middleware(request: Request): Promise<Response> {
    if (!APP_PASSWORD) return next(); // gate disabled — serve openly

    const { pathname } = new URL(request.url);

    if (request.method === 'POST' && pathname === '/login') {
        const form = await request.formData().catch(() => null);
        const password = form?.get('password');
        if (typeof password === 'string' && (await passwordMatches(password))) {
            return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': await sessionCookie() } });
        }
        return new Response(null, { status: 303, headers: { location: '/login/?error=1' } });
    }
    // Logout via a plain link (GET) or a form (POST): clear the cookie, back to login.
    if (pathname === '/logout' && (request.method === 'GET' || request.method === 'POST')) {
        return new Response(null, { status: 303, headers: { location: '/login/', 'set-cookie': CLEAR_COOKIE } });
    }

    if (await isAuthed(request)) return next();
    return rewrite(new URL('/login/', request.url));
}
