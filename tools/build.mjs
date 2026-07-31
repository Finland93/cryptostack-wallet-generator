#!/usr/bin/env node
/**
 * build.mjs — turns src/ into the site.
 *
 * The site is five HTML files in the repository root, one per URL, listed in
 * src/site.js. Each is self-contained: its stylesheet, its fonts, its
 * cryptography, its application and its worker are all inside it, pinned by
 * sha256 hashes in its own Content-Security-Policy. Nothing is fetched, by
 * anything, ever.
 *
 * Two consequences, because they are the whole design:
 *
 *   1. Every page opens from a folder. `integrity` + `crossorigin` on a
 *      subresource makes it a CORS fetch, and a CORS fetch of a file:// URL has
 *      no origin to allow — so a page built the ordinary way is blank for
 *      anyone who downloaded the repository rather than trusting the host.
 *      Those are the careful users. They are the ones this is for.
 *   2. Every page has its own title, description, canonical, Open Graph tags
 *      and h1, because they are pages rather than tabs. A tab is not a URL and
 *      cannot rank for anything.
 *
 * The two prose pages carry no script at all: risk and security writing does
 * not need a cryptography bundle. Only the two tool pages pay for one.
 *
 * Run `node tools/build.mjs --check` in CI to assert the committed pages still
 * match src/. If that fails, someone edited built output directly — which is
 * exactly what a supply-chain attack looks like.
 */

import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES } from '../src/site.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

const r = (...p) => path.join(ROOT, ...p);
const rel = (p) => path.relative(ROOT, p);

const readJSON = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** CSP hash-source form, e.g. sha256-Base64… — for an inline script or style. */
const sha256b64 = (text) => 'sha256-' + createHash('sha256').update(text, 'utf8').digest('base64');

/** Where this site lives, without a trailing slash. */
function site(pkg) {
  if (!pkg.homepage) throw new Error('package.json has no "homepage" — every canonical URL comes from it.');
  return pkg.homepage.replace(/\/+$/, '');
}

/**
 * Where the source lives, without a trailing slash or .git suffix.
 *
 * The footer links here so a reader can diff what they were served against what
 * was published. That claim is only worth making if the link is right, so the
 * URL comes from package.json rather than being retyped into the template —
 * one file to edit when this repository is forked or renamed.
 */
