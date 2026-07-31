/**
 * harden-first.js — run the hardening before anything else is evaluated.
 *
 * This exists because of a bug worth explaining. app.js used to read:
 *
 *     import { harden, sealStorage } from './core/security.js';
 *     // Freeze prototypes before the crypto bundle or anything else has run.
 *     harden();
 *     sealStorage();
 *     import { CHAINS } from './core/chains.js';
 *     ...
 *
 * which does not do what the comment says, and cannot. ES module imports are
 * hoisted and their bodies are evaluated depth-first before a single statement
 * of the importing module runs. So chains.js, derive.js, vanity.js and the
 * whole of the cryptography were evaluated *first*, and harden() ran after
 * them — the exact opposite of the comment, which had been sitting there
 * asserting otherwise.
 *
 * A module's body, though, is evaluated in import order. So an entry whose
 * first import is this file gets the hardening applied before the modules
 * imported after it are evaluated. That is a real ordering guarantee rather
 * than a hopeful one, and it is the only reason this file is not just two
 * lines in the entry.
 *
 * Import it first, for its side effect, and import nothing else before it.
 */

import { harden, sealStorage } from './security.js';

harden();
sealStorage();
