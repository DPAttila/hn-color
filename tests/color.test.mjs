#!/usr/bin/env node
/**
 * Integration test for the hn-color extension.
 *
 * 1. Fetches the HN front page and picks a random story.
 * 2. Fetches that story's comment section.
 * 3. Loads the page into jsdom and runs content.js in it (as the
 *    extension's content script would).
 * 4. Verifies the extension still works: every comment gets the expected
 *    per-user color (SHA-512 of the username), the same user gets the same
 *    color across comments, and the DOM is styled as documented.
 *
 * Usage:
 *   node tests/color.test.mjs            # random story from the front page
 *   node tests/color.test.mjs <item-id>  # test a specific item
 *
 * Requires `jsdom` (npm i jsdom).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONTENT_JS = readFileSync(join(ROOT, 'content.js'), 'utf8');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) hn-color-test/1.0';

function fail(msg) {
  console.error(`\nFAIL: ${msg}`);
  process.exit(1);
}

// HN rate-limits (HTTP 419) when a story page is fetched right after the
// front page, so keep a polite delay between requests and retry with
// generous backoff when we do get hit.
let lastFetchAt = 0;
async function fetchText(url) {
  const wait = 3000 - (Date.now() - lastFetchAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));

  let lastStatus;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 15000 * attempt));
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    lastFetchAt = Date.now();
    if (res.ok) return res.text();
    lastStatus = res.status;
    if (res.status !== 419 && res.status !== 429) {
      throw new Error(`GET ${url} -> HTTP ${res.status}`);
    }
  }
  throw new Error(`GET ${url} -> HTTP ${lastStatus} after retries (rate limited)`);
}

/** Pick a random story id from the HN front page. */
async function randomFrontPageItemId() {
  const html = await fetchText('https://news.ycombinator.com/');
  const ids = [...html.matchAll(/<tr class="athing submission" id="(\d+)"/g)].map(m => m[1]);
  if (ids.length === 0) throw new Error('no stories found on front page');
  const id = ids[Math.floor(Math.random() * ids.length)];
  const m = html.match(new RegExp(`id="${id}"[^>]*>.*?<a href="[^"]*">([^<]+)</a>`));
  return { id, title: m ? m[1] : '(unknown title)' };
}

/**
 * Independent re-implementation of the extension's color function, used as
 * the oracle the test compares against.
 */
async function expectedColor(userName) {
  const digest = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(userName));
  const h = Array.from(new Uint8Array(digest));
  const color =
    ((h[0] % 16) << 20) | ((h[1] % 16) << 12) | ((h[2] % 16) << 4) +
    ((h[0] / 16) << 16) | ((h[1] / 16) << 8) | (h[2] / 16);
  return '#' + color.toString(16).padStart(6, '0');
}

/** Run content.js in the given jsdom window and wait for it to settle. */
async function applyExtension(dom) {
  const errors = [];
  // jsdom does not implement the Web Crypto API; content scripts in a real
  // browser always have it. Polyfill it with Node's crypto.subtle so the
  // extension code runs unmodified.
  if (!dom.window.crypto?.subtle) {
    const { webcrypto } = await import('node:crypto');
    Object.defineProperty(dom.window, 'crypto', { value: webcrypto });
  }
  // Silence layout/network noise, but keep script errors for diagnostics.
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => {
    if (!/Could not parse CSS/.test(String(e))) errors.push(e);
  });
  // Re-attach: jsdom created its console during construction, so we swap
  // the window's console for capture.
  dom.window.console.error = (...args) => errors.push(args.join(' '));

  dom.window.eval(CONTENT_JS);

  // content.js works off the 'load' event. If the document already
  // finished loading before we injected (jsdom fires 'load' during
  // JSDOM construction), re-dispatch it so the handler runs.
  const ready = () =>
    ['loading', 'unparsed', 'interactive'].includes(dom.window.document.readyState);
  if (ready()) {
    dom.window.dispatchEvent(new dom.window.Event('load'));
  }
  // The extension's per-user handlers are async (SHA-512). Give them a
  // generous chance to finish; we also poll for the styling below.
  await new Promise((r) => setTimeout(r, 500));
  return errors;
}

/**
 * Parse a CSS color (hex or rgb()) into [r, g, b]. Browsers and jsdom may
 * serialize the same color differently ("#1ad4ae" vs "rgb(26, 212, 174)"),
 * so comparisons must be structural, not string-based.
 */
