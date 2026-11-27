#!/usr/bin/env node
// Checks the form of address in German texts that moto writes itself (ADR
// 0328: the portals say „du“, what moto sends out says „Sie“).
//
//   node scripts/check-anrede.mjs
//
// Scans the whole tree in about a second: the German message files, help
// articles, components and stories under frontend/src and frontend/.storybook,
// the e-mail templates and the string literals of the Go code. Code comments,
// tests and the demo and seed data under backend/internal/devtools stay out.
//
// Portal texts (every scanned file outside OUTGOING): a hit is „Ihnen“
// anywhere, and „Sie“ or „Ihr/Ihre/Ihrem/Ihren/Ihrer/Ihres“ inside a
// sentence. A sentence starts at the beginning of a text, after „. ! ? : …“
// (not after „z. B.“ and similar) or a block tag. There both can be the third
// person („Sie lässt sich nicht ändern.“) or the plural „Ihr könnt …“, so they
// pass. Lower-case „sie/ihr“ is the third person or the plural and always
// passes. A placeholder ({{.Name}}, ${…}, JSX {…}) may hold a whole sentence,
// so a word right after it counts as a sentence start.
//
// Outgoing texts (the e-mail templates and the Go files in OUTGOING, which
// write mails and letters): a hit is a du- or ihr-form anywhere: „du“,
// „dich“, „dir“, „dein…“, „euch“, „euer/eure…“, lower-case „ihr“ and the verb
// forms in INFORMAL. Capitalised „Ihr …“ is the Sie-form and passes.
//
// In both, text inside German quotation marks („…“, »…«) quotes others and
// passes.
//
// Texts whose wording is bound (ADR 0328, Ausnahmen) carry a marker in a
// comment at the end of the string's line or alone on the line above it:
// „sie-anrede-erlaubt (ADR 0328): <Grund>“ in a portal text,
// „du-anrede-erlaubt (ADR 0328): <Grund>“ in an outgoing text, also for a
// lower-case „ihr“ of the third person („setzt ihr Passwort“). The marker
// covers that one line and the lines indented deeper below it, up to the
// closing bracket or tag (markerLines). JSON has no comments, so its
// exceptions are listed per key in JSON_EXCEPTIONS below. A marker or list
// entry that no longer covers a hit fails, so exceptions cannot outlive their
// text.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MARKER = /sie-anrede-erlaubt \(ADR 0328\):\s*\S/;
export const DU_MARKER = /du-anrede-erlaubt \(ADR 0328\):\s*\S/;

// Message keys whose German wording is bound by ADR 0328, Ausnahmen.
export const JSON_EXCEPTIONS = [];

// Go files whose literals are the text of mails and letters moto sends
// (ADR 0328). They say „Sie“; a file that also holds portal texts stays out
// and marks its mail texts with MARKER instead.
export const OUTGOING = new Set([
  'backend/cmd/devtools/command_mailpit.go',
  'backend/modules/carecontract/internal/application/letter.go',
  'backend/modules/carecontract/internal/application/mail.go',
  'backend/modules/carecontract/internal/application/notice_text.go',
  'backend/modules/carecontract/internal/application/signature_mail.go',
  'backend/modules/carecontract/internal/application/withdrawal_text.go',
  'backend/modules/communication/internal/parentmessages/message_email.go',
  'backend/modules/documentrendering/templates/catalog.go',
  'backend/modules/documentrendering/templates/sample.go',
  'backend/modules/enrollment/internal/application/mail_renderers.go',
  'backend/modules/identityaccess/guardian_care_notice_mails.go',
  'backend/modules/identityaccess/guardian_invitation_mails.go',
  'backend/modules/identityaccess/mails.go',
  'backend/modules/identityaccess/parent_security_mails.go',
  'backend/modules/parentbilling/internal/application/care_letter_meals.go',
  'backend/modules/parentbilling/internal/application/care_letter_text.go',
  'backend/modules/parentbilling/internal/application/care_notice_letter_text.go',
  'backend/modules/parentbilling/internal/application/letter_addressee.go',
  'backend/modules/parentbilling/internal/application/letter_correction_text.go',
  'backend/modules/parentbilling/internal/application/letter_mail.go',
  'backend/modules/parentbilling/internal/application/letter_text.go',
  'backend/modules/parentbilling/internal/application/mandate_text.go',
  'backend/modules/parentbilling/internal/application/payment_letter.go',
  'backend/modules/parentbilling/internal/application/transfer_code.go',
  'backend/modules/schoolcalendar/portal/internal/application/email.go',
  'backend/modules/workforce/internal/application/payroll_dispatch_mail.go',
]);

