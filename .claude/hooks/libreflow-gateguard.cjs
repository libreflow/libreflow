#!/usr/bin/env node
// PreToolUse: libreflow GateGuard. Replaces ECC defaults with prompts
// that surface CLAUDE.md invariants based on the file/command at hand.
// Disable via env: ECC_GATEGUARD=off or LIBREFLOW_GATEGUARD=off.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const STATE_DIR = process.env.LIBREFLOW_GATEGUARD_STATE_DIR
  || path.join(os.homedir() || os.tmpdir(), '.libreflow-gateguard');
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_CHECKED = 500;
const ROUTINE_BASH_KEY = '__bash_session__';
let activeStateFile = null;

const OFF = new Set(['0', 'false', 'off', 'disabled', 'disable']);
function isDisabled() {
  const a = String(process.env.LIBREFLOW_GATEGUARD || '').trim().toLowerCase();
  const b = String(process.env.ECC_GATEGUARD || '').trim().toLowerCase();
  return OFF.has(a) || OFF.has(b);
}

function hashKey(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

function sessionKey(data) {
  const direct = [data && data.session_id, data && data.sessionId, process.env.CLAUDE_SESSION_ID];
  for (const c of direct) {
    if (c && String(c).trim()) {
      const s = String(c).trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
      if (s) return s;
    }
  }
  const tx = (data && (data.transcript_path || data.transcriptPath)) || process.env.CLAUDE_TRANSCRIPT_PATH;
  if (tx) return hashKey('tx', path.resolve(String(tx)));
  return hashKey('proj', path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd()));
}

function stateFile(data) {
  if (!activeStateFile) activeStateFile = path.join(STATE_DIR, `state-${sessionKey(data)}.json`);
  return activeStateFile;
}

function loadState() {
  try {
    const fp = stateFile();
    if (!fs.existsSync(fp)) return { checked: [], last_active: Date.now() };
    const s = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (Date.now() - (s.last_active || 0) > SESSION_TIMEOUT_MS) {
      try { fs.unlinkSync(fp); } catch (_) {}
      return { checked: [], last_active: Date.now() };
    }
    return s;
  } catch (_) {
    return { checked: [], last_active: Date.now() };
  }
}

function saveState(s) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const fp = stateFile();
    const checked = Array.isArray(s.checked) ? s.checked.slice(-MAX_CHECKED) : [];
    const out = { checked, last_active: Date.now() };
    const tmp = `${fp}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmp, JSON.stringify(out), 'utf8');
    fs.renameSync(tmp, fp);
    return true;
  } catch (_) {
    return false;
  }
}

function isChecked(key) { return loadState().checked.includes(key); }
function mark(key) {
  const s = loadState();
  if (!s.checked.includes(key)) s.checked.push(key);
  return saveState(s);
}

// --- libreflow invariant mapping (CLAUDE.md sections) ---

function normalize(p) { return String(p || '').replace(/\\/g, '/').toLowerCase(); }

function libreflowInvariantsForPath(filePath) {
  const p = normalize(filePath);
  const tags = [];

  if (/frontend\/src\/virt\.js$/.test(p) || /frontend\/src\/renderer\.js$/.test(p)) tags.push('virt');
  if (/frontend\/src\/(cdaudio|eq|audio|crossfade|player)/.test(p)) tags.push('audio');
  if (/frontend\/src\/(app|m3u|organize|backup|library|watchfolder|playlist)/.test(p)) tags.push('tracks');
  if (/frontend\/src\/ipc\.js$/.test(p)) tags.push('ipc-js');
  if (/^src-tauri\/src\/(commands|watch|fs|tags|cmd)/.test(p) || /src-tauri\/tauri\.conf\.json$/.test(p)) tags.push('ipc-rust');
  if (/frontend\/src\/(idb|cfg|backup|persist)/.test(p)) tags.push('idb');
  if (/\.css$/.test(p)) tags.push('css');

  return tags;
}

const INVARIANT_TEXT = {
  virt: [
    '- §10 virt: CFG.VIRT_ROW_H / CFG.VIRT_GRP_H are the ONLY allowed row heights. No hardcoded values.',
    '- Binary-search scroll→index. ±8 row buffer. ZERO allocations in the render loop.'
  ],
  audio: [
    '- §9 audio params via setTargetAtTime, NEVER `param.value = N` (zipper noise).',
    '- §13 audio.volume reads from `#vol` DOM, never assigned literally.',
    '- Crossfade preserves volume — no reset.'
  ],
  tracks: [
    '- §2/§7 ANY mutation of tracks[] MUST be followed by rebuildTrackIdxMap().',
    '- No linear scan over tracks[] — use _trackIdxMap.'
  ],
  'ipc-js': [
    '- Wait for __TAURI__ before first invoke. Every IPC call wrapped with a JS-side timeout.',
    '- Map `Result<T, String>` errors to user-visible messages, never silently swallow.'
  ],
  'ipc-rust': [
    '- Validate input BEFORE any FS / system call: reject `..`, null bytes, control chars.',
    '- Canonicalize and scope-check paths; cap path length.',
    '- New command? → add to tauri.conf.json allowlist + JS-side timeout + version bump.'
  ],
  idb: [
    '- §14 ALL IDB writes debounced. Group multi-field updates into one transaction.',
    '- Use the `idb` wrapper (dget/dall/dput); never raw IndexedDB.'
  ],
  css: [
    '- §13 do NOT mix id + class selectors. No inline event handlers in HTML.',
    '- Tokens via @fontsource (local); no imported web fonts.'
  ]
};

