/*
 * Room Scanner v9 - conservative calibration-gate transformer (v2)
 *
 * Differenze rispetto alla prima versione:
 * - non usa una regex per cercare gli `if` dentro stringhe/commenti;
 * - modifica solo script JavaScript inline classici;
 * - individua gli if con uno scanner lessicale che ignora stringhe, commenti,
 *   template literal e (con euristica conservativa) regex literal;
 * - dopo la modifica valida la sintassi con Function(): se l'originale era
 *   valido ma la versione patchata non lo è, lascia QUELLO SCRIPT intatto.
 *
 * Lo scopo è fallire "aperto" sulla UI originale, non rompere il bootstrap.
 */
(function installRoomScannerSourceTransformerV2() {
  'use strict';
  if (window.RoomScannerSourceTransformer && window.RoomScannerSourceTransformer.version === '20260815-2') return;

  const VERSION = '20260815-2';
  const GATE_MESSAGES = [
    'completa prima la calibrazione acustica',
    'calibrazione acustica non valida',
    'calibrazione acustica valida richiesta',
    'serve una calibrazione acustica',
    'calibrazione non valida',
    'audio calibration required',
    'complete acoustic calibration first'
  ];

  const REGEX_PREFIX_WORDS = new Set([
    'return','throw','case','delete','void','typeof','instanceof','in','of','yield','await','else','do'
  ]);

  function isIdentStart(ch) { return /[A-Za-z_$]/.test(ch || ''); }
  function isIdentPart(ch) { return /[A-Za-z0-9_$]/.test(ch || ''); }

  function skipLineComment(code, i) {
    i += 2;
    while (i < code.length && code[i] !== '\n' && code[i] !== '\r') i += 1;
    return i;
  }

  function skipBlockComment(code, i) {
    i += 2;
    while (i + 1 < code.length && !(code[i] === '*' && code[i + 1] === '/')) i += 1;
    return i + (i + 1 < code.length ? 2 : 0);
  }

  function readQuoted(code, i, quote) {
    const start = i;
    i += 1;
    while (i < code.length) {
      if (code[i] === '\\') { i += 2; continue; }
      if (code[i] === quote) return { start, end: i + 1, valueStart: start + 1, valueEnd: i, kind: 'string' };
      if ((code[i] === '\n' || code[i] === '\r') && quote !== '`') break;
      i += 1;
    }
    return { start, end: i, valueStart: start + 1, valueEnd: i, kind: 'unterminated' };
  }

  function skipTemplate(code, i) {
    // Conservative: skip the entire template literal. This intentionally does
    // not inspect JS inside ${...}; a calibration gate written inside a template
    // expression is simply not patched rather than risk corrupting the source.
    i += 1;
    while (i < code.length) {
      if (code[i] === '\\') { i += 2; continue; }
      if (code[i] === '`') return i + 1;
      i += 1;
    }
    return i;
  }

  function canStartRegex(lastToken) {
    if (!lastToken) return true;
    if (lastToken.type === 'word') return REGEX_PREFIX_WORDS.has(lastToken.value);
    if (lastToken.type === 'number' || lastToken.type === 'string' || lastToken.value === ')' || lastToken.value === ']' || lastToken.value === '}') return false;
    return /^(\(|\{|\[|=|:|,|;|!|\?|\+|-|\*|%|&|\||\^|~|<|>)$/.test(lastToken.value);
  }

  function skipRegex(code, i) {
    i += 1;
    let inClass = false;
    while (i < code.length) {
      const ch = code[i];
      if (ch === '\\') { i += 2; continue; }
      if (ch === '[') { inClass = true; i += 1; continue; }
      if (ch === ']' && inClass) { inClass = false; i += 1; continue; }
      if (ch === '/' && !inClass) {
        i += 1;
        while (/[A-Za-z]/.test(code[i] || '')) i += 1;
        return i;
      }
      if (ch === '\n' || ch === '\r') return i;
      i += 1;
    }
    return i;
  }

  function skipSpaceAndComments(code, i) {
    while (i < code.length) {
      if (/\s/.test(code[i])) { i += 1; continue; }
      if (code[i] === '/' && code[i + 1] === '/') { i = skipLineComment(code, i); continue; }
      if (code[i] === '/' && code[i + 1] === '*') { i = skipBlockComment(code, i); continue; }
      break;
    }
    return i;
  }

  function scanBalanced(code, openPos, openChar, closeChar) {
    let depth = 0;
    let lastToken = null;
    for (let i = openPos; i < code.length;) {
      const ch = code[i];
      const next = code[i + 1];
      if (/\s/.test(ch)) { i += 1; continue; }
      if (ch === '/' && next === '/') { i = skipLineComment(code, i); continue; }
      if (ch === '/' && next === '*') { i = skipBlockComment(code, i); continue; }
      if (ch === '"' || ch === "'") {
        const q = readQuoted(code, i, ch); i = q.end; lastToken = { type:'string', value:'string' }; continue;
      }
      if (ch === '`') { i = skipTemplate(code, i); lastToken = { type:'string', value:'template' }; continue; }
      if (ch === '/' && canStartRegex(lastToken)) { i = skipRegex(code, i); lastToken = { type:'regex', value:'regex' }; continue; }
      if (isIdentStart(ch)) {
        let j = i + 1; while (j < code.length && isIdentPart(code[j])) j += 1;
        lastToken = { type:'word', value:code.slice(i,j) }; i = j; continue;
      }
      if (/[0-9]/.test(ch)) {
        let j = i + 1; while (j < code.length && /[A-Za-z0-9_.]/.test(code[j])) j += 1;
        lastToken = { type:'number', value:code.slice(i,j) }; i = j; continue;
      }
      if (ch === openChar) depth += 1;
      if (ch === closeChar) {
        depth -= 1;
        if (depth === 0) return i;
      }
      lastToken = { type:'punct', value:ch };
      i += 1;
    }
    return -1;
  }

  function collectIfBlocks(code) {
    const blocks = [];
    let lastToken = null;
    for (let i = 0; i < code.length;) {
      const ch = code[i], next = code[i + 1];
      if (/\s/.test(ch)) { i += 1; continue; }
      if (ch === '/' && next === '/') { i = skipLineComment(code, i); continue; }
      if (ch === '/' && next === '*') { i = skipBlockComment(code, i); continue; }
      if (ch === '"' || ch === "'") { const q = readQuoted(code,i,ch); i=q.end; lastToken={type:'string',value:'string'}; continue; }
      if (ch === '`') { i=skipTemplate(code,i); lastToken={type:'string',value:'template'}; continue; }
      if (ch === '/' && canStartRegex(lastToken)) { i=skipRegex(code,i); lastToken={type:'regex',value:'regex'}; continue; }
      if (isIdentStart(ch)) {
        let j=i+1; while (j<code.length && isIdentPart(code[j])) j+=1;
        const word=code.slice(i,j);
        if (word === 'if') {
          let p=skipSpaceAndComments(code,j);
          if (code[p] === '(') {
            const closeParen=scanBalanced(code,p,'(',')');
            if (closeParen >= 0) {
              let b=skipSpaceAndComments(code,closeParen+1);
              if (code[b] === '{') {
                const closeBrace=scanBalanced(code,b,'{','}');
                if (closeBrace >= 0) {
                  blocks.push({ ifPos:i, openParen:p, closeParen, openBrace:b, closeBrace });
                }
              }
            }
          }
        }
        lastToken={type:'word',value:word}; i=j; continue;
      }
      lastToken={type:'punct',value:ch}; i+=1;
    }
    return blocks;
  }

  function collectGateStringPositions(code) {
    const found = [];
    let lastToken = null;
    for (let i=0;i<code.length;) {
      const ch=code[i], next=code[i+1];
      if (/\s/.test(ch)) { i+=1; continue; }
      if (ch==='/' && next==='/') { i=skipLineComment(code,i); continue; }
      if (ch==='/' && next==='*') { i=skipBlockComment(code,i); continue; }
      if (ch==='"' || ch==="'") {
        const q=readQuoted(code,i,ch);
        const raw=code.slice(q.valueStart,q.valueEnd).toLowerCase();
        if (GATE_MESSAGES.some((m)=>raw.includes(m))) found.push(q.start);
        i=q.end; lastToken={type:'string',value:'string'}; continue;
      }
      if (ch==='`') { i=skipTemplate(code,i); lastToken={type:'string',value:'template'}; continue; }
      if (ch==='/' && canStartRegex(lastToken)) { i=skipRegex(code,i); lastToken={type:'regex',value:'regex'}; continue; }
      if (isIdentStart(ch)) { let j=i+1; while(j<code.length&&isIdentPart(code[j]))j+=1; lastToken={type:'word',value:code.slice(i,j)}; i=j; continue; }
      lastToken={type:'punct',value:ch}; i+=1;
    }
    return found;
  }

  function transformScript(code) {
    const blocks = collectIfBlocks(code);
    const messages = collectGateStringPositions(code);
    const chosen = new Map();

    for (const pos of messages) {
      const containing = blocks
        .filter((b) => pos > b.openBrace && pos < b.closeBrace)
        .sort((a,b) => (a.closeBrace-a.openBrace) - (b.closeBrace-b.openBrace));
      if (!containing.length) continue;
      const gate = containing[0];
      const condition = code.slice(gate.openParen + 1, gate.closeParen);
      if (condition.includes('__RS_ALLOW_UNCALIBRATED__')) continue;
      chosen.set(`${gate.openParen}:${gate.closeParen}`, gate);
    }

    const replacements = Array.from(chosen.values()).map((gate) => ({
      start: gate.openParen + 1,
      end: gate.closeParen,
      text: `!window.__RS_ALLOW_UNCALIBRATED__ && (${code.slice(gate.openParen + 1, gate.closeParen)})`
    })).sort((a,b)=>b.start-a.start);

    let out=code;
    for (const r of replacements) out=out.slice(0,r.start)+r.text+out.slice(r.end);
    return { code:out, patchedGuards:replacements.length };
  }

  function isClassicInlineScript(attrs) {
    if (/\bsrc\s*=/.test(attrs)) return false;
    const m = attrs.match(/\btype\s*=\s*(["'])(.*?)\1/i);
    if (!m) return true;
    const type = m[2].trim().toLowerCase();
    return type === '' || type === 'text/javascript' || type === 'application/javascript' || type === 'text/ecmascript' || type === 'application/ecmascript';
  }

  function syntaxSafe(original, patched) {
    if (original === patched) return true;
    try {
      // Validate only when the original itself is valid as a classic script.
      // Function() does not execute the source.
      new Function(original);
    } catch (_) {
      return false;
    }
    try {
      new Function(patched);
      return true;
    } catch (_) {
      return false;
    }
  }

  function transformHtml(html) {
    let patchedGuards=0;
    let skippedScripts=0;
    const transformed=html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi,(full,attrs,body)=>{
      if (!isClassicInlineScript(attrs)) return full;
      const result=transformScript(body);
      if (!result.patchedGuards) return full;
      if (!syntaxSafe(body,result.code)) {
        skippedScripts += 1;
        return full;
      }
      patchedGuards += result.patchedGuards;
      return `<script${attrs}>${result.code}</script>`;
    });
    return { html:transformed, patchedGuards, skippedScripts, version:VERSION };
  }

  window.RoomScannerSourceTransformer={ version:VERSION, transformHtml, transformScript, GATE_MESSAGES:GATE_MESSAGES.slice() };
})();
