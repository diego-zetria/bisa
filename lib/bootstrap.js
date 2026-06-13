// lib/bootstrap.js
// Extracted from server.js R1 (2026-05-24). Holds env loading, top-level
// config (PORT/HOST/AUTH_TOKEN/CLAUDE_CMD/USER_SHELL), auth/token helpers,
// path/CWD utilities, MIME tables, file-watcher ignore list, and small
// fs helpers (copyRecursive, moveToTrash).
//
// CWD-dependent helpers are exported as factories (makeResolveInsideCwd,
// makeMoveToTrash) so server.js can keep `let CWD` mutable for project
// switching (lines 4994 / 5077 in original server.js) without coupling
// CWD state to this module.

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { execSync, spawn } = require('child_process');

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const WATCH_IGNORE = [
  /(^|[\\/])\../,
  /node_modules/,
  // live mic captures (codex/recordings/<id>/audio.wav) — ffmpeg flushes the
  // WAV continuously while recording, which would pin it to the RECENT list
  /[\\/]codex[\\/]recordings[\\/]/,
  /\.git(\/|$)/,
  /\.next/,
  /\.cache/,
  /\.venv/,
  /dist\//,
  /build\//,
  /target\//,
  /\.DS_Store$/,
  /\.log$/,
  /\.sock$/,
  /\.pid$/,
  // macOS system dirs under $HOME
  /[\\/]Library[\\/]/,
  /[\\/]Applications[\\/]/,
  /[\\/]Music[\\/]/,
  /[\\/]Movies[\\/]/,
  /[\\/]Pictures[\\/]/,
  /[\\/]\.Trash[\\/]/,
];

// .env load — file lives at project root (one level up from lib/).
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const PORT = parseInt(process.env.PORT || '7778', 10);
const HOST = process.env.HOST || '::';
const AUTH_TOKEN = process.env.AUTH_TOKEN || crypto.randomBytes(16).toString('hex');
const CLAUDE_CMD = process.env.CLAUDE_CMD || 'claude';
const USER_SHELL = process.env.SHELL || '/bin/bash';

// Verify claude binary is reachable through the user's login shell.
try {
  execSync(`${USER_SHELL} -lic 'command -v ${CLAUDE_CMD}'`, { stdio: 'pipe' });
} catch {
  console.error(`[bisa] FATAL: ${USER_SHELL} cannot find '${CLAUDE_CMD}'. Set CLAUDE_CMD in .env or fix your shell PATH.`);
  process.exit(1);
}

if (!process.env.AUTH_TOKEN) {
  console.log('\n[bisa] No AUTH_TOKEN set — generated one for this session:');
  console.log(`       ${AUTH_TOKEN}\n`);
}

const safeEq = (a, b) => {
  const ab = Buffer.from(a || '');
  const bb = Buffer.from(b || '');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
};

const COOKIE_NAME = 'bisa_token';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

const parseCookies = (header) => {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) { try { out[k] = decodeURIComponent(v); } catch { out[k] = v; } }
  }
  return out;
};

const extractToken = (req) => {
  const cookies = parseCookies(req.headers.cookie);
  return (req.query && req.query.token)
    || req.get('x-bisa-token')
    || (req.body && req.body.token)
    || cookies[COOKIE_NAME]
    || '';
};

const setTokenCookie = (res, token) => {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Max-Age=${COOKIE_MAX_AGE}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  res.setHeader('Set-Cookie', attrs.join('; '));
};

// Factory: receives a getter for the current CWD (server.js owns the
// mutable `let CWD`), returns a path-confinement helper that re-reads
// CWD on every call. Project-switching mutates server.js's CWD;
// resolveInsideCwd transparently follows.
const makeResolveInsideCwd = (getCwd) => (rel) => {
  if (typeof rel !== 'string' || !rel) return null;
  const cwd = getCwd();
  const abs = path.resolve(cwd, rel);
  const root = path.resolve(cwd) + path.sep;
  if (abs !== path.resolve(cwd) && !abs.startsWith(root)) return null;
  return abs;
};

const EXT_BINARY = new Set(['.png','.jpg','.jpeg','.gif','.webp','.svg','.ico','.pdf','.zip','.tar','.gz','.bz2','.7z','.mp3','.mp4','.mov','.wav','.ogg','.woff','.woff2','.ttf','.otf','.eot']);
const EXT_IMAGE  = new Set(['.png','.jpg','.jpeg','.gif','.webp','.svg','.ico']);

const MIME = {
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif',
  '.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon',
  '.pdf':'application/pdf',
};

// Factory: returns the requireAuth express middleware. Captures
// AUTH_TOKEN (immutable) by closure.
const makeRequireAuth = () => (req, res, next) => {
  if (!safeEq(extractToken(req), AUTH_TOKEN)) return res.status(401).json({ error: 'unauthorized' });
  next();
};

// Shell helper shared by rtk + network + host sampling. Runs `cmd` through
// the user's login shell so PATH/profile env match an interactive session,
// with a SIGKILL timeout. Resolves with { code, out, err } and never rejects.
const runShell = (cmd, timeoutMs) => new Promise((resolve) => {
  const child = spawn(USER_SHELL, ['-lic', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, timeoutMs);
  child.stdout.on('data', (d) => { out += d.toString('utf8'); });
  child.stderr.on('data', (d) => { err += d.toString('utf8'); });
  child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  child.on('error', () => { clearTimeout(timer); resolve({ code: -1, out, err }); });
});

const copyRecursive = (src, dst) => {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: false });
    for (const name of fs.readdirSync(src)) copyRecursive(path.join(src, name), path.join(dst, name));
  } else {
    fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
  }
};

// Factory: returns moveToTrash. Needs CWD getter for the fallback
// path (CWD/.bisa-trash/) when macOS Finder trash fails.
const makeMoveToTrash = (getCwd) => (abs) => {
  // macOS Finder trash — recoverable via Finder
  if (process.platform === 'darwin') {
    try {
      const escaped = abs.replace(/"/g, '\\"');
      execSync(`osascript -e 'tell application "Finder" to delete POSIX file "${escaped}"'`, {
        stdio: 'pipe', timeout: 5000,
      });
      return 'macos-trash';
    } catch (e) {
      // fall through to local trash
    }
  }
  // portable fallback: move into <CWD>/.bisa-trash/
  const cwd = getCwd();
  const trashDir = path.join(cwd, '.bisa-trash');
  fs.mkdirSync(trashDir, { recursive: true });
  const base = path.basename(abs);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(trashDir, `${base}.${ts}`);
  fs.renameSync(abs, dest);
  return path.relative(cwd, dest);
};

module.exports = {
  // top-level config
  PORT, HOST, AUTH_TOKEN, CLAUDE_CMD, USER_SHELL,
  // cookies + auth helpers
  COOKIE_NAME, COOKIE_MAX_AGE,
  safeEq, parseCookies, extractToken, setTokenCookie,
  makeRequireAuth,
  // file size + watch + MIME
  MAX_FILE_BYTES, WATCH_IGNORE,
  EXT_BINARY, EXT_IMAGE, MIME,
  // CWD-dependent factories (server.js owns CWD state)
  makeResolveInsideCwd, makeMoveToTrash,
  // misc fs
  copyRecursive,
  // shell helper
  runShell,
};
