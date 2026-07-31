/**
 * The site, as data. One entry per URL.
 *
 * This used to be a single page with four tabs. Four tabs is one URL, one
 * <title>, one description and one <h1> — so the whole site could only ever
 * compete for one set of search terms, and the two thousand words of risk and
 * security writing sat behind `hidden` where they counted for very little.
 * Somebody searching "is a vanity address safe" and somebody searching "bip39
 * seed phrase generator" want different pages. Now they get different pages.
 *
 * Everything per-page comes from here: the filename, the title, the
 * description, the h1, the nav label, and which entry script (if any) the page
 * needs. build.mjs walks this list and nothing else. Adding a page is an entry
 * plus a body file.
 *
 * On filenames: flat .html, not directories with an index.html inside. Pretty
 * URLs would need a server to map /vanity/ to /vanity/index.html, and half the
 * point of this project is that it runs from a folder with no server at all —
 * where <a href="../seed/"> opens a directory listing. A .html extension costs
 * nothing in search and keeps every link working from a file:// path, a USB
 * stick and Pages alike.
 */

export const PAGES = [
  {
    slug: 'index.html',
    nav: 'Home',
    // Title and description are what a search result actually shows. Keep the
    // title at or under ~60 characters and the description at or under ~155:
    // past that they are truncated, and a truncated sentence reads as sloppy
    // to the one person who was going to click.
    title: 'Offline Crypto Wallet Generator — BTC, ETH, SOL, TRON | Cryptostack',
    description:
      'Free open-source wallet generator that runs entirely in your browser. Vanity addresses and BIP-39 seed phrases for Bitcoin, Ethereum, Solana and TRON. No tracking.',
    h1: 'Crypto wallet generator that runs entirely in your browser',
    tagline: 'One HTML file. No server, no network requests, no balance checks.',
    body: 'index',
    script: null,
    rail: false,
    ogTitle: 'Offline crypto wallet generator — runs in your browser, sends nothing',
  },
  {
    slug: 'vanity-address-generator.html',
    nav: 'Vanity address',
    title: 'Vanity Address Generator — ETH, BTC, SOL, TRON | Cryptostack',
    description:
      'Generate a custom vanity address with the prefix or suffix you want, for Ethereum, Bitcoin, Solana or TRON. Runs in your browser, offline, with a full 256-bit key.',
    h1: 'Vanity address generator',
    tagline: 'Search for an address that starts or ends with what you choose. Read the risks first.',
    body: 'vanity',
    script: 'vanity',
    rail: true,
    ogTitle: 'Vanity address generator — ETH, BTC, SOL, TRON, offline in your browser',
  },
  {
    slug: 'bip39-seed-phrase-generator.html',
    nav: 'Seed wallet',
    title: 'BIP-39 Seed Phrase Generator & Wallet Addresses | Cryptostack',
    description:
      'Generate a 24-word BIP-39 seed phrase and derive its Bitcoin, Ethereum, Solana and TRON addresses offline in your browser. Derivation paths shown. Nothing is sent.',
    h1: 'BIP-39 seed phrase generator',
    tagline: 'A 24-word phrase, and the BTC, ETH, SOL and TRON addresses it produces.',
    body: 'seed',
    script: 'seed',
    rail: true,
    ogTitle: 'BIP-39 seed phrase generator — offline, in your browser',
  },
  {
    slug: 'vanity-address-risks.html',
    nav: 'Risks',
    title: 'Are Vanity Addresses Safe? The Risks Explained | Cryptostack',
    description:
      'What a vanity address really costs, how the Profanity flaw cost Wintermute $160M, and why a recognisable prefix makes address poisoning easier to fall for.',
    h1: 'The risks of vanity addresses',
    tagline: 'What they cost, how they have gone wrong before, and the attack they make easier.',
    body: 'risks',
    script: null,
    rail: false,
    ogTitle: 'Are vanity addresses safe? What they cost and how they go wrong',
  },
  {
    slug: 'wallet-security-guide.html',
    nav: 'Security',
    title: 'How to Generate a Crypto Wallet Safely — Guide | Cryptostack',
    description:
      'How to generate a seed phrase safely: what protects your keys in a browser, what does not, and the steps to follow before a wallet holds real money.',
    h1: 'Generating a wallet safely',
    tagline: 'What protects your keys here, what does not, and what to do before funding a wallet.',
    body: 'security',
    script: null,
    rail: false,
    ogTitle: 'How to generate a crypto wallet safely — what protects your keys, and what does not',
  },
];

export const bySlug = (slug) => PAGES.find((p) => p.slug === slug);
