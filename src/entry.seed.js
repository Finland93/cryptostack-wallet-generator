/**
 * Entry point for bip39-seed-phrase-generator.html.
 *
 * The first import must stay first: see core/harden-first.js.
 */
import './core/harden-first.js';
import { boot } from './ui/common.js';
import { setupSeed } from './ui/seed.js';

boot(setupSeed);
