// Copyright 2026 Observer Protocol, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Demonstrates the two surfaces:
//   1. verifyPreimage(...) — local SHA-256 check, zero network I/O
//   2. ObserverLightningVerifier.verifyWithReputation(...) — three-tier
//      verification against the OP chain verifier (requires API key)
//
// Generates a synthetic preimage / payment hash pair so the example runs
// without depending on a real Lightning invoice.

import { sha256 } from '@noble/hashes/sha256'
import { verifyPreimage, ObserverLightningVerifier } from '../index.js'

function toHex (bytes) {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

// Synthetic: preimage = 32 bytes, paymentHash = SHA-256(preimage)
const preimage = toHex(new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff))
const paymentHash = toHex(sha256(new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff)))

console.log('@observer-protocol/wdk-lightning-verifier — example')
console.log('paymentHash:', paymentHash)
console.log('preimage:   ', preimage)
console.log('')

console.log('── 1. local verifyPreimage (no network) ──')
const local = verifyPreimage({ paymentHash, preimage })
console.log('  valid:        ', local.valid)
console.log('  computedHash: ', local.computedHash)
console.log('  matches:      ', local.computedHash === paymentHash)
console.log('')

console.log('── 2. tampered preimage (should fail) ──')
const tampered = verifyPreimage({ paymentHash, preimage: 'f'.repeat(64) })
console.log('  valid:        ', tampered.valid)
console.log('  error:        ', tampered.error)
console.log('')

console.log('── 3. verifyWithReputation (requires OP_INTEGRATOR_KEY) ──')
if (!process.env.OP_INTEGRATOR_KEY) {
  console.log('  OP_INTEGRATOR_KEY not set — skipping the three-tier path.')
  console.log('  Set the env var to demonstrate tier labels and reputation contribution.')
} else {
  const verifier = new ObserverLightningVerifier({
    apiKey: process.env.OP_INTEGRATOR_KEY,
    apiBase: process.env.OP_API_BASE
  })
  try {
    const full = await verifier.verifyWithReputation({
      paymentHash,
      preimage,
      presenterRole: 'payee'
    })
    console.log('  valid:                  ', full.valid)
    console.log('  tier:                   ', full.tier)
    console.log('  reputationContribution: ', JSON.stringify(full.reputationContribution || {}))
  } catch (err) {
    console.log('  failed:', err.message)
    if (err.body) console.log('  details:', JSON.stringify(err.body))
  }
}

console.log('')
console.log('done.')
