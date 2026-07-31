/**
 * seed.js — the BIP-39 seed phrase page.
 *
 * Loaded only by bip39-seed-phrase-generator.html.
 *
 * This page generates. It does not import: there is no field to put an existing
 * seed phrase into, deliberately, and the reasoning is in the comment where the
 * field used to be in pages/_seed.body.html.
 *
 * The phrase lives in `phrase` below and nowhere else. It is never the value of
 * an input element, which is not fussiness — a form control's value gets
 * autofilled, offered to the browser's password manager, restored on
 * back-navigation, and kept in the bfcache. A local variable is none of those
 * things. It reaches the DOM only as textContent, and only inside a blurred
 * grid.
 */

import { SEED_CHAINS } from '../core/chains.js';
import { generateMnemonic, mnemonicToSeed, deriveAccounts } from '../core/derive.js';
import { wipe } from '../core/security.js';
import { t, $, $$, el, copyEphemeral } from './common.js';

export function setupSeed() {
  const wordsSel = $('#s-words');
  const genBtn = $('#s-generate');
  const passIn = $('#s-passphrase');
  const countIn = $('#s-count');
  const clearBtn = $('#s-clear');
  const output = $('#s-output');
  const chainBox = $('#s-chains');
  const showKeys = $('#s-showkeys');

  /** The current phrase. Not in the DOM, not in an input, not on disk. */
  let phrase = null;

  for (const chain of SEED_CHAINS) {
    const id = `chk-${chain.id}`;
    const on = ['btc', 'eth', 'sol'].includes(chain.id);
    chainBox.append(
      el('label', { class: 'chip' }, [
        el('input', { type: 'checkbox', id, value: chain.id, checked: on || null }),
        el('span', { text: chain.label }),
      ]),
    );
  }

  const selectedChains = () =>
    $$('input[type=checkbox]', chainBox).filter((c) => c.checked).map((c) => c.value);

  function generate() {
    // The only source of entropy in this project. crypto.getRandomValues,
    // via @scure/bip39, and nothing else — no mouse wiggling, no dice, no
    // "extra" entropy anyone stirs in by hand.
    phrase = generateMnemonic(parseInt(wordsSel.value, 10));
    derive();
  }

  function derive() {
    if (!phrase) return;
    const chains = selectedChains();
    if (!chains.length) return;
    const mnemonic = phrase;

    const seed = mnemonicToSeed(mnemonic, passIn.value);
    const count = Math.max(1, Math.min(20, parseInt(countIn.value, 10) || 1));
    const groups = deriveAccounts(seed, chains, { count });

    output.replaceChildren();

    output.append(renderPhraseGrid(mnemonic));

    for (const { chain, rows } of groups) {
      const table = el('table', { class: 'addr-table' });
      const head = el('tr', {}, [
        el('th', { text: '#' }),
        el('th', { text: t('seed.path') }),
        el('th', { text: t('seed.address') }),
        showKeys.checked ? el('th', { text: t('seed.privkey') }) : null,
      ]);
      table.append(el('thead', {}, [head]));
      const body = el('tbody');
      rows.forEach((row, i) => {
        const key = row.privateKeyExport ?? row.privateKeyHex;
        body.append(
          el('tr', {}, [
            el('td', { class: 'idx mono', text: String(i) }),
            el('td', { class: 'mono dim', text: row.path }),
            el('td', { class: 'mono' }, [
              el('span', { text: row.address }),
              el('button', {
                class: 'btn-copy',
                title: t('seed.copy'),
                text: '⧉',
                onclick: () => copyEphemeral(row.address, { clearAfterMs: 0 }),
              }),
            ]),
            showKeys.checked
              ? el('td', { class: 'mono' }, [
                  el('code', { class: 'field-secret field-value', text: key }),
                ])
              : null,
          ]),
        );
      });
      table.append(body);

      output.append(
        el('section', { class: 'chain-block' }, [
          el('header', { class: 'chain-head' }, [
            el('h3', { text: chain.label }),
            el('span', { class: 'chain-note', text: chain.note }),
          ]),
          table,
        ]),
      );
    }

    wipe(seed);
  }

  function renderPhraseGrid(mnemonic) {
    const words = mnemonic.split(' ');
    const grid = el('ol', { class: 'phrase-grid field-secret', id: 's-phrase' });
    for (const word of words) grid.append(el('li', { class: 'mono', text: word }));

    return el('section', { class: 'phrase-block' }, [
      el('header', { class: 'chain-head' }, [
        el('h3', { text: `${words.length} ${t('common.words')}` }),
        el('div', { class: 'field-actions' }, [
          el('button', {
            class: 'btn-mini',
            id: 's-toggle',
            text: t('seed.reveal'),
            onclick: (e) => {
              const shown = grid.classList.toggle('revealed');
              e.target.textContent = shown ? t('seed.hide') : t('seed.reveal');
            },
          }),
          el('button', {
            class: 'btn-mini',
            text: t('seed.copy'),
            onclick: async (e) => {
              try {
                await copyEphemeral(mnemonic);
                e.target.textContent = t('seed.copied');
                setTimeout(() => (e.target.textContent = t('seed.copy')), 3000);
              } catch {
                e.target.textContent = '✗';
              }
            },
          }),
          el('button', { class: 'btn-mini', text: t('seed.print'), onclick: () => window.print() }),
        ]),
      ]),
      grid,
    ]);
  }

  genBtn.addEventListener('click', generate);
  showKeys.addEventListener('change', () => phrase && derive());
  passIn.addEventListener('input', () => phrase && derive());
  countIn.addEventListener('input', () => phrase && derive());
  for (const box of $$('input[type=checkbox]', chainBox)) {
    box.addEventListener('change', () => phrase && derive());
  }
  clearBtn.addEventListener('click', () => {
    phrase = null;
    passIn.value = '';
    output.replaceChildren();
  });
}
