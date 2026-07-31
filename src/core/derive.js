/**
 * derive.js — mnemonic -> seed -> addresses.
 *
 * The chain of trust here is: crypto.getRandomValues -> BIP-39 entropy ->
 * BIP-39 mnemonic -> PBKDF2-HMAC-SHA512 (2048 rounds) -> 64-byte seed ->
 * BIP-32 (secp256k1) or SLIP-0010 (ed25519) -> public key -> address.
 *
 * Nothing in this file touches the network, storage, or the DOM.
 */

import {
  bip39,
  wordlistEnglish,
  HDKey,
  ed25519,
  secp256k1,
  base58,
  bytesToHex,
  randomBytes,
} from '../vendor-entry.js';
import { CHAINS, resolvePath } from './chains.js';
import { derivePathEd25519 } from './slip10.js';
import { toWIF } from './codec.js';

export const WORDLIST = wordlistEnglish;

export const STRENGTHS = [
  { words: 12, entropyBits: 128 },
  { words: 15, entropyBits: 160 },
  { words: 18, entropyBits: 192 },
  { words: 21, entropyBits: 224 },
  { words: 24, entropyBits: 256 },
];

/**
 * Generate a fresh mnemonic. Defaults to 24 words / 256 bits.
 *
 * @scure/bip39 pulls entropy from crypto.getRandomValues via @noble/hashes.
 * We do not roll our own RNG, and we do not accept user-supplied "entropy"
 * from dice or mouse movement — a half-understood entropy source is how
 * people lose coins, and getRandomValues is already a CSPRNG.
 */
export function generateMnemonic(wordCount = 24) {
  const match = STRENGTHS.find((s) => s.words === wordCount);
  if (!match) throw new Error(`Unsupported word count: ${wordCount}`);
  return bip39.generateMnemonic(WORDLIST, match.entropyBits);
}

export function validateMnemonic(mnemonic) {
  const normalized = normalizeMnemonic(mnemonic);
  const words = normalized ? normalized.split(' ') : [];
  const unknown = words.filter((w) => !WORDLIST.includes(w));

  if (words.length === 0) return { ok: false, reason: 'empty', words: 0 };
  if (unknown.length) return { ok: false, reason: 'unknown-word', unknown, words: words.length };
  if (!STRENGTHS.some((s) => s.words === words.length)) {
    return { ok: false, reason: 'length', words: words.length };
  }
  if (!bip39.validateMnemonic(normalized, WORDLIST)) {
    return { ok: false, reason: 'checksum', words: words.length };
  }
  return { ok: true, words: words.length, normalized };
}

/** Lowercase, collapse whitespace, NFKD — as BIP-39 requires. */
export function normalizeMnemonic(mnemonic) {
  return String(mnemonic)
    .normalize('NFKD')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function mnemonicToSeed(mnemonic, passphrase = '') {
  return bip39.mnemonicToSeedSync(normalizeMnemonic(mnemonic), passphrase);
}

/**
 * Derive one address for one chain from a 64-byte BIP-39 seed.
 * Returns the private key too — the caller decides whether to show it.
 */
export function deriveAddress(seed, chainId, { account = 0, index = 0 } = {}) {
  const chain = CHAINS[chainId];
  if (!chain) throw new Error(`Unknown chain: ${chainId}`);
  const path = resolvePath(chain, account, index);

  if (chain.curve === 'ed25519') {
    const privateKey = derivePathEd25519(path, seed);
    const publicKey = ed25519.getPublicKey(privateKey);
    return {
      chainId,
      path,
      address: chain.fromPubkey(publicKey),
      publicKey: bytesToHex(publicKey),
      privateKeyHex: bytesToHex(privateKey),
      // Phantom et al. import a 64-byte base58 "secret key" = seed || pubkey.
      privateKeyExport: exportSolanaKeypair(privateKey, publicKey),
      privateKeyExportLabel: 'Solana keypair (base58, 64 bytes)',
    };
  }

  const root = HDKey.fromMasterSeed(seed);
  const node = root.derive(path);
  if (!node.privateKey) throw new Error(`Derivation produced no key for ${path}`);
  const publicKey = node.publicKey;

  const result = {
    chainId,
    path,
    address: chain.fromPubkey(publicKey),
    publicKey: bytesToHex(publicKey),
    privateKeyHex: '0x' + bytesToHex(node.privateKey),
  };

  if (chain.id.startsWith('btc')) {
    result.privateKeyExport = toWIF(node.privateKey);
    result.privateKeyExportLabel = 'WIF (compressed)';
  }
  return result;
}

/** Derive `count` consecutive addresses for a list of chains. */
/**
 * Derive `count` rows per chain.
 *
 * Which number the rows walk depends on the chain, and getting this wrong is
 * not cosmetic. A BIP-44 path ends in an address index, so consecutive wallets
 * are m/44'/60'/0'/0/0, .../1, .../2. Solana's path has no address index —
 * Phantom, Solflare and Backpack enumerate the *account* level instead, so
 * their second wallet is m/44'/501'/1'/0'. Walking {i} on a template that has
 * no {i} substitutes nothing: every row resolves to the same path and the table
 * lists one key three times under three different row numbers. That shipped,
 * and it is the sort of bug someone only finds after funding "account 3".
 *
 * So: walk {i} where the template has one, and walk {a} where it does not.
 */
export function deriveAccounts(seed, chainIds, { account = 0, count = 1 } = {}) {
  const out = [];
  for (const chainId of chainIds) {
    const chain = CHAINS[chainId];
    const walksIndex = chain.path.includes('{i}');
    const rows = [];
    for (let i = 0; i < count; i++) {
      rows.push(
        walksIndex
          ? deriveAddress(seed, chainId, { account, index: i })
          : deriveAddress(seed, chainId, { account: account + i, index: 0 }),
      );
    }
    out.push({ chain, rows });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Single private key -> address (the vanity path, no mnemonic involved)
// ---------------------------------------------------------------------------

export function addressFromPrivateKey(privateKeyBytes, chainId) {
  const chain = CHAINS[chainId];
  if (!chain) throw new Error(`Unknown chain: ${chainId}`);

  if (chain.curve === 'ed25519') {
    const publicKey = ed25519.getPublicKey(privateKeyBytes);
    return {
      address: chain.fromPubkey(publicKey),
      publicKey: bytesToHex(publicKey),
      privateKeyHex: bytesToHex(privateKeyBytes),
      privateKeyExport: exportSolanaKeypair(privateKeyBytes, publicKey),
      privateKeyExportLabel: 'Solana keypair (base58, 64 bytes)',
    };
  }

  const publicKey = secp256k1.getPublicKey(privateKeyBytes, true);
  const result = {
    address: chain.fromPubkey(publicKey),
    publicKey: bytesToHex(publicKey),
    privateKeyHex: '0x' + bytesToHex(privateKeyBytes),
  };
  if (chain.id.startsWith('btc')) {
    result.privateKeyExport = toWIF(privateKeyBytes);
    result.privateKeyExportLabel = 'WIF (compressed)';
  }
  return result;
}

/** Phantom/Solflare import format: base58 of (32-byte seed || 32-byte pubkey). */
function exportSolanaKeypair(seed32, publicKey) {
  const full = new Uint8Array(64);
  full.set(seed32, 0);
  full.set(publicKey, 32);
  return base58.encode(full);
}

export { randomBytes };