const FORMAL_ANYWHERE = /\b(Sie|Ihnen|Ihre?[mnrs]?)\b/;
// The du- and ihr-forms of an outgoing text, with the verb forms that only
// they use.
const INFORMAL = /(?<![\p{L}\p{N}_])([Dd]u|[Dd]ich|[Dd]ir|[Dd]ein|[Dd]eine[mnrs]?|[Ee]uch|[Ee]uer|[Ee]ure[mnrs]?|ihr|[Kk]annst|[Mm]usst|[Hh]ast|[Bb]ist|[Ww]irst|[Ff]indest|[Ee]rhältst|[Mm]öchtest|[Dd]arfst|[Ss]iehst|[Bb]rauchst|[Bb]ekommst|[Hh]abt|[Ss]eid|[Mm]üsst|[Kk]önnt|[Dd]ürft|[Ww]ollt|[Ss]ollt|[Ww]isst)(?![\p{L}\p{N}_])/gu;
// An imperative after „Bitte“ in the du- or ihr-form („Bitte öffne“, „Bitte
// öffnet“): the verbs moto's mails and letters ask for.
const INFORMAL_PLEASE = /(?<![\p{L}\p{N}_])[Bb]itte (prüfe|prüft|öffne|öffnet|lies|lest|gib|gebt|melde|meldet|wende|wendet|wähle|wählt|klicke|klickt|kopiere|kopiert|antworte|antwortet|beachte|beachtet|bestätige|bestätigt|unterschreibe|unterschreibt|überweise|überweist|nimm|nehmt|sieh|seht|denk|denke|denkt|schicke|schickt|trage|tragt|lade|ladet|nutze|nutzt|reiche|reicht|kümmere|kümmert|hebe|hebt|drucke|druckt|stimme|stimmt|lehne|lehnt|ändere|ändert|entferne|entfernt|scanne|scannt|bringe|bringt|gebe|speichere|speichert|schließe|schließt)(?![\p{L}\p{N}_])/gu;

const FORMAL = /(?<![\p{L}\p{N}_])(Sie|Ihnen|Ihr|Ihre|Ihrem|Ihren|Ihrer|Ihres)(?![\p{L}\p{N}_])/gu;
// Abbreviations whose dot does not end a sentence („z. B. Ihre …“).
const ABBREVIATIONS = new Set(['z', 'B', 'd', 'h', 'u', 'a', 'o', 's', 'bzw', 'ggf', 'ca', 'Nr', 'evtl', 'inkl', 'vgl', 'usw', 'etc', 'bspw', 'zzgl', 'max', 'min', 'gem', 'lt', 'Str']);
// Characters that may open a sentence without ending the one before.
const OPENERS = new Set([' ', '\t', '\r', '\n', ' ', '(', '[', '*', '_', '-', '–', '—', '•', '·', '#', '"', "'", '“', '‘', '`']);
// A colon ends a sentence („Eine Person fehlt: Sie hat …“), a semicolon not.
const SENTENCE_END = new Set(['.', '!', '?', ':', '…']);
// Inline markup continues the sentence; any other tag starts a new one.
const INLINE_TAGS = new Set(['a', 'b', 'strong', 'em', 'i', 'u', 'span', 'code', 'mark', 'small', 'abbr', 'link', 'trans']);

// Ranges inside German quotation marks on one line: „…“ (also closed by a
// straight quote), »…« and ‚…‘.
function quotedRanges(text) {
  const ranges = [];
  const pairs = { '„': ['“', '"'], '»': ['«'], '‚': ['‘'] };
  for (let index = 0; index < text.length; index++) {
    const closers = pairs[text[index]];
    if (!closers) continue;
    let end = index + 1;
    while (end < text.length && text[end] !== '\n' && !closers.includes(text[end])) end++;
    if (end >= text.length || text[end] === '\n') continue;
    ranges.push([index, end]);
    index = end;
  }
  return ranges;
}

