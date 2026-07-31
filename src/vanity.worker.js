/**
 * vanity.worker.js
 *
 * One of these per core. Each runs an independent search with its own random
 * starting scalar, so N workers really are an N-fold speedup rather than N
 * copies of the same walk.
 *
 * The worker reports progress on a timer rather than per batch, because at
 * ~10k addresses/sec/core a message per batch would spend more time in
 * postMessage than in elliptic curve arithmetic.
 */

import { createSearch } from './core/vanity.js';

const BATCH = 512;
const REPORT_MS = 250;

let running = false;
let search = null;
let attempts = 0;
let lastReport = 0;
let stopAfterFirst = true;

self.onmessage = (event) => {
  const { cmd } = event.data;

  if (cmd === 'start') {
    const { chainId, prefix, suffix, single } = event.data;
    try {
      search = createSearch(chainId, { prefix, suffix });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err.message ?? err) });
      return;
    }
    attempts = 0;
    running = true;
    stopAfterFirst = single !== false;
    lastReport = performance.now();
    loop();
    return;
  }

  if (cmd === 'stop') {
    running = false;
  }
};

function loop() {
  if (!running || !search) return;

  const result = search.step(BATCH);
  attempts += result.attempts;

  if (result.found) {
    self.postMessage({
      type: 'match',
      address: result.address,
      // Transferring the key as bytes keeps it out of the string table for as
      // long as possible. It becomes a string on screen eventually, but there
      // is no reason to make an extra copy on the way.
      privateKey: result.privateKey,
      attempts,
    });
    if (stopAfterFirst) {
      running = false;
      self.postMessage({ type: 'progress', attempts, done: true });
      return;
    }
  }

  const now = performance.now();
  if (now - lastReport >= REPORT_MS) {
    self.postMessage({ type: 'progress', attempts });
    attempts = 0;
    lastReport = now;
  }

  // setTimeout(…, 0) rather than a tight while-loop: it yields to the event
  // loop so a 'stop' message can actually be delivered.
  setTimeout(loop, 0);
}
