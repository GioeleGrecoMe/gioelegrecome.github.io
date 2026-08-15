/*
 * Source transformer used by the browser loader.
 *
 * It rewrites only calibration-gate IF blocks that contain known user-facing
 * rejection messages. The original condition remains intact and is simply
 * prefixed with "!window.__RS_ALLOW_UNCALIBRATED__ && (...)". Therefore:
 *   - normal/calibrated mode behaves exactly as before;
 *   - explicit uncalibrated mode bypasses the gate;
 *   - unrelated calibration calculations are not blindly altered.
 */
(function installRoomScannerSourceTransformer() {
  'use strict';
  if (window.RoomScannerSourceTransformer) return;

  const GATE_MESSAGES = [
    'Completa prima la calibrazione acustica',
    'calibrazione acustica non valida',
    'calibrazione acustica valida richiesta',
    'serve una calibrazione acustica',
    'calibrazione non valida',
    'audio calibration required',
    'complete acoustic calibration first'
  ];

  function skipQuotedOrCommented(code, i) {
    const ch = code[i];
    const next = code[i + 1];
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < code.length && code[i] !== '\n') i += 1;
      return i;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i + 1 < code.length && !(code[i] === '*' && code[i + 1] === '/')) i += 1;
      return Math.min(code.length, i + 2);
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < code.length) {
        if (code[i] === '\\') { i += 2; continue; }
        if (code[i] === quote) return i + 1;
        i += 1;
      }
      return i;
    }
    return i + 1;
  }

  function matchDelimiter(code, openPos, openChar, closeChar) {
    let depth = 0;
    for (let i = openPos; i < code.length;) {
      const ch = code[i];
      const next = code[i + 1];
      if (ch === '"' || ch === "'" || ch === '`' || (ch === '/' && (next === '/' || next === '*'))) {
        i = skipQuotedOrCommented(code, i);
        continue;
      }
      if (ch === openChar) depth += 1;
      if (ch === closeChar) {
        depth -= 1;
        if (depth === 0) return i;
      }
      i += 1;
    }
    return -1;
  }

  function locateGateIf(code, messagePos) {
    const from = Math.max(0, messagePos - 5000);
    const prefix = code.slice(from, messagePos);
    const candidates = [];
    const re = /\bif\s*\(/g;
    let m;
    while ((m = re.exec(prefix))) candidates.push(from + m.index);
    candidates.reverse();

    for (const ifPos of candidates) {
      const openParen = code.indexOf('(', ifPos);
      if (openParen < 0) continue;
      const closeParen = matchDelimiter(code, openParen, '(', ')');
      if (closeParen < 0 || closeParen > messagePos) continue;
      let cursor = closeParen + 1;
      while (/\s/.test(code[cursor] || '')) cursor += 1;
      if (code[cursor] !== '{') continue;
      const closeBrace = matchDelimiter(code, cursor, '{', '}');
      if (closeBrace < 0) continue;
      if (messagePos > cursor && messagePos < closeBrace) {
        return { ifPos, openParen, closeParen, openBrace: cursor, closeBrace };
      }
    }
    return null;
  }

  function transformScript(code) {
    const replacements = [];
    const lower = code.toLowerCase();
    for (const message of GATE_MESSAGES) {
      const needle = message.toLowerCase();
      let pos = 0;
      while ((pos = lower.indexOf(needle, pos)) >= 0) {
        const gate = locateGateIf(code, pos);
        if (gate) {
          const condition = code.slice(gate.openParen + 1, gate.closeParen);
          if (!condition.includes('__RS_ALLOW_UNCALIBRATED__')) {
            replacements.push({
              start: gate.openParen + 1,
              end: gate.closeParen,
              text: `!window.__RS_ALLOW_UNCALIBRATED__ && (${condition})`
            });
          }
        }
        pos += needle.length;
      }
    }

    // Deduplicate identical condition ranges reached through multiple messages.
    const unique = [];
    const seen = new Set();
    for (const r of replacements) {
      const key = `${r.start}:${r.end}`;
      if (!seen.has(key)) { seen.add(key); unique.push(r); }
    }
    unique.sort((a, b) => b.start - a.start);

    let out = code;
    for (const r of unique) out = out.slice(0, r.start) + r.text + out.slice(r.end);
    return { code: out, patchedGuards: unique.length };
  }

  function transformHtml(html) {
    let patchedGuards = 0;
    const transformed = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (full, attrs, body) => {
      // External scripts have no inline application body to transform.
      if (/\bsrc\s*=/.test(attrs)) return full;
      const result = transformScript(body);
      patchedGuards += result.patchedGuards;
      return `<script${attrs}>${result.code}</script>`;
    });
    return { html: transformed, patchedGuards };
  }

  window.RoomScannerSourceTransformer = { transformHtml, transformScript, GATE_MESSAGES: GATE_MESSAGES.slice() };
})();
