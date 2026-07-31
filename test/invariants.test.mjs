/**
 * The promises this project makes, enforced as tests.
 *
 * The README says this tool never touches the network and never checks a
 * balance. The security tab says the same at more length. Prose does not stop
 * a regression: somebody adds `fetch` to "just quickly check something", and
 * now the tool is the thing it was written to replace.
 *
 * So the claims are assertions, they run in CI on every push, and a build that
 * breaks one does not ship. This file scans what actually reaches the browser:
 * the bundles under assets/, the offline single-file build, and the
 * first-party sources in src/.
 *
 * Note the division of labour:
 *   - Content-Security-Policy is what stops a *malicious* page. It binds at
 *     runtime, in the browser, no matter what the JavaScript wants.
 *   - This file is what stops an *honest mistake*. It binds at review time,
 *     before any browser is involved.
 * Neither replaces the other. This file cannot see through obfuscation —
 * globalThis["fet" + "ch"] parses as an ordinary member access — and that gap
 * is not worth closing here, because anyone who can run chosen code on the
 * page is already past this file and up against the CSP instead.
 *
 * Why a parser rather than a regex: the first version of this file lexed the
 * source by hand to blank out comments and strings before matching. A regex
 * literal containing an apostrophe — unremarkable in a codebase full of
 * derivation paths like m/44'/60' — flipped its quote parity, and it began
 * eating live code as though it were string contents. It reported all clear on
 * a file with fetch("https://rpc.example/balance") appended to the end. A
 * check that fails open is worse than no check at all: it manufactures the
 * confidence it was supposed to earn. Comments and strings are not in an AST,
 * so there is nothing to strip and nothing to desync.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { PAGES } from '../src/site.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const parse = (code, label) => {
  try {
    return acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      allowHashBang: true,
    });
  } catch (err) {
    assert.fail(`${label} does not parse as JavaScript: ${err.message}`);
  }
};

/**
 * Every name the code references, in any position.
 *
 * The explicit property handling is not decoration. acorn-walk's base walker
 * does not descend into the property of a non-computed member expression, so a
 * plain `walk.full` collecting Identifier nodes sees the `window` in
 * `window.fetch(url)` and never the `fetch`. It would wave through
 * `navigator.sendBeacon(...)` and `el.innerHTML = seed` while looking
 * thorough. Member properties, object keys and class members are gathered by
 * hand for that reason.
 *
 * Consequence worth knowing: an unrelated property that happens to be called
 * `fetch` would trip this. That is the right way to be wrong — a false alarm
 * is a two-minute conversation, a false all-clear is the whole point of the
 * project quietly gone.
 */
function identifiers(ast) {
  const found = new Set();
  const key = (node) => {
    if (!node.computed && node.key?.type === 'Identifier') found.add(node.key.name);
  };
  walk.full(ast, (node) => {
    if (node.type === 'Identifier') found.add(node.name);
    if (node.type === 'ImportExpression') found.add('import()');
    if (node.type === 'MemberExpression' && !node.computed && node.property?.type === 'Identifier') {
      found.add(node.property.name);
    }
    if (node.type === 'Property' || node.type === 'PropertyDefinition' || node.type === 'MethodDefinition') {
      key(node);
    }
  });
  return found;
}

/** Every string literal in the code. Comments are not literals; that is the point. */
function stringLiterals(ast) {
  const out = [];
  walk.full(ast, (node) => {
    if (node.type === 'Literal' && typeof node.value === 'string') out.push(node.value);
    if (node.type === 'TemplateElement') out.push(node.value.cooked ?? '');
  });
  return out;
}

/** First-party code, before bundling. Held to a stricter standard than vendor. */
const FIRST_PARTY_JS = [
  'src/entry.vanity.js',
  'src/entry.seed.js',
  'src/vanity.worker.js',
  'src/vendor-entry.js',
  'src/site.js',
  'src/ui/common.js',
  'src/ui/vanity.js',
  'src/ui/seed.js',
  'src/core/chains.js',
  'src/core/codec.js',
  'src/core/derive.js',
  'src/core/harden-first.js',
  'src/core/i18n.js',
  'src/core/security.js',
  'src/core/slip10.js',
  'src/core/vanity.js',
];

/**
 * Every way a page can start an outbound request.
 *
 * The list is the interesting part of this file: it is easy to remember
 * `fetch` and forget `sendBeacon`, which is precisely why it is written down
 * rather than remembered. Anything here appearing anywhere in shipped code, in
 * any position at all, fails. There is no legitimate use of any of them here.
 */
