#!/usr/bin/env node
/**
 * reachable.mjs — answers two questions the UI needs to answer honestly.
 *
 * 1. Which characters can actually appear right after the protocol-fixed part
 *    of an address? A TRON address is base58check over exactly 21 bytes that
 *    always start with 0x41, which pins the value range and makes most of the
 *    base58 alphabet unreachable in position 2. Letting someone burn an
 *    afternoon searching for "TX..." when no such address exists would be a
 *    cruel bug.
 *
 * 2. How fast is the engine, really? The UI quotes time estimates, and an
 *    estimate built on a guessed rate is worse than no estimate.
 *
 * Run: npm run reachable
 */

import { createSearch } from '../src/core/vanity.js';
import { CHAINS, VANITY_CHAINS } from '../src/core/chains.js';

const SAMPLES = 30000;

console.log(`Sampling ${SAMPLES.toLocaleString()} addresses per chain…\n`);

for (const chain of VANITY_CHAINS) {
  const search = createSearch(chain.id, { prefix: '' });
  const perPosition = [new Set(), new Set(), new Set()];
  const lengths = new Set();

  const t0 = performance.now();
  let n = 0;
  while (n < SAMPLES) {
    const hit = search.step(1);
    const raw = hit.address.slice(chain.fixed.length);
    const tail = chain.caseSensitive ? raw : raw.toLowerCase();
    for (let i = 0; i < 3; i++) if (tail[i]) perPosition[i].add(tail[i]);
    lengths.add(hit.address.length);
    n++;
  }
  const elapsed = (performance.now() - t0) / 1000;

  const order = (set) =>
    [...set].sort((a, b) => chain.alphabet.indexOf(a) - chain.alphabet.indexOf(b)).join('');

  console.log(`${chain.label}  (${chain.id})`);
  console.log(`  fixed prefix     "${chain.fixed}"`);
  console.log(`  address length   ${[...lengths].sort((a, b) => a - b).join(', ')}`);
  console.log(`  alphabet         ${chain.alphabet.length} chars`);
  for (let i = 0; i < 3; i++) {
    const got = perPosition[i];
    const full = got.size === chain.alphabet.length;
    console.log(
      `  position ${i + 1}       ${got.size}/${chain.alphabet.length}${
        full ? ' (unconstrained)' : '  -> ' + order(got)
      }`,
    );
  }
  console.log(`  speed            ${Math.round(n / elapsed).toLocaleString()} addr/sec/core\n`);
}

// Time estimates at the measured rate, for the docs.
console.log('Expected work for a prefix of length N (50% chance):\n');
const header = ['chain', ...[1, 2, 3, 4, 5, 6].map((n) => `${n} ch`)];
console.log('  ' + header.map((h) => h.padEnd(14)).join(''));
for (const chain of VANITY_CHAINS) {
  const row = [chain.id.padEnd(14)];
  for (const len of [1, 2, 3, 4, 5, 6]) {
    const space = Math.pow(chain.alphabet.length, len);
    row.push(fmt(space * Math.LN2).padEnd(14));
  }
  console.log('  ' + row.join(''));
}

function fmt(n) {
  if (n < 1e3) return Math.round(n) + '';
  if (n < 1e6) return (n / 1e3).toFixed(1) + 'K';
  if (n < 1e9) return (n / 1e6).toFixed(1) + 'M';
  if (n < 1e12) return (n / 1e9).toFixed(1) + 'B';
  return (n / 1e12).toFixed(1) + 'T';
}
