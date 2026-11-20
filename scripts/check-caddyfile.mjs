#!/usr/bin/env node
// Checks the production Caddyfile (deploy/caddy/Caddyfile, #5091). Every
// rate limit keys on the client IP that Caddy derives from it (#5081).
//
//   node scripts/check-caddyfile.mjs [file]
//     Every reverse_proxy imports the client_ip_upstream snippet, so the
//     upstream sees exactly one X-Forwarded-For value and the real
//     X-Forwarded-Host. Every app proxy balances a replica pool whose event
//     streams pass unbuffered and outlive the 75 s client watchdog (#7226).
//     Runs in CI.
//   node scripts/check-caddyfile.mjs --cloudflare [file]
//     Additionally compares trusted_proxies with Cloudflare's published
//     ranges and prints the difference plus the corrected line. A new edge
//     range missing here makes Caddy log Cloudflare IPs as client IPs.
//     Runs weekly in caddy-cloudflare-ranges.yml.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const defaultCaddyfile = fileURLToPath(new URL('../deploy/caddy/Caddyfile', import.meta.url));
export const cloudflareLists = ['https://www.cloudflare.com/ips-v4', 'https://www.cloudflare.com/ips-v6'];
const cidr = /^(?:\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}|[0-9a-f:]+:[0-9a-f:]*\/\d{1,3})$/i;