const NETWORK_APIS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'sendBeacon',
  'RTCPeerConnection',
  'RTCDataChannel',
  'importScripts',
  'serviceWorker',
  'Notification',
  'geolocation',
  'import()',
];

const STORAGE_APIS = ['localStorage', 'sessionStorage', 'indexedDB', 'openDatabase'];

const DOM_STRING_SINKS = ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'srcdoc'];

for (const page of PAGES) {
  test(`${page.slug} cannot make a network request`, () => {
    // This reads the bytes a browser executes, on every page, one by one. If a
    // fetch ever reaches a user it reaches them through one of these strings.
    for (const body of scriptBodies(read(page.slug))) {
      const names = identifiers(parse(body, page.slug));
      for (const api of NETWORK_APIS) {
        assert.equal(
          names.has(api),
          false,
          `${page.slug} references ${api}.\n\n` +
            'This tool must not talk to the network. If this fired because you added ' +
            'a balance check: that is the one feature this project exists in order ' +
            'not to have. See "What this deliberately does not do" in the README.',
        );
      }
    }
  });
}

test('no shipped script contains a hardcoded remote URL', () => {
  // A string literal is not a request by itself, but there is no honest reason
  // for an https:// endpoint to sit in this code, and an RPC URL appearing here
  // is the first half of the feature that must not exist. Comments may say
  // https:// as much as they like — they are not in the AST.
  for (const page of PAGES) {
    for (const body of scriptBodies(read(page.slug))) {
      const urls = stringLiterals(parse(body, page.slug)).filter((v) => /^(?:https?:)?\/\/\S/i.test(v.trim()));
      assert.deepEqual(urls, [], `${page.slug} contains remote URL literals: ${urls.join(', ')}`);
    }
  }
});

test('no first-party module writes to disk-backed storage', () => {
  // security.js seals these by redefining them to throw, so it has to name
  // them. Nothing else may.
  for (const file of FIRST_PARTY_JS) {
    if (file === 'src/core/security.js') continue;
    const names = identifiers(parse(read(file), file));
    for (const api of STORAGE_APIS) {
      assert.equal(names.has(api), false, `${file} touches ${api} — a seed phrase must not reach disk`);
    }
  }
});

test('first-party code never builds DOM from strings', () => {
  // The seed phrase is a string that passes through this UI. If any of it is
  // ever assembled as markup, an escaping bug becomes an injection bug.
  // textContent and value only.
  for (const file of FIRST_PARTY_JS) {
    const ast = parse(read(file), file);
    const names = identifiers(ast);
    for (const sink of DOM_STRING_SINKS) {
      assert.equal(names.has(sink), false, `${file} uses ${sink}`);
    }
    let dynamicCode = null;
    walk.full(ast, (node) => {
      if (node.type === 'NewExpression' && node.callee?.name === 'Function') dynamicCode = 'new Function()';
      if (node.type === 'CallExpression' && node.callee?.name === 'eval') dynamicCode = 'eval()';
    });
    assert.equal(dynamicCode, null, `${file} uses ${dynamicCode}`);
  }
});

/**
 * Pull the executable parts out of an HTML file.
 *
 * Scanning the raw file would be wrong, and loudly so: the risk and security
 * copy discusses fetch and XMLHttpRequest by name, and demonstrates the
 * exfiltration trick with a literal image-tag example. That prose is the
 * documentation working, not the page misbehaving. Only what is inside a
 * <script> is code.
 */
