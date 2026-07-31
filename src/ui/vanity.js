/**
 * vanity.js — the vanity address page.
 *
 * Loaded only by vanity-address-generator.html. The risk and security pages
 * ship no JavaScript at all, which is why this is a separate module rather
 * than one bundle for the whole site.
 */

import { CHAINS, VANITY_CHAINS, difficulty, illegalChars } from '../core/chains.js';
import { addressFromPrivateKey } from '../core/derive.js';
import { createSearch, probabilityAfter } from '../core/vanity.js';
import { wipe } from '../core/security.js';
import { t, $, $$, el, nf, bigCount, duration, renderSecretCard } from './common.js';

class VanityRunner {
  constructor() {
    this.workers = [];
    this.fallbackTimer = null;
    this.running = false;
  }

  start(config, { onProgress, onMatch, onError }) {
    this.stop();
    this.running = true;
    this.onProgress = onProgress;
    this.onMatch = onMatch;

    // The worker source travels inside this page as a string and starts from a
    // blob. There is no worker file to load: a page opened from a folder has no
    // origin to load one from, and there is only one build now, so this is the
    // only path rather than a fallback.
    const source = self.__CSWG_WORKER_SOURCE__;

    try {
      if (!source) throw new Error('worker source missing from the build');
      this.blobUrl = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
      for (let i = 0; i < config.threads; i++) {
        const worker = new Worker(this.blobUrl);
        worker.onmessage = (e) => this.#handle(e.data);
        worker.onerror = () => this.#degrade(config);
        worker.postMessage({ cmd: 'start', ...config });
        this.workers.push(worker);
      }
    } catch {
      // Some browsers refuse a blob worker from a file:// page, whose origin is
      // opaque. Rather than showing an error, run on the main thread: slower by
      // the number of cores, but it works, and working from a folder is the
      // point.
      this.#degrade(config);
    }
  }

  #handle(msg) {
    if (!this.running) return;
    if (msg.type === 'progress') this.onProgress(msg.attempts);
    else if (msg.type === 'match') this.onMatch(msg);
  }

  /** Single-threaded fallback, chunked so the page stays responsive. */
  #degrade(config) {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    document.body.dataset.degraded = 'true';

    const search = createSearch(config.chainId, {
      prefix: config.prefix,
      suffix: config.suffix,
    });
    const tick = () => {
      if (!this.running) return;
      const deadline = performance.now() + 40;
      let attempts = 0;
      let hit = null;
      while (performance.now() < deadline && !hit) {
        const r = search.step(128);
        attempts += r.attempts;
        if (r.found) hit = r;
      }
      this.onProgress(attempts);
      if (hit) {
        this.onMatch({ address: hit.address, privateKey: hit.privateKey });
        if (config.single !== false) return this.stop();
      }
      this.fallbackTimer = setTimeout(tick, 0);
    };
    tick();
  }

  stop() {
    this.running = false;
    for (const worker of this.workers) {
      worker.postMessage({ cmd: 'stop' });
      worker.terminate();
    }
    this.workers = [];
    clearTimeout(this.fallbackTimer);
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
  }
}

