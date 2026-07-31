/**
 * codec.js — address encoding primitives.
 *
 * Pure functions, no I/O, no globals. Every function here takes bytes and
 * returns bytes or a string. That makes the whole file trivially testable,
 * which matters more than usual when a bug means someone loses money.
 */

import {
  secp256k1,
  sha256,
  ripemd160,
  keccak_256,
  base58,
  base58check as base58checkFactory,
  bech32,
  bech32m,
  bytesToHex,
  concatBytes,
  utf8ToBytes,
} from '../vendor-entry.js';

export const b58check = base58checkFactory(sha256);
export { base58 };

/** RIPEMD160(SHA256(x)) — the "hash160" used by every Bitcoin address type. */
export function hash160(bytes) {
  return ripemd160(sha256(bytes));
}

/** BIP-340 tagged hash: SHA256(SHA256(tag) || SHA256(tag) || msg). */
export function taggedHash(tag, ...messages) {
  const tagHash = sha256(utf8ToBytes(tag));
  return sha256(concatBytes(tagHash, tagHash, ...messages));
}

function bytesToBigIntBE(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

// ---------------------------------------------------------------------------
// Ethereum / EVM
// ---------------------------------------------------------------------------

/**
 * EIP-55 mixed-case checksum. Note this is a *display* checksum only: the
 * address is still the same 20 bytes regardless of casing.
 */
export function toChecksumAddress(addr) {
  const lower = addr.replace(/^0x/i, '').toLowerCase();
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

/**
 * EVM address from a public key.
 * Accepts compressed (33B) or uncompressed (65B); the keccak is always taken
 * over the 64-byte uncompressed X||Y body.
 */
export function evmAddressFromPubkey(pubkey) {
  const uncompressed =
    pubkey.length === 65
      ? pubkey
      : secp256k1.ProjectivePoint.fromHex(pubkey).toRawBytes(false);
  const hashed = keccak_256(uncompressed.subarray(1));
  return toChecksumAddress(bytesToHex(hashed.subarray(12)));
}

// ---------------------------------------------------------------------------
// TRON — an EVM address wearing a base58check coat
// ---------------------------------------------------------------------------

export function tronAddressFromPubkey(pubkey) {
  const uncompressed =
    pubkey.length === 65
      ? pubkey
      : secp256k1.ProjectivePoint.fromHex(pubkey).toRawBytes(false);
  const hashed = keccak_256(uncompressed.subarray(1));
  const body = concatBytes(Uint8Array.of(0x41), hashed.subarray(12));
  return b58check.encode(body);
}

// ---------------------------------------------------------------------------
// Bitcoin
// ---------------------------------------------------------------------------

/** BIP-44 legacy P2PKH — "1..." */
export function btcP2PKH(pubkeyCompressed, network = BTC_MAINNET) {
  return b58check.encode(
    concatBytes(Uint8Array.of(network.p2pkh), hash160(pubkeyCompressed)),
  );
}

/** BIP-49 P2WPKH nested in P2SH — "3..." */
export function btcP2SHP2WPKH(pubkeyCompressed, network = BTC_MAINNET) {
  const redeem = concatBytes(
    Uint8Array.of(0x00, 0x14),
    hash160(pubkeyCompressed),
  );
  return b58check.encode(
    concatBytes(Uint8Array.of(network.p2sh), hash160(redeem)),
  );
}

/** BIP-84 native SegWit v0 P2WPKH — "bc1q..." */
export function btcP2WPKH(pubkeyCompressed, network = BTC_MAINNET) {
  const words = bech32.toWords(hash160(pubkeyCompressed));
  return bech32.encode(network.bech32, [0, ...words]);
}

/**
 * BIP-86 Taproot key-path-only P2TR — "bc1p...".
 * Q = lift_x(P) + int(tagged_hash("TapTweak", x(P)))*G, with no script tree.
 */
export function btcP2TR(pubkeyCompressed, network = BTC_MAINNET) {
  const xOnly = pubkeyCompressed.subarray(1, 33);
  const tweak = bytesToBigIntBE(taggedHash('TapTweak', xOnly));
  if (tweak >= secp256k1.CURVE.n) throw new Error('taproot: tweak out of range');

  // Prefixing 0x02 is exactly BIP-340 lift_x: take the even-Y point.
  const internal = secp256k1.ProjectivePoint.fromHex(
    concatBytes(Uint8Array.of(0x02), xOnly),
  );
  const output = internal.add(secp256k1.ProjectivePoint.BASE.multiply(tweak));
  const outputXOnly = output.toRawBytes(true).subarray(1);

  const words = bech32m.toWords(outputXOnly);
  return bech32m.encode(network.bech32, [1, ...words]);
}

export const BTC_MAINNET = { p2pkh: 0x00, p2sh: 0x05, bech32: 'bc', wif: 0x80 };

/** Wallet Import Format, compressed-pubkey flavour. */
export function toWIF(privateKey, network = BTC_MAINNET) {
  return b58check.encode(
    concatBytes(Uint8Array.of(network.wif), privateKey, Uint8Array.of(0x01)),
  );
}