const scriptBodies = (html) =>
  [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    // type="application/ld+json" is a data block, not code — the HTML spec says
    // a script element with a non-JavaScript type is never executed. Handing it
    // to a JavaScript parser would fail on valid JSON and, worse, could pass on
    // invalid JSON. It is metadata; it is checked as JSON below.
    .filter(([, attrs]) => !/type\s*=\s*"application\/ld\+json"/i.test(attrs))
    .map((m) => m[2])
    .filter((b) => b.trim() !== '');

/** <!-- ... --> is neither markup nor code. index.html explains its own CSP at length. */
const stripHtmlComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

/**
 * <link rel> values the browser does not fetch anything for.
 *
 * Allow-list rather than block-list, on purpose: an unknown rel is treated as
 * fetching, so a future <link rel="preload"> has to be argued for here instead
 * of quietly breaking the folder case on someone else's machine. These four are
 * metadata — a canonical is a statement about a URL, not a request for it.
 */
const NON_FETCHING_REL = /^(?:canonical|alternate|author|license)$/i;

/** Every URL this document would make the browser go and get. */
function fetchedUrls(html) {
  const tags = [
    ...html
      .replace(/<!--[\s\S]*?-->/g, '')
      .matchAll(/<(?:img|script|link|iframe|source|video|audio|embed|object|track|use)\b[^>]*>/gi),
  ];
  const urls = [];
  for (const [tag] of tags) {
    if (/^<link\b/i.test(tag)) {
      const rel = tag.match(/\brel\s*=\s*"([^"]*)"/i)?.[1] ?? '';
      if (NON_FETCHING_REL.test(rel.trim())) continue;
    }
    for (const [, url] of tag.matchAll(/\b(?:src|href|data|poster)\s*=\s*"([^"]*)"/gi)) {
      if (url === '' || /^(?:data:|#|about:blank$)/i.test(url)) continue;
      urls.push(url);
    }
  }
  return urls;
}

test('every page fetches nothing — each one runs from anywhere', () => {
  // The property the whole build exists to produce, and not an aesthetic one.
  // People who do not trust a hosted page download this repository and open the
  // files out of the folder — that is the entire reason they are generating
  // keys in a browser instead of on a website. A page opened from a folder has
  // no origin, so any subresource at all is one that will not load, and the
  // tool is dead for exactly the users who were most careful.
  //
  // Nothing on any page is a fetch: not the fonts, not the cryptography, not
  // the worker. An assets/ path creeping back in is the regression.
  for (const page of PAGES) {
    const external = fetchedUrls(read(page.slug));
    assert.deepEqual(external, [], `${page.slug} tries to load: ${external.join(', ')}`);
  }
});

test('no page carries an inline style attribute', () => {
  // style-src is pinned to the stylesheet's hash, and a CSP hash does not cover
  // style attributes — allowing those needs 'unsafe-hashes', which this project
  // will not add. So every style="…" in the markup is dropped by the browser
  // silently: no exception, no missing element, just spacing that quietly
  // collapses. Seven of them shipped that way. A stylesheet rule is covered by
  // the stylesheet's own hash; an attribute never can be.
  for (const page of PAGES) {
    const html = read(page.slug);
    const found = [...html.matchAll(/<[a-z][^>]*\sstyle="([^"]*)"/gi)].map((m) => m[0]);
    assert.deepEqual(
      found,
      [],
      `${page.slug} has ${found.length} inline style attribute(s) that the CSP will discard:\n` +
        found.map((f) => '  ' + f.slice(0, 90)).join('\n') +
        '\n\nPut the rule in src/main.css and give the element a class instead.',
    );
  }
});

test('every page pins its inline script and style by CSP hash', () => {
  // The replacement for Subresource Integrity, and the same guarantee: these
  // bytes or nothing. The browser recomputes both hashes on every load and
  // refuses the block on any mismatch — so a tampered page does not run a
  // tampered app, it runs no app, and the boot notice explains why.
  //
  // Recomputed here from each shipped file rather than trusted from the build,
  // because a wrong hash does not warn: it silently produces a blank page, and
  // "the page is blank" is not a failure anyone connects to "the hash is off by
  // one byte". This is what the browser will do, done early.
  for (const page of PAGES) {
    const html = read(page.slug);
    const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/i)?.[1];
    assert.ok(csp, `${page.slug} has no CSP meta tag`);

    const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
    assert.ok(style, `${page.slug} has no inline stylesheet`);

    // A prose page has no script at all, and its script-src is the hash of the
    // empty string: a source nothing can match. That is a stronger statement
    // than 'none', and it means the pages carrying no code are not the weak
    // link in the set.
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] ?? '';
    assert.equal(
      Boolean(script),
      Boolean(page.script),
      `${page.slug} ${script ? 'has a script it should not' : 'is missing its script'}`,
    );

    for (const [kind, body] of [['script', script], ['style', style]]) {
      const digest = 'sha256-' + createHash('sha256').update(body, 'utf8').digest('base64');
      assert.ok(
        csp.includes(`'${digest}'`),
        `${page.slug}: the CSP does not carry the hash of the inline ${kind}, so the browser ` +
          `will refuse it and the page will be blank.\n  computed: ${digest}`,
      );
    }
  }
});