function libreflowAddendum(filePath) {
  const tags = libreflowInvariantsForPath(filePath);
  const lines = ['', '== libreflow invariants relevant to this file =='];
  lines.push('- §15 NO external network: no fetch / XMLHttpRequest / WebSocket. Project is offline by contract.');
  for (const t of tags) {
    for (const l of INVARIANT_TEXT[t] || []) lines.push(l);
  }
  if (tags.length === 0) {
    lines.push('- (no path-specific invariants — still confirm: no new network, no new IPC surface, no tracks[] mutation without rebuildTrackIdxMap()).');
  }
  return lines.join('\n');
}

function sanitize(s) {
  let out = '';
  for (const ch of String(s || '')) {
    const c = ch.codePointAt(0);
    out += (c <= 0x1f || c === 0x7f) ? ' ' : ch;
  }
  return out.trim().slice(0, 500);
}

function editMsg(fp) {
  return [
    '[libreflow GateGuard]',
    '',
    `Before editing ${sanitize(fp)}, present:`,
    '',
    '1. Every file that imports/uses this file (Grep).',
    '2. The public symbols affected by this change.',
    '3. If it reads/writes IDB or audio params, show schema/field names (redacted values).',
    "4. Quote the user's current instruction verbatim.",
    libreflowAddendum(fp),
    '',
    'Present facts, then retry. Recovery: ECC_GATEGUARD=off or LIBREFLOW_GATEGUARD=off.'
  ].join('\n');
}

function writeMsg(fp) {
  return [
    '[libreflow GateGuard]',
    '',
    `Before creating ${sanitize(fp)}, present:`,
    '',
    '1. The file(s) and line(s) that will import this new file.',
    '2. Confirm no existing module under frontend/src/ or src-tauri/src/ already covers this (Glob).',
    '3. If new IPC surface: list the Tauri command, allowlist entry, and JS-side caller in ipc.js.',
    "4. Quote the user's current instruction verbatim.",
    libreflowAddendum(fp),
    '',
    'Present facts, then retry. Recovery: ECC_GATEGUARD=off or LIBREFLOW_GATEGUARD=off.'
  ].join('\n');
}

function routineBashMsg() {
  return [
    '[libreflow GateGuard]',
    '',
    'Before the first Bash this session, present:',
    '',
    '1. The current user request in one sentence.',
    '2. What this command verifies or produces (cargo / npm / git / vite).',
    '',
    'Reminder: tests are `cargo test` + `npm test`; bench is `npm run bench`; dev is `npm run dev`.',
    '',
    'Present facts, then retry.'
  ].join('\n');
}