function repo(pkg) {
  const url = pkg.repository?.url;
  if (!url) throw new Error('package.json has no "repository.url" — the footer source links come from it.');
  return url.replace(/^git\+/, '').replace(/\.git$/, '').replace(/\/+$/, '');
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Write, or in --check mode compare and report drift. */
const drift = [];
async function emit(target, contents) {
  const next = Buffer.from(contents);
  if (CHECK_ONLY) {
    let current = null;
    try {
      current = await fs.readFile(target);
    } catch {
      /* missing counts as drift */
    }
    if (!current || !current.equals(next)) drift.push(rel(target));
    return next;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, next);
  return next;
}

// ---------------------------------------------------------------------------
// 1. Scripts — one bundle per tool page, none for the prose pages
// ---------------------------------------------------------------------------

const BANNER = `/*!
 * cryptostack-wallet-generator — generated file, do not edit by hand.
 * Rebuild with: npm run build
 * Sources live in src/. Dependency versions are pinned in package-lock.json.
 */`;

async function bundle(entry, format = 'esm') {
  const result = await esbuild.build({
    entryPoints: [r(entry)],
    bundle: true,
    format,
    target: 'es2022',
    // Deliberately NOT minified. This is code that touches private keys; a
    // reader has to be able to see what it does, in the page they are running.
    minify: false,
    write: false,
    legalComments: 'inline',
    banner: { js: BANNER },
  });
  return result.outputFiles[0].text;
}

async function buildScripts() {
  const [vanity, seed, worker] = await Promise.all([
    bundle('src/entry.vanity.js'),
    bundle('src/entry.seed.js'),
    // IIFE, not ESM: this one is started from a blob URL as a classic worker.
    bundle('src/vanity.worker.js', 'iife'),
  ]);
  const workerLiteral = JSON.stringify(worker);
  const withWorker = (js) => `self.__CSWG_WORKER_SOURCE__ = ${workerLiteral};\n${js}`;
  return { vanity: withWorker(vanity), seed: withWorker(seed) };
}

// ---------------------------------------------------------------------------
// 2. Stylesheet — one, with the fonts inlined as data: URLs
// ---------------------------------------------------------------------------

const FONTS = [
  ['ibm-plex-sans', 'ibm-plex-sans-latin-400-normal.woff2'],
  ['ibm-plex-sans', 'ibm-plex-sans-latin-500-normal.woff2'],
  ['ibm-plex-sans-condensed', 'ibm-plex-sans-condensed-latin-600-normal.woff2'],
  ['ibm-plex-sans-condensed', 'ibm-plex-sans-condensed-latin-700-normal.woff2'],
  ['ibm-plex-mono', 'ibm-plex-mono-latin-400-normal.woff2'],
  ['ibm-plex-mono', 'ibm-plex-mono-latin-600-normal.woff2'],
  ['ibm-plex-serif', 'ibm-plex-serif-latin-400-normal.woff2'],
];

async function buildCss() {
  let css = await fs.readFile(r('src/main.css'), 'utf8');
  let inlined = 0;
  for (const [pkg, file] of FONTS) {
    const data = await fs.readFile(r('node_modules/@fontsource', pkg, 'files', file));
    const before = css;
    css = css.replaceAll(`../fonts/${file}`, `data:font/woff2;base64,${data.toString('base64')}`);
    if (css !== before) inlined++;
  }
  // A font URL that survived would be a request leaving the page, and a font
  // that never arrives on a machine with no network.
  //
  // The data: URLs have to come out before looking, and not because they are
  // allowed: an inlined SVG is itself a document, and the noise texture in this
  // stylesheet contains filter='url(%23n)' — a reference to its own filter, by
  // fragment, inside its own markup. Scanning the raw text finds that and calls
  // it an outbound request. Remove what is already inlined, then whatever still
  // says url() is a real one.
  const left = [...css.replace(/url\(\s*["']?data:[^)]*\)/gi, '').matchAll(/url\(['"]?([^)'"]+)/g)].map((m) => m[1]);
  if (left.length) throw new Error(`main.css still points outward: ${left.join(', ')}`);
  return { css, inlined };
}

// ---------------------------------------------------------------------------
// 3. Pages
// ---------------------------------------------------------------------------

const canonicalOf = (page, url) => `${url}/${page.slug === 'index.html' ? '' : page.slug}`;

function seoBlock(page, url) {
  const canonical = canonicalOf(page, url);
  const card = `${url}/assets/social-card.png`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': page.script ? 'SoftwareApplication' : 'WebPage',
    name: page.title.split(' | ')[0],
    url: canonical,
    description: page.description,
    ...(page.script
      ? {
          applicationCategory: 'SecurityApplication',
          operatingSystem: 'Any browser',
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
          license: 'https://opensource.org/licenses/MIT',
          isAccessibleForFree: true,
        }
      : { isPartOf: { '@type': 'WebSite', name: 'Cryptostack Wallet Generator', url: `${url}/` } }),
  };

  return [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}">`,
    `<link rel="canonical" href="${canonical}">`,
    '<meta name="robots" content="index, follow, max-image-preview:large">',
    '',
    '<meta property="og:type" content="website">',
    `<meta property="og:url" content="${canonical}">`,
    '<meta property="og:site_name" content="Cryptostack Wallet Generator">',
    `<meta property="og:title" content="${esc(page.ogTitle)}">`,
    `<meta property="og:description" content="${esc(page.description)}">`,
    `<meta property="og:image" content="${card}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:alt" content="Cryptostack — offline vanity address and BIP-39 wallet generator">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(page.ogTitle)}">`,
    `<meta name="twitter:description" content="${esc(page.description)}">`,
    `<meta name="twitter:image" content="${card}">`,
    '',
    '<!--',
    '  Structured data. type="application/ld+json" is a data block, not code: the',
    '  HTML spec says a script element whose type is not a JavaScript MIME type is',
    '  never executed, so script-src does not apply to it and the CSP does not have',
    '  to name its hash. It is markup that happens to be JSON.',
    '-->',
    '<script type="application/ld+json">',
    JSON.stringify(ld, null, 2),
    '</script>',
  ].join('\n');
}

/** The same nav on every page, with the current one marked and not linked. */
const navBlock = (page) =>
  PAGES.map((p) =>
    p.slug === page.slug
      ? `  <span class="tab" aria-current="page">${esc(p.nav)}</span>`
      : `  <a class="tab" href="${p.slug}">${esc(p.nav)}</a>`,
  ).join('\n');

const RAIL = `  <aside class="rail">
    <h2 data-i18n="rail.title">Environment</h2>
    <div id="rail-list"></div>
    <p class="rail-foot" data-i18n="rail.offlinehint"></p>
  </aside>`;

async function buildPage(page, { layout, css, scripts, pkg }) {
  const url = site(pkg);
  const body = await fs.readFile(r('src/pages', `_${page.body}.body.html`), 'utf8');
  const script = page.script ? scripts[page.script] : null;

  const content = [
    '    <section class="panel">',
    `      <h1 class="page-h1">${esc(page.h1)}</h1>`,
    body.trimEnd(),
    '    </section>',
  ].join('\n');

  // Every replacement uses a FUNCTION, never a string. A string replacement
  // interprets $&, $', $1… inside the bundled JavaScript and quietly corrupts
  // it — which is what assertSelfConsistent() below exists to catch.
  const out = layout
    .replace('{{SEO}}', () => seoBlock(page, url))
    .replace('{{STYLE}}', () => `<style>${css}</style>`)
    .replace('{{TAGLINE}}', () => esc(page.tagline))
    .replace('{{NAV}}', () => navBlock(page))
    .replace('{{CONTENT}}', () => content)
    .replace('{{RAIL}}', () => (page.rail ? RAIL : ''))
    .replace('{{SCRIPT}}', () => (script ? `<script type="module">${script}</script>` : ''))
    .replace('{{STYLE_HASH}}', () => sha256b64(css))
    // A page with no script still needs a script-src, and it gets the hash of
    // the empty string: a source that no block can ever match. That says "no
    // script runs on this page" more exactly than 'none' does, and it means the
    // two prose pages are not a weaker link than the two tool pages.
    .replace('{{SCRIPT_HASH}}', () => sha256b64(script ?? ''))
    .replaceAll('{{SITE}}', () => url)
    .replaceAll('{{REPO}}', () => repo(pkg));

  assertSelfConsistent(out, page, script, css);
  return emit(r(page.slug), out);
}

/**
 * <link rel> values the browser does not fetch anything for.
 *
 * Allow-list rather than block-list, on purpose: an unknown rel counts as
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
      const relValue = tag.match(/\brel\s*=\s*"([^"]*)"/i)?.[1] ?? '';
      if (NON_FETCHING_REL.test(relValue.trim())) continue;
    }
    for (const [, url] of tag.matchAll(/\b(?:src|href|data|poster)\s*=\s*"([^"]*)"/gi)) {
      if (url === '' || /^(?:data:|#|about:blank$)/i.test(url)) continue;
      urls.push(url);
    }
  }
  return urls;
}

/**
 * A wrong CSP hash does not warn — it silently refuses to run the page. So the
 * hashes are read back out of the finished document and checked against the
 * blocks they cover, rather than trusting that the string we hashed is the
 * string that landed in the file.
 */
function assertSelfConsistent(out, page, script, css) {
  const problems = [];
  const inlineScript = out.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] ?? null;
  const inlineStyle = out.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  const csp = out.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1];

  if (inlineScript !== script) problems.push('inline script does not round-trip');
  if (inlineStyle !== css) problems.push('inline stylesheet does not round-trip');

  const left = [...out.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[0]);
  if (left.length) problems.push(`unsubstituted placeholder(s): ${left.join(', ')}`);

  if (!csp) problems.push('CSP meta tag missing');
  else {
    if (!csp.includes(`'${sha256b64(script ?? '')}'`)) problems.push('script-src hash mismatch');
    if (!csp.includes(`'${sha256b64(css)}'`)) problems.push('style-src hash mismatch');
    if (!csp.includes("connect-src 'none'")) problems.push("connect-src 'none' lost");
    if (/\bunsafe-inline\b|\bunsafe-eval\b/.test(csp)) problems.push('CSP weakened with an unsafe-* source');
  }

  const external = fetchedUrls(out);
  if (external.length) problems.push(`still loads: ${external.join(', ')}`);

  // The stylesheet is inside the document and discusses HTML. Strip it before
  // counting headings, or a tag written in a CSS comment is a heading.
  const h1 = [...out.replace(/<style>[\s\S]*?<\/style>/g, '').matchAll(/<h1\b/g)];
  if (h1.length !== 1) problems.push(`${h1.length} h1 elements — a page says what it is exactly once`);

  // Relative links only. An absolute link to its own hostname is a page that
  // works on Pages and leaves the folder halfway through.
  const nav = [...out.matchAll(/<a class="tab" href="([^"]*)"/g)].map((m) => m[1]);
  const absolute = nav.filter((h) => /^[a-z]+:|^\/\//i.test(h));
  if (absolute.length) problems.push(`nav links are absolute: ${absolute.join(', ')}`);
  const unknown = nav.filter((h) => !PAGES.some((p) => p.slug === h));
  if (unknown.length) problems.push(`nav links to nothing: ${unknown.join(', ')}`);

  if (problems.length) {
    throw new Error(`${page.slug} is not self-contained:\n  - ${problems.join('\n  - ')}`);
  }
}

// ---------------------------------------------------------------------------
// 4. robots.txt + sitemap.xml
// ---------------------------------------------------------------------------

/**
 * Generated rather than hand-kept, for the same reason the canonicals are: the
 * URL appears in a dozen places and they must not disagree. A sitemap pointing
 * at a stale hostname is worse than none — it is an instruction to index pages
 * that do not exist.
 */
async function buildSeoFiles(pkg) {
  const url = site(pkg);
  await emit(r('robots.txt'), ['User-agent: *', 'Allow: /', '', `Sitemap: ${url}/sitemap.xml`, ''].join('\n'));
  await emit(
    r('sitemap.xml'),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...PAGES.flatMap((p) => [
        '  <url>',
        `    <loc>${canonicalOf(p, url)}</loc>`,
        `    <priority>${p.slug === 'index.html' ? '1.0' : '0.8'}</priority>`,
        '  </url>',
      ]),
      '</urlset>',
      '',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------

async function main() {
  const pkg = await readJSON(r('package.json'));
  console.log(CHECK_ONLY ? 'Verifying build output matches src/…' : 'Building…');

  const layout = await fs.readFile(r('src/layout.html'), 'utf8');
  const [{ css, inlined }, scripts] = await Promise.all([buildCss(), buildScripts()]);

  const built = {};
  for (const page of PAGES) {
    built[page.slug] = await buildPage(page, { layout, css, scripts, pkg });
  }
  await buildSeoFiles(pkg);

  // One hash per page. Each page is the whole application, so each hash covers
  // an entire application: sha256sum a file and you have checked all of it.
  const lines = PAGES.map((p) => `${sha256(built[p.slug])}  ${p.slug}`);
  await emit(r('SHA256SUMS'), lines.join('\n') + '\n');

  if (CHECK_ONLY) {
    if (drift.length) {
      console.error('\n✗ Build output does not match src/. Drifted files:');
      for (const f of drift) console.error(`    ${f}`);
      console.error('\nEither someone edited the built output by hand, or the');
      console.error('build was not re-run. Run `npm run build` and commit the result.');
      process.exit(1);
    }
    console.log('✓ Build output matches src/.');
    return;
  }

  console.log(`  fonts inlined: ${inlined}/${FONTS.length}\n`);
  for (const p of PAGES) {
    const kb = String(Math.round(built[p.slug].length / 1024)).padStart(4);
    console.log(`  ${kb} KB  ${p.slug.padEnd(34)} ${p.script ? 'generator' : 'prose, no script'}`);
  }
  console.log('\nSHA256SUMS (verify with `sha256sum -c SHA256SUMS`):\n');
  for (const line of lines) console.log(`  ${line}`);
  console.log('\n  Every page is self-contained. Open any of them straight from a folder.');
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