test('no page offers anywhere to type a seed phrase', () => {
  // The rule this enforces is the difference between a wallet generator and a
  // phishing page, and it is not a style preference.
  //
  // The tool this project replaced generated random mnemonics, derived their
  // addresses, and asked an RPC which of them held money. An import box is that
  // program with the RPC call deleted — the same machine, one function short of
  // the thing we are here to not be. And "paste your seed phrase into this
  // website" is the shape of every seed-phrase phishing page ever built; the
  // security guide on this very site says never to do it, which a page cannot
  // print above a box that invites it and expect the warning to win.
  //
  // So: this page generates. It does not import.
  for (const page of PAGES) {
    // Strip the inlined script and stylesheet first. Both are inside the
    // document and both mention HTML; scanning raw text finds a CSS selector
    // and calls it a form control.
    const markup = read(page.slug)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style>[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    const areas = [...markup.matchAll(/<textarea\b[^>]*>/gi)].map((m) => m[0]);
    assert.deepEqual(areas, [], `${page.slug} has a textarea — the only thing a 24-word phrase fits in`);

    // A free-text field on the generator pages is somewhere a phrase can go.
    // The allowed types are: password (the BIP-39 passphrase, which is useless
    // without a phrase you cannot enter), number, checkbox, and — on the vanity
    // page only — text, for the pattern, which is not a secret and is the point.
    const allowed = page.body === 'vanity' ? ['text', 'password', 'number', 'checkbox'] : ['password', 'number', 'checkbox'];
    for (const tag of [...markup.matchAll(/<input\b[^>]*>/gi)].map((m) => m[0])) {
      const type = tag.match(/\btype\s*=\s*"([^"]*)"/i)?.[1] ?? 'text';
      assert.ok(allowed.includes(type), `${page.slug} has an <input type="${type}">:\n  ${tag}`);
    }
  }
});

test('the seed page generates and cannot import', () => {
  const page = PAGES.find((p) => p.body === 'seed');
  const script = scriptBodies(read(page.slug))[0];
  const names = identifiers(parse(script, page.slug));

  // generateMnemonic must be in there — it is the page.
  assert.ok(names.has('generateMnemonic'), 'the seed page does not generate a mnemonic');

  // A datalist of the 2048 BIP-39 words exists for one purpose: helping someone
  // type a phrase in. There is nothing to type.
  assert.equal(/<datalist/i.test(read(page.slug)), false, 'the seed page carries a BIP-39 autocomplete');
});

test('the prose pages ship no JavaScript at all', () => {
  // The risk and security writing is prose. Prose does not need a cryptography
  // bundle, and shipping one would cost a reader half a megabyte to read a page
  // about why they should be careful.
  for (const page of PAGES.filter((p) => !p.script)) {
    assert.deepEqual(scriptBodies(read(page.slug)), [], `${page.slug} carries a script`);
  }
});

test('every page runs at most one script, and it has no src', () => {
  for (const page of PAGES) {
    const tags = [...read(page.slug).matchAll(/<script\b[^>]*>/gi)]
      .map((m) => m[0])
      .filter((tag) => !/type\s*=\s*"application\/ld\+json"/i.test(tag));
    assert.ok(tags.length <= 1, `${page.slug} has ${tags.length} executable script tags`);
    for (const tag of tags) {
      assert.equal(/\bsrc\s*=/.test(tag), false, `${page.slug}: script has a src — it will not load from a folder`);
    }
  }
});

test('every page declares the Content-Security-Policy the security model rests on', () => {
  for (const page of PAGES) {
    const meta = read(page.slug).match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i);
    assert.ok(meta, `${page.slug} has no CSP meta tag`);
    const csp = meta[1].replace(/\s+/g, ' ').trim();

    // connect-src is the load-bearing one: it is what makes a stolen key
    // worthless even if the thief is the page's own JavaScript.
    for (const directive of [
      "default-src 'none'",
      "connect-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      "object-src 'none'",
    ]) {
      assert.ok(csp.includes(directive), `${page.slug} CSP is missing: ${directive}\nGot: ${csp}`);
    }
    // script-src must be a hash and nothing but a hash. 'self' would be a
    // loophole big enough to drive an injected file through, and on a page
    // opened from a folder it does not even mean anything.
    assert.match(csp, /script-src 'sha256-[A-Za-z0-9+/]{43}='\s*;/, `${page.slug} script-src is not a bare hash: ${csp}`);
    assert.equal(/unsafe-inline|unsafe-eval/.test(csp), false, `${page.slug} CSP has an unsafe-* keyword: ${csp}`);
  }
});

