// Copyright 2026 Observer Protocol, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

'use strict'

import { sha256 } from '@noble/hashes/sha256'
import { verifyPreimage, ObserverLightningVerifier } from '../index.js'

// helper: bytes → hex
function toHex (bytes) {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

// known test vector: preimage of all zeros → its SHA-256
const ZERO_PRE = '0'.repeat(64)
const ZERO_PRE_HASH = toHex(sha256(new Uint8Array(32)))

describe('verifyPreimage (pure)', () => {
  test('valid preimage → valid: true', () => {
    const r = verifyPreimage({ paymentHash: ZERO_PRE_HASH, preimage: ZERO_PRE })
    expect(r.valid).toBe(true)
    expect(r.paymentHash).toBe(ZERO_PRE_HASH)
    expect(r.computedHash).toBe(ZERO_PRE_HASH)
    expect(r.error).toBeUndefined()
  })

  test('mismatched preimage → valid: false', () => {
    const r = verifyPreimage({ paymentHash: ZERO_PRE_HASH, preimage: 'a'.repeat(64) })
    expect(r.valid).toBe(false)
    expect(r.computedHash).not.toBe(ZERO_PRE_HASH)
    expect(r.error).toMatch(/does not hash/)
  })

  test('case-insensitive paymentHash', () => {
    const r = verifyPreimage({ paymentHash: ZERO_PRE_HASH.toUpperCase(), preimage: ZERO_PRE })
    expect(r.valid).toBe(true)
  })

  test('strips 0x prefix', () => {
    const r = verifyPreimage({ paymentHash: '0x' + ZERO_PRE_HASH, preimage: '0x' + ZERO_PRE })
    expect(r.valid).toBe(true)
  })

  test('rejects invalid hash length', () => {
    const r = verifyPreimage({ paymentHash: 'abc', preimage: ZERO_PRE })
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/64-char hex/)
  })

  test('rejects invalid preimage length', () => {
    const r = verifyPreimage({ paymentHash: ZERO_PRE_HASH, preimage: 'abc' })
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/64-char hex/)
  })

  test('rejects non-hex characters', () => {
    const r = verifyPreimage({ paymentHash: 'z'.repeat(64), preimage: ZERO_PRE })
    expect(r.valid).toBe(false)
  })

  test('throws on missing args', () => {
    expect(() => verifyPreimage({})).toThrow(/hex strings/)
    expect(() => verifyPreimage(null)).toThrow(/object/)
  })
})

describe('ObserverLightningVerifier', () => {
  test('constructs with default fetch', () => {
    const v = new ObserverLightningVerifier()
    expect(v).toBeInstanceOf(ObserverLightningVerifier)
  })

  test('verifyPreimage method delegates to pure function', () => {
    const v = new ObserverLightningVerifier()
    const r = v.verifyPreimage({ paymentHash: ZERO_PRE_HASH, preimage: ZERO_PRE })
    expect(r.valid).toBe(true)
  })

  test('verifyWithReputation rejects without API key', async () => {
    const v = new ObserverLightningVerifier()
    await expect(v.verifyWithReputation({
      paymentHash: ZERO_PRE_HASH, preimage: ZERO_PRE, presenterRole: 'payee'
    })).rejects.toThrow(/apiKey/)
  })

  test('verifyWithReputation short-circuits on invalid preimage (no network call)', async () => {
    let called = false
    const fakeFetch = async () => { called = true; return { ok: true, status: 200, text: async () => '{}' } }
    const v = new ObserverLightningVerifier({ apiKey: 'fake', fetchImpl: fakeFetch })
    const r = await v.verifyWithReputation({
      paymentHash: ZERO_PRE_HASH,
      preimage: 'a'.repeat(64),
      presenterRole: 'payer'
    })
    expect(r.valid).toBe(false)
    expect(r.tier).toBe('rejected')
    expect(called).toBe(false)
  })

  test('verifyWithReputation maps tier labels correctly', async () => {
    const fakeFetch = async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ verified: true, verification_tier: 'payee_attestation', reputation_contribution: { score: 1.0 } })
    })
    const v = new ObserverLightningVerifier({ apiKey: 'fake', fetchImpl: fakeFetch })
    const r = await v.verifyWithReputation({
      paymentHash: ZERO_PRE_HASH, preimage: ZERO_PRE, presenterRole: 'payee'
    })
    expect(r.valid).toBe(true)
    expect(r.tier).toBe('payee_attestation')
    expect(r.reputationContribution).toEqual({ score: 1.0 })
  })

  test('verifyWithReputation handles HTTP errors with attached body', async () => {
    const fakeFetch = async () => ({
      ok: false, status: 401,
      text: async () => JSON.stringify({ detail: { error: 'unauthorized' } })
    })
    const v = new ObserverLightningVerifier({ apiKey: 'fake', fetchImpl: fakeFetch })
    await expect(v.verifyWithReputation({
      paymentHash: ZERO_PRE_HASH, preimage: ZERO_PRE, presenterRole: 'payee'
    })).rejects.toMatchObject({ status: 401 })
  })
})
