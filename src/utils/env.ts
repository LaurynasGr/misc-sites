/** Resolved environment flags, paths and headers — shared across the server and its utils. */
import { resolve } from 'node:path';

export const isDev = (process.env.NODE_ENV ?? '') === 'development';

/** Repo root (two levels up from src/utils/) and the dirs the server cares about. */
export const ROOT = resolve(import.meta.dir, '../..');
export const SRC = resolve(ROOT, 'src');
export const DIST = resolve(ROOT, 'dist');

/** Hardening headers for the publicly-served static files. */
export const SECURITY_HEADERS: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
};