test('every page has its own title, description, canonical and h1', () => {
  // The reason the site is five files instead of four tabs. A tab is not a URL:
  // one URL can carry one title, one description and one h1, so a page with
  // four tabs can compete for one set of search terms no matter how much is
  // written on it. These have to be distinct, or the pages compete with each
  // other instead of adding up.
  const site = JSON.parse(read('package.json')).homepage.replace(/\/+$/, '');
  const seen = { title: new Set(), description: new Set(), canonical: new Set() };

  for (const page of PAGES) {
    const html = read(page.slug);
    const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
    const desc = html.match(/<meta name="description" content="([^"]*)"/i)?.[1];
    const canonical = html.match(/<link rel="canonical" href="([^"]*)"/i)?.[1];

    assert.ok(title, `${page.slug} has no title`);
    assert.ok(desc, `${page.slug} has no meta description`);
    assert.equal(canonical, `${site}/${page.slug === 'index.html' ? '' : page.slug}`, `${page.slug} canonical is wrong`);

    // Truncation limits, not style preferences: past these, a search result
    // shows a sentence cut in half.
    assert.ok(title.length <= 70, `${page.slug} title is ${title.length} chars — it will be truncated: ${title}`);
    assert.ok(desc.length <= 165, `${page.slug} description is ${desc.length} chars — it will be truncated`);
    assert.ok(desc.length >= 70, `${page.slug} description is only ${desc.length} chars — say more`);

    for (const [field, value] of [['title', title], ['description', desc], ['canonical', canonical]]) {
      assert.equal(seen[field].has(value), false, `${page.slug} duplicates another page's ${field}: ${value}`);
      seen[field].add(value);
    }

    const markup = html.replace(/<style>[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
    const h1 = [...markup.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
    assert.equal(h1.length, 1, `${page.slug} has ${h1.length} h1 elements, expected exactly 1`);
    assert.ok(h1[0][1].trim().length > 15, `${page.slug} h1 is too short to say anything`);
    assert.equal(/{{|}}/.test(html), false, `${page.slug} still contains a build placeholder`);
  }
});

test('the pages link to each other, relatively', () => {
  // Relative links are what makes the nav work from a folder and from Pages
  // with the same bytes. They are also what lets a crawler walk the site: a
  // page nothing links to is a page nothing finds.
  for (const page of PAGES) {
    const links = [...read(page.slug).matchAll(/<a class="tab" href="([^"]*)"/g)].map((m) => m[1]);
    assert.equal(links.length, PAGES.length - 1, `${page.slug} nav has ${links.length} links`);
    for (const href of links) {
      assert.equal(/^[a-z]+:|^\//i.test(href), false, `${page.slug} links absolutely to ${href}`);
      assert.ok(PAGES.some((p) => p.slug === href), `${page.slug} links to ${href}, which is not a page`);
    }
  }
});

test('the structured data on every page is valid JSON and matches the page', () => {
  // A malformed JSON-LD block is invisible: nothing renders it, nothing errors,
  // and the rich result simply never appears. The only way to find out is to
  // parse it, so parse it.
  const site = JSON.parse(read('package.json')).homepage.replace(/\/+$/, '');
  for (const page of PAGES) {
    const html = read(page.slug);
    const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i)?.[1];
    assert.ok(block, `${page.slug} has no JSON-LD`);
    let data;
    try {
      data = JSON.parse(block);
    } catch (err) {
      assert.fail(`${page.slug} JSON-LD does not parse: ${err.message}`);
    }
    assert.equal(data.url, `${site}/${page.slug === 'index.html' ? '' : page.slug}`);
    assert.ok(data.name && data.description, `${page.slug} JSON-LD is missing name or description`);
    assert.equal(data['@type'], page.script ? 'SoftwareApplication' : 'WebPage');
  }
});

test('robots.txt and sitemap.xml list every page, at the real site', () => {
  const site = JSON.parse(read('package.json')).homepage.replace(/\/+$/, '');
  assert.match(read('robots.txt'), new RegExp(`Sitemap: ${site}/sitemap\\.xml`));
  const sitemap = read('sitemap.xml');
  for (const page of PAGES) {
    const loc = `${site}/${page.slug === 'index.html' ? '' : page.slug}`;
    assert.ok(sitemap.includes(`<loc>${loc}</loc>`), `sitemap.xml does not list ${loc}`);
  }
  // A page in the sitemap that is not in the site is an instruction to index a
  // 404, which is worse than saying nothing.
  assert.equal((sitemap.match(/<loc>/g) ?? []).length, PAGES.length, 'sitemap lists a page that does not exist');
});

test('the page states what it is, once, in an h1', () => {
  // The masthead was a styled div. A page with no h1 is a page that has not
  // said what it is — and this one has to be found by people searching for it.
  // Strip the inlined stylesheet and the comments first. Both are inside this
  // document and both discuss HTML; the first version of this test matched an
  // <h1> written in a CSS comment, ran to the real </h1>, counted one, and went
  // green while the page had a heading it could not see. A check that passes for
  // the wrong reason is worse than no check.
  const markup = read('index.html')
    .replace(/<style>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const h1 = [...markup.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  assert.equal(h1.length, 1, `expected exactly one h1, found ${h1.length}`);
  assert.ok(h1[0][1].trim().length > 20, 'the h1 is too short to say anything');
  assert.equal(/<h1/i.test(h1[0][1]), false, 'the h1 match swallowed the rest of the document');
});

test('index.html declares the Content-Security-Policy the security model rests on', () => {
  const meta = read('index.html').match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i);
  assert.ok(meta, 'index.html has no CSP meta tag');
  const csp = meta[1].replace(/\s+/g, ' ').trim();

  // connect-src is the load-bearing one: it is what makes a stolen key
  // worthless even if the thief is this page's own JavaScript.
  const REQUIRED = [
    "default-src 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ];
  for (const directive of REQUIRED) {
    assert.ok(csp.includes(directive), `CSP is missing: ${directive}\nGot: ${csp}`);
  }

  // script-src must be a hash and nothing but a hash. 'self' would be a
  // loophole big enough to drive an injected file through, and on a page
  // opened from a folder it does not even mean anything.
  assert.match(
    csp,
    /script-src 'sha256-[A-Za-z0-9+/]{43}='\s*;/,
    `script-src must be exactly one sha256 hash source: ${csp}`,
  );
  assert.equal(
    /unsafe-inline|unsafe-eval/.test(csp),
    false,
    `CSP contains an unsafe-* keyword, which hands back most of what the rest of it buys: ${csp}`,
  );
});

test('every page can tell the reader when it has not started', () => {
  // A page whose script fails its CSP hash is a blank screen. That blank screen
  // is the tampering warning, and nobody reads a blank screen. So the notice is
  // plain markup that needs nothing to run, and CSS hides it once app code has
  // proved it is running.
  //
  // On the prose pages nothing ever sets data-ready, so their notice is hidden
  // by CSS alone — which is the right answer there: if the stylesheet was
  // refused too, the reader gets an unstyled warning on an unstyled page, and if
  // it was not, there is no script to have failed.
  for (const page of PAGES) {
    const html = read(page.slug);
    const notice = html.match(/<div class="boot-notice"[^>]*>/);
    assert.ok(notice, `${page.slug} has no boot notice — a reader gets a blank page and no reason`);
    assert.equal(
      /\shidden(\s|=|>)/.test(notice[0]),
      false,
      `${page.slug}: the boot notice is hidden by an attribute. It has to be visible in the raw ` +
        'markup — that is the whole trick.',
    );

    // CSS may hide it, but only after the page has proved it is running. An
    // unconditional rule deletes the one message that reaches a reader whose
    // browser refused the script.
    const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
    const hiders = [...style.matchAll(/([^{}]*)\{([^{}]*)\}/g)].filter(
      ([, selector, body]) => selector.includes('.boot-notice') && /display\s*:\s*none/.test(body),
    );
    for (const [, selector] of hiders) {
      assert.match(
        selector,
        /data-ready/,
        `${page.slug}: .boot-notice is hidden by "${selector.trim()}" regardless of whether the ` +
          'page started. Only body[data-ready="true"] may hide it.',
      );
    }
  }
});

test('the shipped code is auditable, not minified', () => {
  // A reader is supposed to be able to read the cryptography in the page they
  // are running it in, and diff it against @noble/@scure. That only works while
  // it still looks like the code it came from.
  for (const page of PAGES.filter((p) => p.script)) {
    const body = scriptBodies(read(page.slug))[0];
    const lines = body.split('\n');
    const longest = Math.max(...lines.map((l) => l.length));
    assert.ok(lines.length > 500, `${page.slug}'s script is ${lines.length} lines — looks minified`);
    // The worker travels as one long string literal, so allow for that and
    // measure the rest.
    const code = lines.filter((l) => !l.startsWith('self.__CSWG_WORKER_SOURCE__'));
    const longestCode = Math.max(...code.map((l) => l.length));
    assert.ok(longestCode < 2000, `${page.slug} has a ${longestCode}-char line — looks minified`);
    assert.ok(longest > 0);
  }
});
