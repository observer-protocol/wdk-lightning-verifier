// Copyright 2026 Observer Protocol, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

'use strict'

import { sha256 } from '@noble/hashes/sha256'

/**
 * @typedef {object} PreimageVerifyOptions
 * @property {string} paymentHash - 64-char hex SHA-256 payment hash from the invoice.
 * @property {string} preimage - 64-char hex 32-byte preimage to verify.
 */

/**
 * @typedef {object} PreimageVerifyResult
 * @property {boolean} valid - True iff `SHA-256(preimage) === paymentHash`.
 * @property {string} paymentHash - The expected payment hash (lowercase hex, no prefix).
 * @property {string} computedHash - The hash actually computed from the preimage.
 * @property {string} [error] - Failure reason when valid=false.
 */

/**
 * Verify that a Lightning preimage hashes to the expected payment hash.
 *
 * Per BOLT-11, the `payment_hash` field of an invoice is `SHA-256(preimage)`.
 * Possession of a matching preimage proves *receipt* of a Lightning payment
 * (the routing nodes only release the preimage on settlement). This is the
 * weakest of OP's three-tier Lightning verification model — sufficient as
 * a payee-side proof of payment receipt; insufficient as payer-side proof
 * of payment authorization (a probing attack on the network can intercept
 * preimages without authorization).
 *
 * Pure local function: no network I/O, no dependencies on a Lightning node.
 *
 * @param {PreimageVerifyOptions} opts
 * @returns {PreimageVerifyResult}
 *
 * @example
 *   const result = verifyPreimage({
 *     paymentHash: 'd2b08af96eb7a17f7b9c39e29c4d2bf5d7c4ca1c4ee0e2e0e74e74e74e74e74e',
 *     preimage:    'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'
 *   })
 *   if (!result.valid) throw new Error(result.error)
 */
export function verifyPreimage (opts) {
  if (!opts || typeof opts !== 'object') {
    throw new TypeError('verifyPreimage(opts): opts must be an object')
  }
  const { paymentHash, preimage } = opts
  if (typeof paymentHash !== 'string' || typeof preimage !== 'string') {
    throw new TypeError('verifyPreimage: both paymentHash and preimage must be hex strings')
  }
  const cleanHash = stripHexPrefix(paymentHash).toLowerCase()
  const cleanPre = stripHexPrefix(preimage).toLowerCase()
  if (!/^[0-9a-f]+$/i.test(cleanHash) || cleanHash.length !== 64) {
    return {
      valid: false,
      paymentHash: cleanHash,
      computedHash: '',
      error: 'paymentHash must be 64-char hex (32 bytes)'
    }
  }
  if (!/^[0-9a-f]+$/i.test(cleanPre) || cleanPre.length !== 64) {
    return {
      valid: false,
      paymentHash: cleanHash,
      computedHash: '',
      error: 'preimage must be 64-char hex (32 bytes)'
    }
  }
  const preBytes = hexToBytes(cleanPre)
  const computed = bytesToHex(sha256(preBytes))
  return {
    valid: computed === cleanHash,
    paymentHash: cleanHash,
    computedHash: computed,
    ...(computed !== cleanHash && { error: 'preimage does not hash to payment_hash' })
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * @param {string} s
 * @returns {string}
 * @private
 */
function stripHexPrefix (s) {
  return s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s
}

/**
 * @param {string} hex
 * @returns {Uint8Array}
 * @private
 */
function hexToBytes (hex) {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 * @private
 */
function bytesToHex (bytes) {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}
