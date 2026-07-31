/**
 * chains.js — the single registry every other module reads from.
 *
 * Adding a chain means adding one entry here. Nothing else in the codebase
 * hardcodes a coin type, a path, or an alphabet.
 */

import {
  btcP2PKH,
  btcP2SHP2WPKH,
  btcP2WPKH,
  btcP2TR,
  evmAddressFromPubkey,
  tronAddressFromPubkey,
  base58 as base58Codec,
} from './codec.js';

export const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const BECH32_ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
export const HEX_ALPHABET = '0123456789abcdef';

/**
 * `curve`        which keypair type the chain uses
 * `path`         derivation path template; {a} = account, {i} = address index
 * `fromPubkey`   public key bytes -> address string
 * `fixed`        the part of the address the protocol forces on you
 * `alphabet`     legal characters for the *searchable* part of the address
 * `caseSensitive` whether a vanity prefix distinguishes upper/lowercase
 * `secondChar`   reachable characters immediately after `fixed`, when the
 *                encoding constrains them (see tools/reachable.mjs)
 */
export const CHAINS = {
  eth: {
    id: 'eth',
    label: 'Ethereum / EVM',
    short: 'EVM',
    note: 'Also Polygon, BNB Chain, Arbitrum, Optimism, Base, Avalanche C-Chain — any chain that uses secp256k1 + keccak addresses.',
    curve: 'secp256k1',
    path: "m/44'/60'/{a}'/0/{i}",
    fromPubkey: evmAddressFromPubkey,
    fixed: '0x',
    alphabet: HEX_ALPHABET,
    caseSensitive: false,
    seedOutput: true,
    vanity: true,
    pubkeyForm: 'uncompressed',
  },

  btc: {
    id: 'btc',
    label: 'Bitcoin — Native SegWit',
    short: 'BTC',
    note: 'BIP-84 bech32. The default for modern wallets; cheapest to spend from.',
    curve: 'secp256k1',
    path: "m/84'/0'/{a}'/0/{i}",
    fromPubkey: btcP2WPKH,
    fixed: 'bc1q',
    alphabet: BECH32_ALPHABET,
    caseSensitive: false,
    seedOutput: true,
    vanity: true,
  },

  btc_taproot: {
    id: 'btc_taproot',
    label: 'Bitcoin — Taproot',
    short: 'BTC',
    note: 'BIP-86 bech32m.',
    curve: 'secp256k1',
    path: "m/86'/0'/{a}'/0/{i}",
    fromPubkey: btcP2TR,
    fixed: 'bc1p',
    alphabet: BECH32_ALPHABET,
    caseSensitive: false,
    seedOutput: true,
    vanity: true,
  },

  btc_legacy: {
    id: 'btc_legacy',
    label: 'Bitcoin — Legacy',
    short: 'BTC',
    note: 'BIP-44 P2PKH. Widest compatibility, highest fees.',
    curve: 'secp256k1',
    path: "m/44'/0'/{a}'/0/{i}",
    fromPubkey: btcP2PKH,
    fixed: '1',
    alphabet: BASE58_ALPHABET,
    caseSensitive: true,
    seedOutput: true,
    vanity: true,
  },

  btc_nested: {
    id: 'btc_nested',
    label: 'Bitcoin — Nested SegWit',
    short: 'BTC',
    note: 'BIP-49 P2SH-P2WPKH.',
    curve: 'secp256k1',
    path: "m/49'/0'/{a}'/0/{i}",
    fromPubkey: btcP2SHP2WPKH,
    fixed: '3',
    alphabet: BASE58_ALPHABET,
    caseSensitive: true,
    seedOutput: true,
    vanity: false,
  },

  sol: {
    id: 'sol',
    label: 'Solana',
    short: 'SOL',
    note: 'Phantom / Solflare / Backpack default path. The address is the raw ed25519 public key, so the whole string is searchable.',
    curve: 'ed25519',
    path: "m/44'/501'/{a}'/0'",
    fromPubkey: (pubkey) => base58Codec.encode(pubkey),
    fixed: '',
    alphabet: BASE58_ALPHABET,
    caseSensitive: true,
    seedOutput: true,
    vanity: true,
  },

  sol_cli: {
    id: 'sol_cli',
    label: 'Solana — CLI / Ledger',
    short: 'SOL',
    note: "The shorter m/44'/501'/{a}' path used by solana-keygen and Ledger.",
    curve: 'ed25519',
    path: "m/44'/501'/{a}'",
    fromPubkey: (pubkey) => base58Codec.encode(pubkey),
    fixed: '',
    alphabet: BASE58_ALPHABET,
    caseSensitive: true,
    seedOutput: false,
    vanity: false,
  },

  tron: {
    id: 'tron',
    label: 'TRON',
    short: 'TRX',
    note: 'A keccak address like Ethereum, re-encoded as base58check with a 0x41 version byte.',
    curve: 'secp256k1',
    path: "m/44'/195'/{a}'/0/{i}",
    fromPubkey: tronAddressFromPubkey,
    fixed: 'T',
    alphabet: BASE58_ALPHABET,
    caseSensitive: true,
    seedOutput: true,
    vanity: true,
    pubkeyForm: 'uncompressed',
    // A TRON address is base58check over exactly 21 bytes that always begin
    // 0x41, so the encoded value is locked into a narrow band and the second
    // character can only land in a contiguous slice of the alphabet.
    // Verified empirically over 200k addresses (tools/reachable.mjs):
    // lowercase is unreachable. "Tabc…" does not exist and never will.
    secondChar: '9ABCDEFGHJKLMNPQRSTUVWXYZ',
  },
};

export const CHAIN_LIST = Object.values(CHAINS);
export const VANITY_CHAINS = CHAIN_LIST.filter((c) => c.vanity);
export const SEED_CHAINS = CHAIN_LIST.filter((c) => c.seedOutput);

export function resolvePath(chain, account = 0, index = 0) {
  return chain.path
    .replace('{a}', String(account))
    .replace('{i}', String(index));
}

/**
 * How many addresses you expect to try per hit.
 *
 * Case-insensitive alphabets are quoted at their true size: searching "ab" in
 * a bech32 address does not care about case because the encoding has none.
 */
export function difficulty(chain, pattern) {
  if (!pattern) return 1;
  const space = chain.caseSensitive ? chain.alphabet.length : chain.alphabet.length;
  return Math.pow(space, pattern.length);
}

/** Characters in `pattern` that this chain's encoding can never produce. */
export function illegalChars(chain, pattern) {
  const alphabet = chain.caseSensitive
    ? chain.alphabet
    : chain.alphabet.toLowerCase();
  const seen = new Set();
  for (const ch of pattern) {
    const test = chain.caseSensitive ? ch : ch.toLowerCase();
    if (!alphabet.includes(test)) seen.add(ch);
  }
  return [...seen];
}
