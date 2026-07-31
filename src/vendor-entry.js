/**
 * vendor-entry.js
 *
 * The single point where third-party cryptography enters this project.
 * esbuild bundles this file into src/vendor-entry.js.
 *
 * Everything here comes from the @noble / @scure family (Paul Miller):
 * zero-dependency, independently audited, and the same code that ethers v6,
 * viem, and Solana's web3.js v2 rely on underneath.
 *
 * Deliberately NOT included: any library that performs network I/O.
 * If a dependency could call fetch(), it does not belong in a wallet tool.
 */

export { secp256k1 } from '@noble/curves/secp256k1';
export { ed25519 } from '@noble/curves/ed25519';

export { sha256 } from '@noble/hashes/sha256';
export { sha512 } from '@noble/hashes/sha512';
export { ripemd160 } from '@noble/hashes/ripemd160';
export { keccak_256 } from '@noble/hashes/sha3';
export { hmac } from '@noble/hashes/hmac';
export {
  bytesToHex,
  hexToBytes,
  concatBytes,
  utf8ToBytes,
  randomBytes,
} from '@noble/hashes/utils';

export * as bip39 from '@scure/bip39';
export { wordlist as wordlistEnglish } from '@scure/bip39/wordlists/english';
export { HDKey } from '@scure/bip32';
export { base58, base58check, bech32, bech32m } from '@scure/base';
