// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The privacy firewall: what the agent reads goes through it before a cloud
// model sees it.
//
// - Secrets (API keys, tokens, passwords, private keys, .env values) are
//   swapped for placeholders like «secret-3». The model can still move them
//   around: when it writes a placeholder into a file or a command, the real
//   value goes in, on this computer. The same secret always gets the same
//   placeholder.
// - Private files (Settings → Agent: "*.pem", "secrets/**"…) can't be read by
//   cloud models at all, only by models on your own computer or network.
// - Models on your own computer or network see everything as it is.

'use strict';

const { matcher } = require('./paths');

const DEFAULT_PRIVATE = ['*.pem', '*.key', '*.p12', '*.pfx', 'id_rsa*', 'id_ed25519*', 'id_ecdsa*', '.ssh/**', 'secrets/**', '.najwa-private/**'];

// Values that look like a secret on their own.
const TOKEN_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}/g,
  /\bhf_[A-Za-z0-9]{30,}/g,
  /\btskey-[A-Za-z0-9-]{20,}/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g,
  /https:\/\/discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+/g
];

// Names whose value is a secret: API_KEY=…, "password": "…", token: …
const SECRET_NAME = '[A-Za-z0-9_.-]*(?:secret|token|passw(?:or)?d|passwd|pwd|api[_-]?key|apikey|private[_-]?key|access[_-]?key|client[_-]?secret|auth|credential|cookie|session[_-]?key|dsn)[A-Za-z0-9_.-]*';
const ASSIGNMENTS = [
  // KEY=value and export KEY=value (.env, shell)
  new RegExp(`^(\\s*(?:export\\s+)?${SECRET_NAME}\\s*=\\s*)(["']?)([^\\s"'#][^"'\\n#]*?)\\2(\\s*(?:#.*)?)$`, 'gim'),
  // "key": "value" (JSON) and key: value (YAML)
  new RegExp(`((["']?)${SECRET_NAME}\\2\\s*:\\s*)(["'])([^"'\\n]+)\\3`, 'gi'),
  new RegExp(`^(\\s*${SECRET_NAME}\\s*:\\s+)([^\\s"'#{[&*!|>][^\\n#]*?)(\\s*(?:#.*)?)$`, 'gim')
];
// user:password@ in addresses (databases, proxies)
const URL_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(@)/gi;

// Not secrets: examples and blanks.
const PLACEHOLDER_VALUE = /^(?:|x+|\*+|\.+|changeme|change[-_ ]?me|your[-_ ].*|<.*>|\$\{.*\}|\$[A-Z_]+|%.*%|\{\{.*\}\}|null|none|true|false|undefined|example|test|password|secret|todo|xxx.*|placeholder|«secret-\d+»)$/i;

const MARK = /«secret-(\d+)»/g;

// Where a model runs: on this computer or this network, or in the cloud.
function isLocalAddress(url) {
  let host;
  try {
    host = new URL(String(url)).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '::1' || host === '[::1]' || host.endsWith('.local') || host.endsWith('.ts.net') || host.endsWith('.lan') || host.endsWith('.home.arpa')) return true;
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
}

function isLocalModel(providerId, cfg = {}) {
  if (providerId === 'ollama' || providerId === 'openaiCompatible') return !cfg.baseUrl || isLocalAddress(cfg.baseUrl);
  return false;
}

/**
 * @param enabled     the firewall is on (Settings → Agent)
 * @param cloud       the model runs in the cloud (see isLocalModel)
 * @param privateGlobs extra private files (on top of DEFAULT_PRIVATE)
 */
function createFirewall({ enabled = true, cloud = true, privateGlobs = [] } = {}) {
  const active = enabled && cloud;
  const isPrivate = matcher([...DEFAULT_PRIVATE, ...privateGlobs]);
  const byValue = new Map();   // secret -> placeholder
  const byMark = new Map();    // placeholder number -> secret
  let hiddenTotal = 0;

  const markFor = (value) => {
    if (!byValue.has(value)) {
      const n = byMark.size + 1;
      byValue.set(value, `«secret-${n}»`);
      byMark.set(n, value);
    }
    return byValue.get(value);
  };
  const worth = (v) => v.trim().length >= 6 && !PLACEHOLDER_VALUE.test(v.trim());

  return {
    active,
    // Text the model is about to read. Returns { text, hidden }.
    scrub(text) {
      if (!active || !text) return { text: text || '', hidden: 0 };
      let hidden = 0;
      let out = String(text);
      const swap = (v) => {
        hidden++;
        return markFor(v);
      };
      for (const re of TOKEN_PATTERNS) out = out.replace(re, (m) => swap(m));
      out = out.replace(URL_PASSWORD, (all, pre, pass, at) => (worth(pass) ? `${pre}${swap(pass)}${at}` : all));
      out = out.replace(ASSIGNMENTS[0], (all, pre, q, v, post) => (worth(v) && !/«secret-\d+»/.test(v) ? `${pre}${q}${swap(v.trim())}${q}${post}` : all));
      out = out.replace(ASSIGNMENTS[1], (all, pre, _q, q, v) => (worth(v) && !/«secret-\d+»/.test(v) ? `${pre}${q}${swap(v)}${q}` : all));
      out = out.replace(ASSIGNMENTS[2], (all, pre, v, post) => (worth(v) && !/«secret-\d+»/.test(v) ? `${pre}${swap(v.trim())}${post}` : all));
      hiddenTotal += hidden;
      return { text: out, hidden };
    },
    // Text the model wrote (a file, an edit, a command): real values back in.
    restore(text) {
      if (typeof text !== 'string' || !byMark.size) return text;
      return text.replace(MARK, (m, n) => (byMark.has(Number(n)) ? byMark.get(Number(n)) : m));
    },
    // A cloud model asking for a private file: refused.
    checkPrivate(rel) {
      if (active && isPrivate(rel)) {
        throw new Error(`${rel} is private (Settings → Agent → Private files): only models on your own computer or network can read or change it.`);
      }
    },
    isPrivate: (rel) => isPrivate(rel),
    hiddenTotal: () => hiddenTotal
  };
}

module.exports = { createFirewall, isLocalModel, isLocalAddress, DEFAULT_PRIVATE };