// Quoted strings and comments carry no Caddyfile structure.
function structural(line) {
  return line.replace(/`[^`]*`|"(?:[^"\\]|\\.)*"/g, '""').replace(/(^|\s)#.*$/, '$1').trim();
}

// One entry per source line, so line numbers stay. A heredoc body (the
// maintenance page, with CSS and script braces) is text, not structure.
function structuralLines(source) {
  let marker = null;
  return source.split(/\r?\n/).map(raw => {
    if (marker) {
      const end = raw.trim().split(/\s/)[0] === marker;
      if (end) marker = null;
      return end ? '""' : '';
    }
    const line = structural(raw);
    marker = /<<(\w+)$/.exec(line)?.[1] ?? null;
    return line;
  });
}

// Behind trusted Cloudflare, Caddy passes client-sent forwarding headers
// through; the frontend trusts these for tenant and portal isolation.
export const upstreamHeaders = [
  'header_up X-Forwarded-For {client_ip}',
  'header_up X-Forwarded-Host {host}',
  'header_up -X-Moto-Original-*',
];

export function checkReverseProxies(source) {
  const lines = structuralLines(source);
  const errors = [];
  let count = 0;
  lines.forEach((line, index) => {
    if (!/^reverse_proxy(\s|$)/.test(line)) return;
    count++;
    const where = `line ${index + 1}: ${line}`;
    if (!line.endsWith('{')) {
      errors.push(`${where} has no block; it must contain "import client_ip_upstream".`);
      return;
    }
    let depth = 0;
    let imported = false;
    for (let i = index; i < lines.length; i++) {
      if (i > index && depth === 1 && lines[i] === 'import client_ip_upstream') imported = true;
      for (const char of lines[i]) depth += char === '{' ? 1 : char === '}' ? -1 : 0;
      if (depth <= 0) break;
    }
    if (!imported) errors.push(`${where} does not import client_ip_upstream.`);
  });
  if (count === 0) errors.push('No reverse_proxy found; is this the right Caddyfile?');
  const start = lines.findIndex(line => /^\(client_ip_upstream\)\s*\{$/.test(line));
  if (start < 0) {
    errors.push('The (client_ip_upstream) snippet is missing.');
    return errors;
  }
  const end = lines.indexOf('}', start);
  const directives = lines.slice(start + 1, end < 0 ? undefined : end);
  for (const required of upstreamHeaders) {
    if (!directives.includes(required)) errors.push(`The (client_ip_upstream) snippet lacks "${required}".`);
  }
  return errors;
}

// The fixed ports of the moto apps; each must sit in a replica pool (#7226).
export const appPorts = ['3000', '3001', '8080', '8081'];
const watchdogSeconds = 75;

function blockOf(lines, start) {
  const block = [];
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    if (i > start) block.push(lines[i]);
    for (const char of lines[i]) depth += char === '{' ? 1 : char === '}' ? -1 : 0;
    if (depth <= 0) break;
  }
  return block;
}

function seconds(duration) {
  const match = /^(\d+)(ms|s|m|h)$/.exec(duration);
  if (!match) return null;
  return Number(match[1]) * { ms: 0.001, s: 1, m: 60, h: 3600 }[match[2]];
}

// Replica pools (#7226): every reverse_proxy that reaches an app imports
// (replica_pool) with a health URI and names more than one upstream; the
// snippet balances, health-checks and flushes event streams at once; no
// timeout cuts a stream before the client watchdog would.
export function checkReplicaPools(source) {
  const lines = structuralLines(source);
  const errors = [];
  lines.forEach((line, index) => {
    if (!/^reverse_proxy\s/.test(line)) return;
    const upstreams = line.replace(/\{$/, '').trim().split(/\s+/).slice(1);
    if (!upstreams.some(upstream => appPorts.includes(upstream.split(':').pop()))) return;
    const where = `line ${index + 1}: ${line}`;
    if (upstreams.length < 2) errors.push(`${where} names one upstream; an app proxy balances a replica pool.`);
    const block = line.endsWith('{') ? blockOf(lines, index) : [];
    if (!block.some(entry => /^import replica_pool \/\S*health$/.test(entry))) {
      errors.push(`${where} does not import replica_pool with a health URI.`);
    }
  });
  const start = lines.findIndex(line => /^\(replica_pool\)\s*\{$/.test(line));
  if (start < 0) {
    errors.push('The (replica_pool) snippet is missing.');
  } else {
    const directives = blockOf(lines, start);
    for (const required of ['flush_interval -1', 'health_uri {args[0]}', 'lb_try_duration 5s']) {
      if (!directives.includes(required)) errors.push(`The (replica_pool) snippet lacks "${required}".`);
    }
  }
  lines.forEach((line, index) => {
    const timeout = /^(idle|read_timeout|write_timeout|stream_timeout|read|write)\s+(\S+)$/.exec(line);
    if (!timeout) return;
    const value = seconds(timeout[2]);
    if (value !== null && value <= watchdogSeconds) {
      errors.push(`line ${index + 1}: ${line} ends streams within the ${watchdogSeconds} s client watchdog.`);
    }
  });
  return errors;
}

export function trustedProxies(source) {
  const line = structuralLines(source).find(l => /^trusted_proxies\s+static(\s|$)/.test(l));
  if (!line) throw new Error('No "trusted_proxies static" line found.');
  return line.split(/\s+/).slice(2);
}

export function parseRangeList(text, url) {
  const ranges = text.split(/\s+/).filter(Boolean);
  const invalid = ranges.filter(range => !cidr.test(range));
  if (ranges.length === 0 || invalid.length) {
    throw new Error(`${url} did not return a CIDR list (${invalid.length ? `got "${invalid[0].slice(0, 60)}"` : 'empty'}).`);
  }
  return ranges;
}

export function diffRanges(configured, published) {
  const norm = range => range.toLowerCase();
  const have = new Set(configured.map(norm));
  const want = new Set(published.map(norm));
  return {
    missing: published.filter(range => !have.has(norm(range))),
    extra: configured.filter(range => !want.has(norm(range))),
  };
}

export function formatRangeDiff({ missing, extra }, published, file) {
  if (!missing.length && !extra.length) return '';
  return [
    `trusted_proxies in ${file} differ from https://www.cloudflare.com/ips/:`,
    ...missing.map(range => `+ ${range}   (published by Cloudflare, missing in the Caddyfile)`),
    ...extra.map(range => `- ${range}   (in the Caddyfile, no longer published)`),
    '',
    'Corrected line:',
    `\t\ttrusted_proxies static ${published.join(' ')}`,
  ].join('\n');
}

async function fetchPublished(fetchImpl = fetch) {
  const lists = await Promise.all(cloudflareLists.map(async url => {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}.`);
    return parseRangeList(await response.text(), url);
  }));
  return lists.flat();
}

export async function main(args, { fetchImpl, log = console.log, error = console.error } = {}) {
  const compare = args.includes('--cloudflare');
  const file = args.find(arg => !arg.startsWith('--')) ?? defaultCaddyfile;
  const source = readFileSync(file, 'utf8');
  const errors = [...checkReverseProxies(source), ...checkReplicaPools(source)];
  for (const message of errors) error(message);
  if (compare) {
    const published = await fetchPublished(fetchImpl);
    const diff = formatRangeDiff(diffRanges(trustedProxies(source), published), published, file);
    if (diff) {
      error(diff);
      errors.push(diff);
    } else {
      log(`trusted_proxies match Cloudflare's ${published.length} published ranges.`);
    }
  }
  if (!errors.length) log(`${file}: every reverse_proxy imports client_ip_upstream; every app proxy balances a replica pool.`);
  return errors.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, err => {
    console.error(err.message);
    process.exitCode = 2;
  });
}