export function setupVanity() {
  const runner = new VanityRunner();
  const chainSel = $('#v-chain');
  const prefixIn = $('#v-prefix');
  const suffixIn = $('#v-suffix');
  const threadsIn = $('#v-threads');
  const startBtn = $('#v-start');
  const stopBtn = $('#v-stop');
  const clearBtn = $('#v-clear');
  const results = $('#v-results');
  const notice = $('#v-notice');

  for (const chain of VANITY_CHAINS) {
    chainSel.append(el('option', { value: chain.id, text: chain.label }));
  }
  const cores = navigator.hardwareConcurrency || 4;
  threadsIn.max = String(Math.max(1, cores));
  threadsIn.value = String(Math.max(1, cores - 1));

  let state = { attempts: 0, started: 0, rate: 0, lastAttempts: 0, lastTime: 0 };
  let matches = 0;

  const chain = () => CHAINS[chainSel.value];

  function pattern() {
    const c = chain();
    const clean = (s) => s.replace(/\s/g, '');
    let prefix = clean(prefixIn.value);
    const suffix = clean(suffixIn.value);
    // Someone will paste "0x" or "bc1q" into the prefix box. Take it off
    // rather than searching for an address that starts with it twice.
    if (c.fixed && prefix.toLowerCase().startsWith(c.fixed.toLowerCase())) {
      prefix = prefix.slice(c.fixed.length);
      prefixIn.value = prefix;
    }
    return { prefix, suffix };
  }

  /** Everything the user needs to know before pressing start. */
  function validate() {
    const c = chain();
    const { prefix, suffix } = pattern();
    const problems = [];

    const bad = [...new Set([...illegalChars(c, prefix), ...illegalChars(c, suffix)])];
    if (bad.length) {
      problems.push({
        level: 'bad',
        text: `"${bad.join('", "')}" cannot appear in a ${c.short} address. Its alphabet is: ${c.alphabet}`,
      });
    }

    if (c.secondChar && prefix && !c.secondChar.includes(prefix[0])) {
      problems.push({
        level: 'bad',
        text: `A ${c.short} address cannot have "${prefix[0]}" right after "${c.fixed}". Only these are reachable: ${c.secondChar}`,
      });
    }

    const space = difficulty(c, prefix) * difficulty(c, suffix);
    const expected = space * Math.LN2;
    return { problems, space, expected, prefix, suffix, chain: c };
  }

  function renderEstimate() {
    const v = validate();
    notice.replaceChildren();
    const impossible = v.problems.some((p) => p.level === 'bad');

    for (const problem of v.problems) {
      notice.append(
        el('p', { class: `notice notice-${problem.level}` }, [
          el('strong', { text: t('vanity.impossible') + ': ' }),
          document.createTextNode(problem.text),
        ]),
      );
    }

    const total = (v.prefix + v.suffix).length;
    $('#v-difficulty').textContent = total ? '1 : ' + bigCount(v.space) : '—';
    $('#v-expected').textContent = total ? bigCount(v.expected) : '—';

    const rate = state.rate || estimateRate(v.chain);
    $('#v-eta').textContent = total ? duration(v.expected / rate) : '—';

    startBtn.disabled = impossible;

    // Say the quiet part out loud once a search stops being a coffee break.
    const seconds = v.expected / rate;
    if (!impossible && seconds > 3600 * 6) {
      notice.append(
        el('p', { class: 'notice notice-warn' }, [
          el('strong', { text: t('common.warning') + ': ' }),
          document.createTextNode(
            `This pattern needs about ${bigCount(v.expected)} tries — roughly ${duration(seconds)} on this machine. ` +
              `Each extra character multiplies that by ${v.chain.alphabet.length}.`,
          ),
        ]),
      );
    }
  }

  // Rough per-core rates measured with tools/reachable.mjs; only used before a
  // real rate is known, and replaced by the measured one within a second.
  const BASE_RATES = { eth: 9500, tron: 9300, btc: 11600, btc_legacy: 10400, btc_taproot: 1600, sol: 3800 };
  function estimateRate(c) {
    return (BASE_RATES[c.id] ?? 5000) * Math.max(1, parseInt(threadsIn.value, 10) || 1);
  }

  function tick() {
    const now = performance.now();
    const elapsed = (now - state.started) / 1000;
    $('#v-attempts').textContent = bigCount(state.attempts);
    $('#v-elapsed').textContent = duration(elapsed);

    const dt = (now - state.lastTime) / 1000;
    if (dt >= 0.5) {
      state.rate = (state.attempts - state.lastAttempts) / dt;
      state.lastAttempts = state.attempts;
      state.lastTime = now;
    }
    $('#v-rate').textContent = bigCount(state.rate);

    const { space } = validate();
    $('#v-probability').textContent =
      space > 1 ? (probabilityAfter(state.attempts, space) * 100).toFixed(1) + '%' : '100%';
  }

  let timer = null;

  function start() {
    const v = validate();
    if (v.problems.some((p) => p.level === 'bad')) return;

    state = { attempts: 0, started: performance.now(), rate: 0, lastAttempts: 0, lastTime: performance.now() };
    startBtn.disabled = true;
    stopBtn.disabled = false;
    document.body.dataset.searching = 'true';
    $('#v-status').textContent = t('vanity.running');

    runner.start(
      {
        chainId: v.chain.id,
        prefix: v.prefix,
        suffix: v.suffix,
        threads: Math.max(1, Math.min(32, parseInt(threadsIn.value, 10) || 1)),
        single: true,
      },
      {
        onProgress: (n) => {
          state.attempts += n;
        },
        onMatch: (msg) => {
          addMatch(msg, v.chain);
          stop();
        },
      },
    );
    timer = setInterval(tick, 200);
  }

  function stop() {
    runner.stop();
    clearInterval(timer);
    tick();
    startBtn.disabled = false;
    stopBtn.disabled = true;
    document.body.dataset.searching = 'false';
    $('#v-status').textContent = t('vanity.idle');
  }

  function addMatch(msg, c) {
    matches++;
    $('#v-empty')?.remove();

    const bytes = msg.privateKey instanceof Uint8Array ? msg.privateKey : new Uint8Array(msg.privateKey);
    const derived = addressFromPrivateKey(bytes, c.id);

    // Independent re-derivation. If a worker ever hands back a key that does
    // not regenerate its address, that is a catastrophic bug and the user must
    // not be shown a wallet they cannot spend from.
    if (derived.address !== msg.address) {
      results.prepend(
        el('div', { class: 'match match-error' }, [
          el('p', {
            text: 'INTERNAL ERROR: key does not regenerate the claimed address. Result discarded. Do not use.',
          }),
        ]),
      );
      return;
    }

    results.prepend(renderSecretCard({
      title: c.label,
      subtitle: highlightPattern(msg.address, c),
      rows: [
        [t('seed.address'), derived.address, false],
        [derived.privateKeyExportLabel ?? t('seed.privkey'), derived.privateKeyExport ?? derived.privateKeyHex, true],
        ...(derived.privateKeyExport ? [[t('seed.privkey') + ' (hex)', derived.privateKeyHex, true]] : []),
      ],
      meta: `${nf().format(msg.attempts ?? state.attempts)} tries · ${duration((performance.now() - state.started) / 1000)}`,
    }));
    wipe(bytes);
  }

  /** Show which part of the address the user actually asked for. */
  function highlightPattern(address, c) {
    const { prefix, suffix } = pattern();
    const frag = document.createDocumentFragment();
    let rest = address;

    const head = c.fixed.length + prefix.length;
    if (c.fixed) frag.append(el('span', { class: 'addr-fixed', text: address.slice(0, c.fixed.length) }));
    if (prefix) frag.append(el('span', { class: 'addr-hit', text: address.slice(c.fixed.length, head) }));
    rest = address.slice(head);
    const tailStart = rest.length - suffix.length;
    frag.append(el('span', { text: suffix ? rest.slice(0, tailStart) : rest }));
    if (suffix) frag.append(el('span', { class: 'addr-hit', text: rest.slice(tailStart) }));
    return frag;
  }

  chainSel.addEventListener('change', () => {
    const c = chain();
    prefixIn.placeholder = c.fixed ? c.fixed + '…' : 'abc…';
    $('#v-alphabet').textContent = c.alphabet;
    $('#v-note').textContent = c.note;
    renderEstimate();
  });
  for (const input of [prefixIn, suffixIn, threadsIn]) {
    input.addEventListener('input', renderEstimate);
  }
  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', stop);
  clearBtn.addEventListener('click', () => {
    results.replaceChildren();
    matches = 0;
  });

  chainSel.dispatchEvent(new Event('change'));
}