function destructiveBashMsg() {
  return [
    '[libreflow GateGuard]',
    '',
    'Destructive command detected. Before running, present:',
    '',
    '1. Every file / branch / IDB store this command modifies or deletes.',
    '2. A one-line rollback procedure.',
    "3. Quote the user's current instruction verbatim.",
    '',
    'No --force without an explicit user OK. No --no-verify (commitlint enforced).',
    '',
    'Present facts, then retry.'
  ].join('\n');
}

const DESTRUCTIVE_RX = [
  /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f/i,
  /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r/i,
  /\brm\s+--recursive\b.*--force\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-zA-Z]*f/i,
  /\bgit\s+push\s+(?!.*--force-with-lease)(?=.*--force)/i,
  /\bgit\s+checkout\s+--/i,
  /\bgit\s+commit\s+--amend\b/i,
  /\bdrop\s+table\b/i,
  /\btruncate\s+table\b/i,
  /\bcargo\s+clean\b/i,
  /\bnpm\s+ci\b/i,
  /\bindexeddb\.deletedatabase/i
];

function isDestructive(cmd) {
  const s = String(cmd || '');
  return DESTRUCTIVE_RX.some(rx => rx.test(s));
}

function isReadOnlyGitIntrospection(cmd) {
  return /^git\s+(status|diff|log|show|branch|rev-parse|remote|ls-files|describe)(\s|$)/.test(String(cmd || '').trim())
    && !/[\r\n;&|`$()]/.test(cmd)
    && !/--force|--hard|--amend|reset|clean|checkout\s+--/.test(cmd);
}

function deny(reason) {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason
      }
    }),
    exitCode: 0
  };
}

function allow(input) { return input; }

function run(rawInput) {
  let data;
  try { data = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput; }
  catch (_) { return rawInput; }
  if (isDisabled()) return rawInput;

  activeStateFile = null;
  stateFile(data);

  const TOOL = { edit: 'Edit', write: 'Write', multiedit: 'MultiEdit', bash: 'Bash' };
  const tool = TOOL[(data.tool_name || '').toLowerCase()] || data.tool_name;
  const input = data.tool_input || {};
  const inSub = !!(data.agent_id || data.agentId || data.parent_tool_use_id || data.parentToolUseId);

  if (tool === 'Edit' || tool === 'Write') {
    const fp = input.file_path || '';
    if (!fp) return allow(rawInput);
    if (/\.claude\/settings(\.[^/\\]+)?\.json$/i.test(fp.replace(/\\/g, '/'))) return allow(rawInput);
    if (inSub) return allow(rawInput);
    if (isChecked(fp)) return allow(rawInput);
    if (!mark(fp)) return allow(rawInput);
    return deny(tool === 'Edit' ? editMsg(fp) : writeMsg(fp));
  }

  if (tool === 'MultiEdit') {
    if (inSub) return allow(rawInput);
    for (const e of input.edits || []) {
      const fp = e.file_path || '';
      if (!fp) continue;
      if (/\.claude\/settings(\.[^/\\]+)?\.json$/i.test(fp.replace(/\\/g, '/'))) continue;
      if (isChecked(fp)) continue;
      if (!mark(fp)) return allow(rawInput);
      return deny(editMsg(fp));
    }
    return allow(rawInput);
  }

  if (tool === 'Bash') {
    const cmd = input.command || '';
    if (isReadOnlyGitIntrospection(cmd)) return allow(rawInput);
    if (isDestructive(cmd)) {
      const key = '__destructive__' + crypto.createHash('sha256').update(cmd).digest('hex').slice(0, 16);
      if (isChecked(key)) return allow(rawInput);
      if (!mark(key)) return allow(rawInput);
      return deny(destructiveBashMsg());
    }
    if (isChecked(ROUTINE_BASH_KEY)) return allow(rawInput);
    if (!mark(ROUTINE_BASH_KEY)) return allow(rawInput);
    return deny(routineBashMsg());
  }

  return allow(rawInput);
}

module.exports = { run };

if (require.main === module) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { buf += c; });
  process.stdin.on('end', () => {
    const out = run(buf);
    if (typeof out === 'object' && out && out.stdout) {
      process.stdout.write(out.stdout);
      process.exit(out.exitCode || 0);
    }
    process.exit(0);
  });
}