// Whether the word at `index` opens a sentence. Walks back over whitespace,
// opening punctuation and inline tags.
function atSentenceStart(text, index) {
  let position = index - 1;
  for (;;) {
    while (position >= 0 && OPENERS.has(text[position])) {
      // A blank line ends a paragraph.
      if (text[position] === '\n') {
        let before = position - 1;
        while (before >= 0 && (text[before] === ' ' || text[before] === '\t' || text[before] === '\r')) before--;
        if (text[before] === '\n') return true;
      }
      position--;
    }
    if (position < 0) return true;
    const char = text[position];
    if (char === '>') {
      const open = text.lastIndexOf('<', position);
      const name = open >= 0 ? /^<\/?([A-Za-z][\w.-]*)/.exec(text.slice(open, position + 1))?.[1] : undefined;
      if (name && INLINE_TAGS.has(name.toLowerCase())) { position = open - 1; continue; }
      return true;
    }
    // A placeholder ({{.Name}}, ${…}, JSX {…}) stands for a word: look past it.
    // Whether one that opens the text holds a whole sentence is unknown, so
    // a placeholder without its opening brace in this text counts as a start.
    if (char === '}') {
      let depth = 0;
      let open = position;
      for (; open >= 0; open--) {
        if (text[open] === '}') depth++;
        else if (text[open] === '{' && --depth === 0) break;
      }
      if (open < 0) return true;
      while (open > 0 && text[open - 1] === '{') open--;
      if (text[open - 1] === '$') open--;
      position = open - 1;
      continue;
    }
    if (char === '.') {
      const word = /(?<![\p{L}\p{N}%$])(\p{L}+)$/u.exec(text.slice(Math.max(0, position - 12), position))?.[1];
      return !(word && ABBREVIATIONS.has(word));
    }
    return SENTENCE_END.has(char);
  }
}

// Informal address hits in one outgoing text: [{ index, word }].
export function findInformalAddress(text) {
  let quoted;
  const hits = [];
  for (const pattern of [INFORMAL, INFORMAL_PLEASE]) {
    for (const match of text.matchAll(pattern)) {
      quoted ??= quotedRanges(text);
      if (quoted.some(([start, end]) => match.index > start && match.index < end)) continue;
      hits.push({ index: match.index, word: match[1] ?? match[0] });
    }
  }
  return hits.sort((left, right) => left.index - right.index);
}

// The two directions of the check: a portal text must not say „Sie“, an
// outgoing one not „du“ or „ihr“.
export const PORTAL = { find: findFormalAddress, marker: MARKER, markerName: 'sie-anrede-erlaubt', wanted: 'Sie-Text' };
export const OUTGOING_TEXT = { find: findInformalAddress, marker: DU_MARKER, markerName: 'du-anrede-erlaubt', wanted: 'Du-Text' };

// Formal address hits in one text: [{ index, word }].
export function findFormalAddress(text) {
  let quoted;
  const hits = [];
  for (const match of text.matchAll(FORMAL)) {
    const { index } = match;
    quoted ??= quotedRanges(text);
    if (quoted.some(([start, end]) => index > start && index < end)) continue;
    if (match[1] !== 'Ihnen' && atSentenceStart(text, index)) continue;
    hits.push({ index, word: match[1] });
  }
  return hits;
}

// Line starts, for cheap offset → line lookups.
function lineIndex(source) {
  const starts = [0];
  for (let index = 0; index < source.length; index++) if (source.charCodeAt(index) === 10) starts.push(index + 1);
  return offset => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= offset) low = middle; else high = middle - 1;
    }
    return low + 1;
  };
}

const GO_ESCAPES = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', "'": "'" };
const JS_ESCAPES = { ...GO_ESCAPES, '`': '`', '\n': '' };

// A `//` or `/* */` comment at `index`: { text, offset, end }, or undefined.
function readComment(source, index) {
  if (source[index] !== '/' || (source[index + 1] !== '/' && source[index + 1] !== '*')) return undefined;
  // „https://“ in JSX text is no comment.
  if (source[index + 1] === '/' && source[index - 1] === ':') return undefined;
  const block = source[index + 1] === '*';
  const end = block ? source.indexOf('*/', index + 2) : source.indexOf('\n', index);
  const stop = end < 0 ? source.length : block ? end + 2 : end;
  return { text: source.slice(index, stop), offset: index, end: stop };
}

