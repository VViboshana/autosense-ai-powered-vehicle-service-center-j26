import { readFileSync } from 'node:fs';
import path from 'node:path';

// backend/package.json is one folder above both src/ (tsx) and dist/ (built).
const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8')) as { version: string };

export const APP_VERSION = pkg.version;
