/**
 * Entry point for vanity-address-generator.html.
 *
 * The first import must stay first: see core/harden-first.js.
 */
import './core/harden-first.js';
import { boot } from './ui/common.js';
import { setupVanity } from './ui/vanity.js';

boot(setupVanity);