// A quoted literal opening at `index`, up to its closing quote or the end of
// the line: { text (escapes decoded), offset, end }.
function readQuoted(source, index, escapes) {
  const quote = source[index];
  let text = '';
  let position = index + 1;
  while (position < source.length && source[position] !== quote && source[position] !== '\n') {
    if (source[position] === '\\') {
      text += escapes[source[position + 1]] ?? source[position + 1];
      position += 2;
    } else {
      text += source[position++];
    }
  }
  return { text, offset: index, end: position + 1 };
}

// Go source → { texts: [{ text, offset }], comments: [{ text, offset, end }] }.
export function goTokens(source) {
  const texts = [];
  const comments = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const comment = readComment(source, index);
    if (comment) {
      comments.push(comment);
      index = comment.end;
    } else if (char === '`') {
      const end = source.indexOf('`', index + 1);
      const stop = end < 0 ? source.length : end;
      texts.push({ text: source.slice(index + 1, stop), offset: index, end: stop + 1, raw: true });
      index = stop + 1;
    } else if (char === '"' || char === "'") {
      // Rune literals ('x') hold no text.
      const literal = readQuoted(source, index, GO_ESCAPES);
      if (char === '"') texts.push(literal);
      index = literal.end;
    } else {
      index++;
    }
  }
  return { texts, comments };
}

// Not „}“: in JSX a slash after a placeholder is text („{done}/{total}“) or „/>“.
const REGEX_AFTER = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';', '+', '-', '*', '%', '~', '^']);
const REGEX_KEYWORDS = /(?:^|[^\w$])(return|typeof|case|in|of|void|delete|throw|new|yield|await)$/;
const IDENTIFIER = /[\p{L}\p{N}_$]/u;

// The end of a regex literal whose slash is at `index`, or -1 for a division.
// A regex literal follows an operator or keyword and closes on its line.
function regexLiteralEnd(source, index) {
  let lead = index - 1;
  while (lead >= 0 && /\s/.test(source[lead])) lead--;
  if (lead >= 0 && !REGEX_AFTER.has(source[lead]) && !REGEX_KEYWORDS.test(source.slice(Math.max(0, lead - 10), lead + 1))) return -1;
  let inClass = false;
  for (let position = index + 1; position < source.length && source[position] !== '\n'; position++) {
    const current = source[position];
    if (current === '\\') position++;
    else if (current === '[') inClass = true;
    else if (current === ']') inClass = false;
    else if (current === '/' && !inClass) return position + 1;
  }
  return -1;
}

// TypeScript/TSX source → { texts, comments }. Texts are string literals,
// template literals (placeholders become „{}“) and the code between them,
// which carries JSX text. Identifiers there never match: „Sie“ and „Ihr“ are
// not used as names.
export function scriptTokens(source) {
  const texts = [];
  const comments = [];
  let index = 0;
  let code = '';
  let codeOffset = 0;
  const flushCode = () => {
    if (code.trim()) texts.push({ text: code, offset: codeOffset, verbatim: true });
    code = '';
  };
  // Reads a template literal starting after the backtick; returns its text
  // with placeholders replaced by „{}“ and collects strings nested inside.
  const readTemplate = () => {
    const start = index - 1;
    let text = '';
    while (index < source.length && source[index] !== '`') {
      if (source[index] === '\\') {
        text += JS_ESCAPES[source[index + 1]] ?? source[index + 1];
        index += 2;
      } else if (source[index] === '$' && source[index + 1] === '{') {
        index += 2;
        readCode('}');
        text += '{}';
      } else {
        text += source[index++];
      }
    }
    index++;
    texts.push({ text, offset: start, end: index, raw: true });
  };
  // Reads code up to an unbalanced `until` brace (template placeholder) or the end.
  function readCode(until) {
    let depth = 0;
    while (index < source.length) {
      const char = source[index];
      if (until && char === '}' && depth === 0) { flushCode(); index++; return; }
      if (char === '{') depth++;
      if (char === '}') depth--;
      const comment = readComment(source, index);
      if (comment) {
        flushCode();
        comments.push(comment);
        index = comment.end;
        continue;
      }
      const before = index > 0 ? source[index - 1] : '';
      if (char === '`') {
        flushCode();
        index++;
        readTemplate();
        continue;
      }
      // A quote right after a letter is an apostrophe in JSX text („gibt's“):
      // no string literal can follow an identifier character.
      if ((char === '"' || char === "'") && !IDENTIFIER.test(before)) {
        flushCode();
        const literal = readQuoted(source, index, JS_ESCAPES);
        texts.push(literal);
        index = literal.end;
        continue;
      }
      const regexEnd = char === '/' ? regexLiteralEnd(source, index) : -1;
      if (regexEnd >= 0) {
        flushCode();
        index = regexEnd;
        continue;
      }
      if (!code) codeOffset = index;
      code += char;
      index++;
    }
    flushCode();
  }
  readCode();
  return { texts, comments };
}

