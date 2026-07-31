/**
 * strings.js — the UI's short labels, in one place.
 *
 * This was an i18n layer with an English and a Finnish table and a switch in
 * the header. The Finnish is gone: the site is in English, and a page that
 * served two languages off one URL with no hreflang was, on top of everything
 * else, telling search engines it was two half-pages rather than one whole one.
 *
 * What is left is a lookup, kept because the labels are easier to review in a
 * list than scattered through app.js. Long-form prose lives in index.html as
 * ordinary markup, where a crawler can read it without executing anything.
 */

export const STRINGS = {
  'tab.vanity': 'Vanity address',
  'tab.seed': 'Seed phrase wallet',
  'tab.risks': 'Risks',
  'tab.security': 'Security',

  'rail.title': 'Environment',
  'rail.transport': 'Transport',
  'rail.framed': 'Embedded in a frame',
  'rail.network': 'Network',
  'rail.csp': 'Exfiltration blocked',
  'rail.rng': 'Randomness',
  'rail.workers': 'Compute',
  'rail.offlinehint': 'Best practice: disconnect from the network before generating a wallet you intend to fund.',

  'vanity.h': 'Search for an address pattern',
  'vanity.lede': 'Generates private keys locally and keeps the one whose address matches your pattern. Everything is discarded except the match.',
  'vanity.chain': 'Chain',
  'vanity.prefix': 'Starts with',
  'vanity.suffix': 'Ends with',
  'vanity.threads': 'Threads',
  'vanity.start': 'Start search',
  'vanity.stop': 'Stop',
  'vanity.clear': 'Clear results',
  'vanity.attempts': 'Tried',
  'vanity.rate': 'Per second',
  'vanity.elapsed': 'Elapsed',
  'vanity.probability': 'Odds by now',
  'vanity.expected': 'Expected tries',
  'vanity.eta': 'Median time',
  'vanity.found': 'Match',
  'vanity.pattern': 'Pattern',
  'vanity.difficulty': 'Difficulty',
  'vanity.noresults': 'No matches yet.',
  'vanity.impossible': 'Impossible pattern',
  'vanity.running': 'Searching',
  'vanity.idle': 'Idle',

  'seed.h': 'Generate a seed phrase wallet',
  'seed.lede': 'Press generate: you get a brand-new BIP-39 phrase and the addresses every major wallet will derive from it. 24 words is 256 bits of entropy from your browser CSPRNG. There is no field for an existing phrase, on purpose — this page makes wallets, it does not open them.',
  'seed.words': 'Length',
  'seed.generate': 'Generate new phrase',
  'seed.passphrase': 'Passphrase (BIP-39 "25th word")',
  'seed.passphrase.hint': 'Optional. A different passphrase gives a completely different wallet, with no way to tell a wrong one from a right one. Lose it and the coins are gone.',
  'seed.chains': 'Show addresses for',
  'seed.count': 'Addresses per chain',
  'seed.reveal': 'Reveal phrase',
  'seed.hide': 'Hide',
  'seed.copy': 'Copy',
  'seed.copied': 'Copied — clipboard clears in 45s',
  'seed.print': 'Print backup sheet',
  'seed.keys': 'Show private keys',
  'seed.clear': 'Clear',
  'seed.path': 'Path',
  'seed.address': 'Address',
  'seed.privkey': 'Private key',

  'risk.title': 'Read this before you fund anything',
  'common.words': 'words',
  'common.chars': 'chars',
  'common.close': 'Close',
  'common.warning': 'Warning',
  'common.of': 'of',
  'common.and': 'and',
};

export function createTranslator() {
  const t = (key) => STRINGS[key] ?? key;

  /**
   * Fill every [data-i18n] node from the table. textContent, never innerHTML.
   *
   * Named `fill`, not `apply`: harden() freezes Function.prototype, which makes
   * the inherited `apply` a non-writable data property, and assigning through
   * it from a module (always strict) throws. That threw on load and took both
   * tool pages down with it. A name that shadows nothing on the prototype
   * chain is the fix; the frozen prototype is not negotiable.
   *
   * Each of those nodes also carries its text in the markup, so the page reads
   * correctly before this runs and to anything that never runs it. This
   * overwrites identical text, which is the point: the markup and the table
   * cannot drift apart without the table winning, and the table is what app.js
   * uses for the labels it writes at runtime.
   */
  t.fill = (root = document) => {
    for (const el of root.querySelectorAll('[data-i18n]')) {
      el.textContent = t(el.dataset.i18n);
    }
    for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    }
    for (const el of root.querySelectorAll('[data-i18n-title]')) {
      el.title = t(el.dataset.i18nTitle);
    }
  };

  return t;
}