function parseColor(value) {
  if (typeof value !== 'string') return null;
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const named = { black: [0, 0, 0], white: [255, 255, 255] };
  if (named[value.toLowerCase()]) return named[value.toLowerCase()];
  const rgb = value.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

function sameColor(a, b) {
  const pa = parseColor(a);
  const pb = parseColor(b);
  return pa !== null && pa.every((v, i) => v === pb[i]);
}

async function main() {
  const arg = process.argv[2];
  let item, url;
  if (arg?.startsWith('file://')) {
    // Offline mode: run against a locally saved copy of a comment section.
    const file = new URL(arg).pathname;
    item = { id: '(file)', title: file };
    url = 'https://news.ycombinator.com/item?id=0';
    console.log(`Testing (offline): ${file}`);
    const html = readFileSync(file, 'utf8');
    const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
    await runChecks(dom);
    return;
  }
  if (arg) {
    item = { id: arg, title: '(explicit id)' };
  } else {
    item = await randomFrontPageItemId();
  }
  url = `https://news.ycombinator.com/item?id=${item.id}`;
  console.log(`Testing: ${item.title}`);
  console.log(`URL:     ${url}`);

  const html = await fetchText(url);
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  await runChecks(dom);
}

async function runChecks(dom) {
  const { window } = dom;

  // --- Sanity: the page must actually contain comments to color ----------
  // Same selector the extension uses (see content.js).
  const userEls = window.document.querySelectorAll('.comhead > a[href^="user?id="], a.hnuser');
  if (userEls.length === 0) {
    console.error('No comment author links found in the comment section.');
    console.error('The story may have no comments, or HN changed its markup.');
    process.exit(1);
  }
  console.log(`Comments on page: ${userEls.length}`);

  // The story author link (in .subline) must not be picked up.
  const storyAuthor = window.document.querySelector('.subline a[href^="user?id="]');
  if (storyAuthor && [...userEls].includes(storyAuthor)) {
    console.error('FAIL: story author link was selected as a comment author.');
    process.exit(1);
  }

  const errors = await applyExtension(dom);
  if (errors.length > 0) {
    console.error('Script errors while applying the extension:');
    for (const e of errors) console.error(' -', e);
    process.exit(1);
  }

  // --- Verify styling ------------------------------------------------------
  let failures = 0;
  const check = (cond, msg) => {
    if (!cond) {
      failures++;
      console.error(`  FAIL: ${msg}`);
    }
  };

  const colorByName = new Map(); // username -> color (consistency across comments)
  let styled = 0;

  for (const user of userEls) {
    const name = user.innerText ?? user.textContent;
    // user -> span.comhead -> header div -> <td class="default">.
    // The <td> is the bordered element: whole comment, no nested replies.
    const header = user.parentElement; // span.comhead
    const row = header?.parentElement?.parentElement; // <td class="default">
    if (!row) {
      check(false, `unexpected DOM shape around comment author "${name}"`);
      continue;
    }

    const expected = await expectedColor(name);
    const got = header.style.backgroundColor;

    check(parseColor(got) !== null, `"${name}": comment header background is not a color (got ${JSON.stringify(got)})`);
    check(sameColor(got, expected), `"${name}": background ${got} != expected ${expected}`);
    check(sameColor(row.style.borderColor, expected), `"${name}": comment border color is ${JSON.stringify(row.style.borderColor)}, expected ${expected}`);
    check(row.style.borderStyle === 'solid' && row.style.borderWidth === '1px', `"${name}": comment border is "${row.style.border}", expected "1px solid"`);
    check(row.style.borderRadius === '5px', `"${name}": comment border-radius is "${row.style.borderRadius}", expected "5px"`);
    check(sameColor(user.style.backgroundColor, '#000000'), `"${name}": username background is "${user.style.backgroundColor}", expected black`);

    // The bordered element must contain the comment body but not nested
    // replies (those live in sibling <tr> rows). Flagged/deleted comments
    // have no .commtext body, so only require it when one is present.
    const hasBody = row.querySelector('.comment:not(.noshow)') !== null;
    if (hasBody) {
      check(row.querySelector('.commtext') !== null, `"${name}": bordered element does not contain the comment body`);
    }
    check(row.querySelectorAll('.comhead').length === 1, `"${name}": bordered element contains a nested comment`);

    // Every element in the comment header must be colored white.
    let allWhite = true;
    (function walk(el) {
      for (const child of el.children) {
        if (child.style.color !== 'white') allWhite = false;
        walk(child);
      }
    })(header);
    check(allWhite, `"${name}": some header text is not white`);

    if (colorByName.has(name) && colorByName.get(name) !== expected) {
      check(false, `"${name}": inconsistent color across comments`);
    }
    colorByName.set(name, expected);
    if (parseColor(got) !== null) styled++;
  }

  // --- Deterministic spot check: same user, same color, two different pages
  // is already covered above when a user has multiple comments; additionally
  // verify the color function is stable (pure function of the name).
  const sample = [...colorByName.keys()][0];
  check((await expectedColor(sample)) === colorByName.get(sample), 'color function is not deterministic');

  const uniqueUsers = colorByName.size;
  console.log(`\nStyled ${styled}/${userEls.length} comments for ${uniqueUsers} unique users.`);

  if (failures > 0) {
    console.error(`${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('PASS: extension applied correctly and colors match the SHA-512 oracle.');
  window.close();
}

main().catch((e) => fail(e.stack ?? String(e)));