// Go template / HTML e-mail → { texts, comments }: the whole file is text,
// with comments blanked out so offsets stay put.
export function templateTokens(source) {
  const comments = [];
  let text = source;
  for (const match of source.matchAll(/\{\{-?\s*\/\*[\s\S]*?\*\/\s*-?\}\}|<!--[\s\S]*?-->/g)) {
    comments.push({ text: match[0], offset: match.index, end: match.index + match[0].length });
    text = text.slice(0, match.index) + match[0].replace(/[^\n]/g, ' ') + text.slice(match.index + match[0].length);
  }
  return { texts: [{ text, offset: 0, verbatim: true }], comments };
}

const indentOf = text => /^[ \t]*/.exec(text)[0].length;

// The lines [from, until] a marker covers. A trailing marker starts at its own
// line, a marker alone on its line (also as JSX comment) at the next line
// that is not a comment. The range runs on over every line indented deeper
// than that first line, and over the closing line at its indent („}“, „)“,
// „]“, „</…“). gofmt and prettier keep that indentation; the inside of a
// multi-line literal counts as deeper.
function markerLines(source, lines, line, comment, literalLines) {
  const first = line(comment.offset);
  const lineStart = source.lastIndexOf('\n', comment.offset - 1) + 1;
  const alone = /^\s*\{?\s*$/.test(source.slice(lineStart, comment.offset));
  let start = alone ? line(comment.end - 1) + 1 : first;
  while (alone && start <= lines.length && /^\s*\{?\s*(\/\/|\/\*)/.test(lines[start - 1])) start++;
  // The marker sits directly at its text; a blank line in between covers nothing.
  if (start > lines.length || lines[start - 1].trim() === '') return [0, -1];
  const base = indentOf(lines[start - 1]);
  let until = start;
  for (let number = start + 1; number <= lines.length; number++) {
    const text = lines[number - 1];
    if (literalLines.has(number)) { until = number; continue; }
    if (text.trim() === '') continue;
    const indent = indentOf(text);
    if (indent > base) { until = number; continue; }
    if (indent === base && /^\s*(\}|\)|\]|<\/)/.test(text)) until = number;
    break;
  }
  return [start, until];
}

// Check concatenated literals as one text, keeping the original tokens so
// findings and exception markers still refer to their source lines. An
// expression between two „+“ („…uns (" + contact.details() + ") mittels…“)
// joins as the placeholder „{}“; a comma or brace in between ends the text.
function joinedTexts(source, texts) {
  const groups = texts.filter(token => token.verbatim).map(token => ({ text: token.text, parts: [{ token, start: 0 }] }));
  let group;
  let previous;
  for (const token of texts.filter(token => !token.verbatim).sort((a, b) => a.offset - b.offset)) {
    const gap = previous ? source.slice(previous.end, token.offset) : '';
    const operator = gap.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').trim();
    const joins = previous && previous.end <= token.offset && (operator === '+' || /^\+[^,;{}]*\+$/.test(operator));
    if (!joins) {
      group = { text: '', parts: [] };
      groups.push(group);
    } else if (operator !== '+') {
      group.text += '{}';
    }
    group.parts.push({ token, start: group.text.length });
    group.text += token.text;
    previous = token;
  }
  const order = new Map(texts.map((token, index) => [token, index]));
  return groups.sort((a, b) => order.get(a.parts[0].token) - order.get(b.parts[0].token));
}

