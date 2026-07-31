/**
 * Cross-validation suite.
 *
 * Two independent sources of truth:
 *   1. The official test vectors published in BIP-39/49/84/86 and SLIP-0010.
 *   2. ethers and bitcoinjs-lib, re-deriving the same paths from scratch.
 *
 * If this file passes, the addresses this tool prints are the addresses a real
 * wallet will show when you restore the same mnemonic. That is the only
 * property that actually matters.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { HDNodeWallet, Mnemonic, Wallet } from 'ethers';
import * as bitcoin from 'bitcoinjs-lib';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';

import {
  generateMnemonic,
  validateMnemonic,
  mnemonicToSeed,
  deriveAddress,
  deriveAccounts,
  addressFromPrivateKey,
  WORDLIST,
} from '../src/core/derive.js';
import { CHAINS } from '../src/core/chains.js';
import { createSearch, buildMatcher } from '../src/core/vanity.js';
import { toChecksumAddress } from '../src/core/codec.js';

const bip32 = BIP32Factory(ecc);
bitcoin.initEccLib(ecc);

const ABANDON =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ABANDON24 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

// ---------------------------------------------------------------------------
// BIP-39
// ---------------------------------------------------------------------------

test('BIP-39 official vector: seed from mnemonic + TREZOR passphrase', () => {
  const seed = mnemonicToSeed(ABANDON, 'TREZOR');
  assert.equal(
    Buffer.from(seed).toString('hex'),
    'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04',
  );
});

test('wordlist is the real 2048-word BIP-39 English list', () => {
  assert.equal(WORDLIST.length, 2048);
  assert.equal(WORDLIST[0], 'abandon');
  assert.equal(WORDLIST[2047], 'zoo');
  assert.equal(WORDLIST[1377], 'promote'); // the word Grok's list corrupted
  for (const w of WORDLIST) assert.match(w, /^[a-z]{3,8}$/);
  assert.equal(new Set(WORDLIST).size, 2048);
});

test('generated mnemonics are valid and the right length', () => {
  for (const n of [12, 15, 18, 21, 24]) {
    const m = generateMnemonic(n);
    assert.equal(m.split(' ').length, n);
    assert.equal(validateMnemonic(m).ok, true);
    // ethers agrees it is a legal BIP-39 phrase
    assert.equal(Mnemonic.isValidMnemonic(m), true);
  }
});

test('generated mnemonics do not repeat', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(generateMnemonic(24));
  assert.equal(seen.size, 200);
});

test('validateMnemonic rejects a bad checksum, a bad word, and a bad length', () => {
  const bad = ABANDON.replace(/about$/, 'abandon');
  assert.equal(validateMnemonic(bad).reason, 'checksum');
  assert.equal(validateMnemonic('abandon promoteischer about').reason, 'unknown-word');
  assert.equal(validateMnemonic('abandon abandon about').reason, 'length');
});

// ---------------------------------------------------------------------------
// Ethereum
// ---------------------------------------------------------------------------

test('ETH matches the widely published vector for the abandon mnemonic', () => {
  const seed = mnemonicToSeed(ABANDON);
  const { address, path } = deriveAddress(seed, 'eth', { index: 0 });
  assert.equal(path, "m/44'/60'/0'/0/0");
  assert.equal(address, '0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
});

test('ETH agrees with ethers across 10 indices and 3 accounts', () => {
  const mnemonic = generateMnemonic(24);
  const seed = mnemonicToSeed(mnemonic);
  // NOTE: fromPhrase() already walks to m/44'/60'/0'/0/0, so derivePath() on it
  // would be relative. fromSeed() gives the actual root.
  const ethersRoot = HDNodeWallet.fromSeed(seed);

  for (let account = 0; account < 3; account++) {
    for (let i = 0; i < 10; i++) {
      const path = `m/44'/60'/${account}'/0/${i}`;
      const mine = deriveAddress(seed, 'eth', { account, index: i });
      const theirs = ethersRoot.derivePath(path);
      assert.equal(mine.address, theirs.address, `mismatch at ${path}`);
      assert.equal(mine.privateKeyHex, theirs.privateKey, `key mismatch at ${path}`);
    }
  }
});

test('ETH honours a BIP-39 passphrase the same way ethers does', () => {
  const passphrase = 'correct horse battery staple';
  const seed = mnemonicToSeed(ABANDON, passphrase);
  const mine = deriveAddress(seed, 'eth');
  const theirs = HDNodeWallet.fromPhrase(ABANDON, passphrase);
  assert.equal(mine.address, theirs.address);
  // and a different passphrase must give a different wallet
  const other = deriveAddress(mnemonicToSeed(ABANDON, 'x'), 'eth');
  assert.notEqual(mine.address, other.address);
});

test('EIP-55 checksum matches the reference cases', () => {
  const cases = [
    '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
    '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
  ];
  for (const c of cases) assert.equal(toChecksumAddress(c.toLowerCase()), c);
});

// ---------------------------------------------------------------------------
// Bitcoin
// ---------------------------------------------------------------------------

test('BIP-84 official vectors (native segwit)', () => {
  const seed = mnemonicToSeed(ABANDON);
  assert.equal(
    deriveAddress(seed, 'btc', { index: 0 }).address,
    'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
  );
  assert.equal(
    deriveAddress(seed, 'btc', { index: 1 }).address,
    'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g',
  );
});

test('BIP-86 official vectors (taproot)', () => {
  const seed = mnemonicToSeed(ABANDON);
  assert.equal(
    deriveAddress(seed, 'btc_taproot', { index: 0 }).address,
    'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr',
  );
  assert.equal(
    deriveAddress(seed, 'btc_taproot', { index: 1 }).address,
    'bc1p4qhjn9zdvkux4e44uhx8tc55attvtyu358kutcqkudyccelu0was9fqzwh',
  );
});

test('BIP-44 legacy vector', () => {
  const seed = mnemonicToSeed(ABANDON);
  assert.equal(
    deriveAddress(seed, 'btc_legacy', { index: 0 }).address,
    '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA',
  );
});

test('BIP-49 nested segwit vector', () => {
  const seed = mnemonicToSeed(ABANDON);
  assert.equal(
    deriveAddress(seed, 'btc_nested', { index: 0 }).address,
    '37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf',
  );
});

test('all four BTC address types agree with bitcoinjs-lib over 8 indices', () => {
  const mnemonic = generateMnemonic(24);
  const seed = Buffer.from(mnemonicToSeed(mnemonic));
  const root = bip32.fromSeed(seed);
  const network = bitcoin.networks.bitcoin;

  const builders = {
    btc_legacy: (pubkey) => bitcoin.payments.p2pkh({ pubkey, network }).address,
    btc_nested: (pubkey) =>
      bitcoin.payments.p2sh({
        redeem: bitcoin.payments.p2wpkh({ pubkey, network }),
        network,
      }).address,
    btc: (pubkey) => bitcoin.payments.p2wpkh({ pubkey, network }).address,
    btc_taproot: (pubkey) =>
      bitcoin.payments.p2tr({ internalPubkey: pubkey.subarray(1, 33), network }).address,
  };

  for (const [chainId, build] of Object.entries(builders)) {
    for (let i = 0; i < 8; i++) {
      const mine = deriveAddress(seed, chainId, { index: i });
      const node = root.derivePath(mine.path);
      assert.equal(build(Buffer.from(node.publicKey)), mine.address, `${chainId} index ${i}`);
    }
  }
});

test('WIF export round-trips through bitcoinjs-lib', () => {
  const seed = mnemonicToSeed(ABANDON);
  const mine = deriveAddress(seed, 'btc_legacy', { index: 0 });
  const root = bip32.fromSeed(Buffer.from(seed));
  assert.equal(mine.privateKeyExport, root.derivePath(mine.path).toWIF());
});

// ---------------------------------------------------------------------------
// Solana (SLIP-0010 / ed25519)
// ---------------------------------------------------------------------------

test('SLIP-0010 ed25519 official test vector 1', async () => {
  const { derivePathEd25519 } = await import('../src/core/slip10.js');
  const seed = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
  // From SLIP-0010, "Test vector 1 for ed25519"
  assert.equal(
    Buffer.from(derivePathEd25519('m', seed)).toString('hex'),
    '2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7',
  );
  assert.equal(
    Buffer.from(derivePathEd25519("m/0'", seed)).toString('hex'),
    '68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3',
  );
  assert.equal(
    Buffer.from(derivePathEd25519("m/0'/1'/2'/2'/1000000000'", seed)).toString('hex'),
    '8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793',
  );
});

test('SLIP-0010 refuses unhardened ed25519 derivation', async () => {
  const { derivePathEd25519 } = await import('../src/core/slip10.js');
  assert.throws(
    () => derivePathEd25519("m/44'/501'/0'/0", Buffer.alloc(64)),
    /unhardened/,
  );
});

test('SOL matches the known Phantom-path vector for the abandon mnemonic', () => {
  const seed = mnemonicToSeed(ABANDON);
  const { address, path } = deriveAddress(seed, 'sol', { account: 0 });
  assert.equal(path, "m/44'/501'/0'/0'");
  assert.equal(address, 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
});

test('SOL addresses are 32-byte base58 public keys', () => {
  const seed = mnemonicToSeed(generateMnemonic(24));
  for (let a = 0; a < 5; a++) {
    const { address, privateKeyExport } = deriveAddress(seed, 'sol', { account: a });
    assert.match(address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    // The 64-byte export must end with the public key it claims
    const raw = bs58decode(privateKeyExport);
    assert.equal(raw.length, 64);
    assert.equal(bs58encode(raw.subarray(32)), address);
  }
});

// ---------------------------------------------------------------------------
// TRON
// ---------------------------------------------------------------------------

test('TRON address is the EVM address of the same key re-encoded', () => {
  // TRON = base58check(0x41 || keccak(pubkey)[12:]). So the TRON address at a
  // path must decode back to the EVM address ethers derives for that same path.
  const mnemonic = generateMnemonic(24);
  const seed = mnemonicToSeed(mnemonic);
  const root = HDNodeWallet.fromSeed(seed);

  for (let i = 0; i < 5; i++) {
    const mine = deriveAddress(seed, 'tron', { index: i });
    const theirs = root.derivePath(`m/44'/195'/0'/0/${i}`);
    const decoded = bs58decode(mine.address);
    assert.equal(decoded[0], 0x41);
    const body = Buffer.from(decoded.subarray(1, 21)).toString('hex');
    assert.equal('0x' + body, theirs.address.toLowerCase());
    assert.match(mine.address, /^T[1-9A-HJ-NP-Za-km-z]{33}$/);
  }
});

test("TRON matches Ledger's published app-tron test vector", () => {
  // Source: github.com/LedgerHQ/app-tron — the abandon×11 + about seed.
  const seed = mnemonicToSeed(ABANDON);
  const first = deriveAddress(seed, 'tron', { index: 0 });
  assert.equal(first.address, 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH');
  assert.equal(
    first.privateKeyHex,
    '0xb5a4cea271ff424d7c31dc12a3e43e401df7a40d7412a15750f3f0b6b5449a28',
  );
  // …and the 21-byte on-chain form Ledger documents alongside it.
  assert.equal(
    Buffer.from(bs58decode(first.address).subarray(0, 21)).toString('hex'),
    '41c8599111f29c1e1e061265b4af93ea1f274ad78a',
  );
});

// ---------------------------------------------------------------------------
// 24-word phrases specifically (the tool's default)
// ---------------------------------------------------------------------------

test('a 24-word phrase derives consistently across all chains', () => {
  const seed = mnemonicToSeed(ABANDON24);
  assert.equal(validateMnemonic(ABANDON24).ok, true);
  const eth = deriveAddress(seed, 'eth');
  const theirs = HDNodeWallet.fromPhrase(ABANDON24);
  assert.equal(eth.address, theirs.address);
  for (const id of ['btc', 'btc_taproot', 'btc_legacy', 'sol', 'tron']) {
    assert.ok(deriveAddress(seed, id).address.length > 20, id);
  }
});

test('every row the table shows is a different wallet, on every chain', () => {
  const seed = mnemonicToSeed(ABANDON24);
  // Solana's path has no {i}, so walking the address index produced the same
  // key for row 0, 1 and 2 — three rows, one wallet, no warning. Any chain
  // whose rows are not all distinct is this bug again.
  for (const { chain, rows } of deriveAccounts(seed, Object.keys(CHAINS), { count: 3 })) {
    const paths = new Set(rows.map((r) => r.path));
    const addresses = new Set(rows.map((r) => r.address));
    const keys = new Set(rows.map((r) => r.privateKeyHex));
    assert.equal(paths.size, 3, `${chain.id}: rows share a derivation path`);
    assert.equal(addresses.size, 3, `${chain.id}: rows share an address`);
    assert.equal(keys.size, 3, `${chain.id}: rows share a private key`);
  }
});

test("Solana rows walk the account level, the way Phantom does", () => {
  const seed = mnemonicToSeed(ABANDON24);
  const [{ rows }] = deriveAccounts(seed, ['sol'], { count: 3 });
  assert.deepEqual(
    rows.map((r) => r.path),
    ["m/44'/501'/0'/0'", "m/44'/501'/1'/0'", "m/44'/501'/2'/0'"],
  );
});

// ---------------------------------------------------------------------------
// Vanity engine
// ---------------------------------------------------------------------------

test('vanity: found keys actually produce the claimed address', () => {
  for (const chainId of ['eth', 'btc', 'tron', 'sol']) {
    const search = createSearch(chainId, { prefix: '' });
    const hit = search.step(1);
    assert.equal(hit.found, true);
    const check = addressFromPrivateKey(hit.privateKey, chainId);
    assert.equal(check.address, hit.address, `${chainId}: key does not regenerate address`);
  }
});

test('vanity: a found EVM address really carries the prefix, and its key works in ethers', () => {
  const search = createSearch('eth', { prefix: 'ab' });
  let hit = null;
  for (let i = 0; i < 400 && !hit; i++) {
    const r = search.step(2000);
    if (r.found) hit = r;
  }
  assert.ok(hit, 'no hit for a 2-char prefix in 800k tries — engine is broken');
  assert.ok(hit.address.slice(2).toLowerCase().startsWith('ab'));

  const wallet = new Wallet('0x' + Buffer.from(hit.privateKey).toString('hex'));
  assert.equal(wallet.address, hit.address);
});

test('vanity: suffix matching works', () => {
  const search = createSearch('eth', { suffix: 'f' });
  let hit = null;
  for (let i = 0; i < 200 && !hit; i++) {
    const r = search.step(500);
    if (r.found) hit = r;
  }
  assert.ok(hit);
  assert.ok(hit.address.toLowerCase().endsWith('f'));
});

test('vanity: the walk advances past a hit instead of repeating it', () => {
  // An empty pattern matches everything, so every step(1) is a hit. Each one
  // must be a different key, or "find more" would loop on one result forever.
  const search = createSearch('eth', { prefix: '' });
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const hit = search.step(1);
    assert.equal(hit.found, true);
    seen.add(Buffer.from(hit.privateKey).toString('hex'));
  }
  assert.equal(seen.size, 500);
});

test('vanity: an impossible pattern never reports a hit', () => {
  // "z" is not a hex digit, so no EVM address can ever contain it.
  const search = createSearch('eth', { prefix: 'zzzz' });
  assert.equal(search.step(2000).found, false);
});

test('matcher respects case sensitivity per chain', () => {
  const evm = buildMatcher(CHAINS.eth, { prefix: 'AB' });
  assert.equal(evm('0xabcdef0000000000000000000000000000000000'), true);
  const sol = buildMatcher(CHAINS.sol, { prefix: 'AB' });
  assert.equal(sol('ABxyz'), true);
  assert.equal(sol('abxyz'), false);
});

test('matcher skips the protocol-fixed part of the address', () => {
  const btc = buildMatcher(CHAINS.btc, { prefix: 'test' });
  assert.equal(btc('bc1qtest0000'), true);
  assert.equal(btc('bc1q0000test'), false);
});

// helpers -------------------------------------------------------------------

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function bs58decode(str) {
  let n = 0n;
  for (const ch of str) {
    const i = B58.indexOf(ch);
    if (i < 0) throw new Error('bad base58');
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of str) {
    if (ch !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}
function bs58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}
