/**
 * slip10.js — SLIP-0010 key derivation over ed25519.
 *
 * BIP-32 proper does not work on ed25519 (no public-key arithmetic on the
 * private side), so Solana wallets use SLIP-0010, where *every* level must be
 * hardened. That is why Solana paths look like m/44'/501'/0'/0' — the trailing
 * apostrophes are not decoration.
 */

import {
  hmac,
  sha512,
  concatBytes,
  utf8ToBytes,
} from '../vendor-entry.js';

const HARDENED_OFFSET = 0x80000000;
const ED25519_CURVE = utf8ToBytes('ed25519 seed');

function ser32(index) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, index, false);
  return out;
}

function masterKey(seed) {
  const I = hmac(sha512, ED25519_CURVE, seed);
  return { key: I.subarray(0, 32), chainCode: I.subarray(32) };
}

function ckdPriv({ key, chainCode }, index) {
  if (index < HARDENED_OFFSET) {
    throw new Error('slip10/ed25519: only hardened derivation is defined');
  }
  const data = concatBytes(Uint8Array.of(0x00), key, ser32(index));
  const I = hmac(sha512, chainCode, data);
  return { key: I.subarray(0, 32), chainCode: I.subarray(32) };
}

/**
 * Derive the 32-byte ed25519 seed for a path such as "m/44'/501'/0'/0'".
 * Returns the raw seed; feed it to ed25519.getPublicKey to get the address.
 */
export function derivePathEd25519(path, seed) {
  const segments = path.split('/');
  if (segments[0] !== 'm') throw new Error(`slip10: bad path "${path}"`);

  let node = masterKey(seed);
  for (const segment of segments.slice(1)) {
    if (!/^\d+'?$/.test(segment)) throw new Error(`slip10: bad segment "${segment}"`);
    if (!segment.endsWith("'")) {
      throw new Error(
        `slip10: "${segment}" is unhardened; ed25519 requires every level hardened`,
      );
    }
    const index = parseInt(segment.slice(0, -1), 10);
    if (index >= HARDENED_OFFSET) throw new Error(`slip10: index too large`);
    node = ckdPriv(node, index + HARDENED_OFFSET);
  }
  return node.key;
}