// Applies the inline markers of one file to its hits.
// Returns { findings: [{ line, word, excerpt }], staleMarkers: [line] }.
export function checkTokens(source, { texts, comments }, rule = PORTAL) {
  const line = lineIndex(source);
  const markerComments = comments.filter(comment => rule.marker.test(comment.text));
  let markers = [];
  if (markerComments.length) {
    const lines = source.split('\n');
    const literalLines = new Set();
    for (const token of texts) {
      if (token.verbatim || token.end === undefined) continue;
      for (let number = line(token.offset) + 1; number <= line(token.end - 1); number++) literalLines.add(number);
    }
    markers = markerComments.map(comment => {
      const [from, until] = markerLines(source, lines, line, comment, literalLines);
      return { line: line(comment.offset), from, until, used: false };
    });
  }
  const hits = [];
  for (const group of joinedTexts(source, texts)) {
    for (const hit of rule.find(group.text)) {
      const part = group.parts.find(({ token, start }) => hit.index >= start && hit.index < start + token.text.length);
      const { token } = part;
      const index = hit.index - part.start;
      // Verbatim text (code, templates) sits in the source as is; a literal
      // counts by its first line, and only raw literals keep their line breaks.
      const start = token.verbatim ? line(token.offset + index) : line(token.offset);
      hits.push({
        group,
        verbatim: Boolean(token.verbatim),
        start,
        order: token.offset + index,
        line: token.verbatim || !token.raw ? start : start + lineCountBefore(token.text, index),
        word: hit.word,
        excerpt: excerpt(group.text, hit.index),
      });
    }
  }
  hits.sort((a, b) => a.order - b.order);
  // A marker covers one text: the first text with a hit in its lines. That is
  // one literal (with the literals joined to it by „+“), or the JSX/HTML text
  // of the element it stands above.
  const covered = new Set();
  for (const marker of markers) {
    const inRange = hits.filter(hit => hit.start >= marker.from && hit.start <= marker.until);
    if (!inRange.length) continue;
    const first = inRange[0];
    for (const hit of inRange) {
      if (first.verbatim ? hit.verbatim : hit.group === first.group) covered.add(hit);
    }
    marker.used = true;
  }
  const findings = hits.filter(hit => !covered.has(hit)).map(({ line: number, word, excerpt: text }) => ({ line: number, word, excerpt: text }));
  return { findings, staleMarkers: markers.filter(marker => !marker.used).map(marker => marker.line) };
}

function lineCountBefore(text, index) {
  let count = 0;
  for (let position = 0; position < index; position++) if (text.charCodeAt(position) === 10) count++;
  return count;
}

