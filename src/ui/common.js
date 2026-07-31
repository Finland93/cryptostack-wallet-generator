/**
 * common.js — the pieces both generators need.
 *
 * House rules for everything under src/ui/, enforced by review and by
 * test/invariants.test.mjs:
 *   1. No innerHTML anywhere. Every string from a key, an address or a user
 *      input reaches the DOM through textContent or a value property. There is
 *      no HTML-injection sink in this codebase to find.
 *   2. No storage. Nothing is written to localStorage, IndexedDB, cookies or
 *      the URL. Reloading the page loses everything, on purpose.
 *   3. No network. There is no fetch() here, and the CSP would refuse one.
 */

import { auditEnvironment, copyEphemeral } from '../core/security.js';
import { createTranslator } from '../core/i18n.js';

export { copyEphemeral };
export const t = createTranslator();
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export const nf = () => new Intl.NumberFormat('en-US');

export function bigCount(n) {
  if (!isFinite(n)) return '∞';
  if (n < 1e4) return nf().format(Math.round(n));
  const units = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (n >= size) return (n / size).toFixed(n / size < 10 ? 1 : 0) + suffix;
  }
  return String(Math.round(n));
}

export function duration(seconds) {
  if (!isFinite(seconds)) return '∞';
  if (seconds < 1) return '<1s';
  if (seconds < 90) return Math.round(seconds) + 's';
  const m = seconds / 60;
  if (m < 90) return Math.round(m) + 'min';
  const h = m / 60;
  if (h < 48) return h.toFixed(1) + 'h';
  const d = h / 24;
  if (d < 400) return Math.round(d) + 'd';
  const y = d / 365;
  if (y > 1e6) return bigCount(y) + ' yr';
  return y < 100 ? y.toFixed(1) + ' yr' : bigCount(y) + ' yr';
}

// ---------------------------------------------------------------------------
// Environment rail
// ---------------------------------------------------------------------------

export function renderRail() {
  const audit = auditEnvironment();
  const list = $('#rail-list');
  list.replaceChildren();

  for (const check of audit.checks) {
    list.append(
      el('div', { class: `rail-row rail-${check.level}` }, [
        el('span', { class: 'rail-led' }),
        el('span', { class: 'rail-label', 'data-i18n': `rail.${check.id}` }),
        el('span', { class: 'rail-value mono', text: check.value }),
      ]),
    );
  }
  t.fill(list);

  if (!audit.rng.ok) {
    document.body.dataset.rngBroken = 'true';
    for (const b of $$('button[data-generates]')) b.disabled = true;
  }
  return audit;
}

// ---------------------------------------------------------------------------
// A card that shows secrets behind a blur until asked
// ---------------------------------------------------------------------------

export function renderSecretCard({ title, subtitle, rows, meta }) {
  const card = el('div', { class: 'match' });
  card.append(
    el('div', { class: 'match-head' }, [
      el('span', { class: 'match-title', text: title }),
      meta ? el('span', { class: 'match-meta mono', text: meta }) : null,
    ]),
  );
  if (subtitle) card.append(el('div', { class: 'match-addr mono' }, [subtitle]));

  for (const [label, value, secret] of rows) {
    const valueNode = el('code', {
      class: 'mono field-value' + (secret ? ' field-secret' : ''),
      text: value,
    });
    const row = el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: label }),
      valueNode,
      el('div', { class: 'field-actions' }, [
        secret
          ? el('button', {
              class: 'btn-mini',
              text: t('seed.reveal'),
              onclick: (e) => {
                const shown = valueNode.classList.toggle('revealed');
                e.target.textContent = shown ? t('seed.hide') : t('seed.reveal');
              },
            })
          : null,
        el('button', {
          class: 'btn-mini',
          text: t('seed.copy'),
          onclick: async (e) => {
            const btn = e.target;
            try {
              await copyEphemeral(value);
              btn.textContent = '✓';
              setTimeout(() => (btn.textContent = t('seed.copy')), 1500);
            } catch {
              btn.textContent = '✗';
            }
          },
        }),
      ]),
    ]);
    card.append(row);
  }
  return card;
}

// ---------------------------------------------------------------------------

/**
 * Start a page: mark the environment, wire the tool, unhide the app.
 *
 * data-ready is what hides the boot notice. It is set last, and only if
 * everything above it ran, so a page that throws on the way here keeps its
 * "this page did not start" warning instead of showing a half-built wallet
 * generator.
 */
export function boot(setup) {
  const run = () => {
    if (document.querySelector('#rail-list')) renderRail();
    setup?.();
    t.fill();
    window.addEventListener('online', renderRail);
    window.addEventListener('offline', renderRail);
    document.body.dataset.ready = 'true';
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
}