// JSON message file → [{ key, text }] for every string value.
function jsonTexts(value, prefix = '') {
  if (typeof value === 'string') return [{ key: prefix, text: value }];
  if (Array.isArray(value)) return value.flatMap((item, position) => jsonTexts(item, `${prefix}[${position}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => jsonTexts(item, prefix ? `${prefix}.${key}` : key));
  return [];
}

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.next', 'testdata', '__tests__', '__mocks__', 'test', 'tests', 'e2e']);

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) yield* walk(path);
    } else {
      yield path;
    }
  }
}

const TEST_FILE = /(\.test|\.spec|_test|\.node-test)\.[cm]?[jt]sx?$|_test\.go$|\.generated\.ts$|\.d\.ts$/;

// The kind of a repository-relative path, or undefined when the check skips it.
export function kindOf(file, outgoing = OUTGOING) {
  if (TEST_FILE.test(file)) return undefined;
  // Storybook's own fixtures render in stories as well.
  if (file.startsWith('frontend/.storybook/')) return /\.(ts|tsx)$/.test(file) ? 'script' : undefined;
  if (file.startsWith('frontend/src/')) {
    if (file.startsWith('frontend/src/i18n/messages/')) return file.startsWith('frontend/src/i18n/messages/de/') && file.endsWith('.json') ? 'json' : undefined;
    return /\.(ts|tsx)$/.test(file) ? 'script' : undefined;
  }
  if (!file.startsWith('backend/') || file.startsWith('backend/internal/devtools/')) return undefined;
  if (file.startsWith('backend/templates/email/') && /\.(html|txt|tmpl)$/.test(file)) return 'outgoing-template';
  if (outgoing.has(file)) return 'outgoing-go';
  return file.endsWith('.go') ? 'go' : undefined;
}

// The files the check reads, as repository-relative paths with their kind.
export function scannedFiles(root, outgoing = OUTGOING) {
  const files = [];
  for (const directory of ['frontend/src', 'frontend/.storybook', 'backend']) {
    for (const path of walk(join(root, directory))) {
      const file = relative(root, path).split(sep).join('/');
      const kind = kindOf(file, outgoing);
      if (kind) files.push({ file, kind });
    }
  }
  return files;
}

const TOKENIZERS = { go: goTokens, script: scriptTokens, 'outgoing-go': goTokens, 'outgoing-template': templateTokens };

// Problem lines of one file. JSON exceptions that matched are added to `used`.
export function checkSource(file, kind, source, exceptions = JSON_EXCEPTIONS, used = new Set()) {
  const rule = kind.startsWith('outgoing-') ? OUTGOING_TEXT : PORTAL;
  // A portal text without any formal word cannot hit; outgoing texts are few.
  if (rule === PORTAL && !FORMAL_ANYWHERE.test(source) && !MARKER.test(source)) return [];
  const problems = [];
  if (kind === 'json') {
    for (const { key, text } of jsonTexts(JSON.parse(source))) {
      const hits = findFormalAddress(text);
      if (!hits.length) continue;
      const exception = exceptions.find(entry => entry.file === file && entry.key === key);
      if (exception) { used.add(exception); continue; }
      for (const hit of hits) problems.push(`${file} ${key}: „${hit.word}“ in „${excerpt(text, hit.index)}“`);
    }
    return problems;
  }
  const { findings, staleMarkers } = checkTokens(source, TOKENIZERS[kind](source), rule);
  for (const finding of findings) problems.push(`${file}:${finding.line}: „${finding.word}“ in „${finding.excerpt}“`);
  for (const line of staleMarkers) problems.push(`${file}:${line}: Marker „${rule.markerName}“ deckt keinen ${rule.wanted} mehr ab; entfernen.`);
  return problems;
}

// Checks the tree. Returns sorted problem lines; empty when clean.
export function checkRepository(root, exceptions = JSON_EXCEPTIONS, outgoing = OUTGOING) {
  const used = new Set();
  const problems = scannedFiles(root, outgoing).flatMap(({ file, kind }) => checkSource(file, kind, readFileSync(join(root, file), 'utf8'), exceptions, used));
  for (const file of outgoing) {
    if (!existsSync(join(root, file))) problems.push(`${file}: steht in OUTGOING, gibt es aber nicht mehr; entfernen.`);
  }
  for (const exception of exceptions) {
    if (!used.has(exception)) problems.push(`${exception.file} ${exception.key}: Ausnahme in JSON_EXCEPTIONS deckt keinen Sie-Text mehr ab; entfernen.`);
  }
  return problems.sort();
}

function excerpt(text, index) {
  return text.slice(Math.max(0, index - 40), index + 40).replace(/\s+/g, ' ').trim();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const problems = checkRepository(root);
  if (problems.length) {
    console.error(`Falsche Anrede in deutschen Texten (ADR 0328: die Portale sagen „du“, Mails und Briefe „Sie“):\n${problems.map(problem => `  ${problem}`).join('\n')}`);
    console.error('\nPortaltexte stehen in der Du-Form, Mail-Vorlagen und die Dateien in OUTGOING (scripts/check-anrede.mjs) in der Sie-Form.\n' +
      'Ist der Wortlaut gebunden (ADR 0328, Ausnahmen), markiere ihn mit dem Kommentar „sie-anrede-erlaubt (ADR 0328): <Grund>“\n' +
      'im Portaltext oder „du-anrede-erlaubt (ADR 0328): <Grund>“ im ausgehenden Text (JSON: JSON_EXCEPTIONS).');
    process.exitCode = 1;
  } else {
    console.log('check-anrede: Anrede in deutschen Texten stimmt.');
  }
}
