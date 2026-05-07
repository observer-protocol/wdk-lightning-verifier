// Copyright 2026 Observer Protocol, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

'use strict'

import { verifyPreimage } from './preimage.js'

const DEFAULT_API_BASE = 'https://api.observerprotocol.org'
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000

/**
 * @typedef {object} ObserverLightningVerifierConfig
 * @property {string} [apiBase] - OP API base URL (for `verifyWithReputation`).
 * @property {string} [apiKey] - Integrator API key (required for `verifyWithReputation`).
 * @property {number} [requestTimeoutMs] - Per-request timeout for backend calls.
 * @property {typeof fetch} [fetchImpl] - Override `fetch` (for testing).
 */

/**
 * @typedef {object} VerifyWithReputationOptions
 * @property {string} paymentHash - SHA-256 payment hash, 64-char hex.
 * @property {string} preimage - Lightning preimage, 64-char hex.
 * @property {'payer' | 'payee'} presenterRole - Whether the caller paid or received.
 * @property {string} [receiptReference] - Idempotency key for the verification (e.g. an invoice request id).
 * @property {object} [payeeAttestation] - Signed counterparty receipt VC, if available.
 * @property {Record<string,unknown>} [metadata] - Free-form metadata.
 */

/**
 * @typedef {object} VerifyWithReputationResult
 * @property {boolean} valid - True iff verification passed at any tier.
 * @property {'payee_attestation' | 'lnd_query' | 'preimage_only' | 'rejected'} tier - Verification tier reached.
 * @property {object} [reputationContribution] - Reputation signal contributed back to OP, if any.
 * @property {Record<string,unknown>} [raw] - Raw backend response.
 * @property {string} [error] - Failure reason if valid=false.
 */

/**
 * Wallet-agnostic Lightning verifier. Two independent surfaces:
 *
 * - `verifyPreimage(...)` — local SHA-256 check (no network I/O, no API key).
 *   Sufficient for payee-side proof of payment receipt.
 *
 * - `verifyWithReputation(...)` — calls Observer Protocol's three-tier
 *   chain verifier (`POST /v1/chain/verify` with `chain="lightning"`),
 *   which evaluates payee attestations / LND query / preimage in priority
 *   order, and returns a tier label plus reputation contribution.
 *   Requires an integrator API key. Composes naturally with
 *   `@observer-protocol/wdk-protocol-trust` for the full Lightning trust stack.
 *
 * @example
 *   import { ObserverLightningVerifier } from '@observer-protocol/wdk-lightning-verifier'
 *   const verifier = new ObserverLightningVerifier({ apiKey: process.env.OP_INTEGRATOR_KEY })
 *
 *   // Local-only:
 *   const local = verifier.verifyPreimage({ paymentHash, preimage })
 *
 *   // Three-tier with reputation:
 *   const full = await verifier.verifyWithReputation({
 *     paymentHash, preimage, presenterRole: 'payee'
 *   })
 */
export class ObserverLightningVerifier {
  /**
   * @param {ObserverLightningVerifierConfig} [config]
   */
  constructor (config = {}) {
    /** @private */
    this._apiBase = (config.apiBase || DEFAULT_API_BASE).replace(/\/+$/, '')
    /** @private */
    this._apiKey = config.apiKey
    /** @private */
    this._timeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    /** @private */
    this._fetch = config.fetchImpl || globalThis.fetch
    if (typeof this._fetch !== 'function') {
      throw new Error('ObserverLightningVerifier requires a fetch implementation. Pass config.fetchImpl or run on a runtime that provides global fetch.')
    }
  }

  /**
   * Local SHA-256 verification of a preimage against an expected payment hash.
   * No network I/O, no API key required.
   *
   * @param {{paymentHash: string, preimage: string}} opts
   * @returns {{valid: boolean, paymentHash: string, computedHash: string, error?: string}}
   */
  verifyPreimage (opts) {
    return verifyPreimage(opts)
  }

  /**
   * Three-tier verification via Observer Protocol's chain verifier.
   * Calls `POST /v1/chain/verify` with `chain="lightning"`.
   *
   * @param {VerifyWithReputationOptions} opts
   * @returns {Promise<VerifyWithReputationResult>}
   */
  async verifyWithReputation (opts) {
    if (!opts || typeof opts !== 'object') {
      throw new TypeError('verifyWithReputation(opts): opts must be an object')
    }
    if (!this._apiKey) {
      throw new Error('verifyWithReputation requires config.apiKey (integrator API key)')
    }
    if (typeof opts.paymentHash !== 'string' || typeof opts.preimage !== 'string') {
      throw new TypeError('verifyWithReputation: paymentHash and preimage must be hex strings')
    }

    const local = verifyPreimage({ paymentHash: opts.paymentHash, preimage: opts.preimage })
    if (!local.valid) {
      return { valid: false, tier: 'rejected', error: local.error || 'preimage does not match payment hash' }
    }

    const body = {
      receipt_reference: opts.receiptReference || `lightning-${opts.paymentHash}`,
      chain: 'lightning',
      chain_specific: {
        payment_hash: opts.paymentHash,
        preimage: opts.preimage,
        presenter_role: opts.presenterRole,
        ...(opts.payeeAttestation && { payee_attestation: opts.payeeAttestation })
      },
      ...(opts.metadata && { metadata: opts.metadata })
    }

    const url = this._apiBase + '/v1/chain/verify'
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this._timeoutMs)
    let raw
    try {
      const res = await this._fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${this._apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      const text = await res.text()
      raw = text ? safeJsonParse(text) : null
      if (!res.ok) {
        const err = new Error(`OP /v1/chain/verify → HTTP ${res.status}`)
        err.status = res.status
        err.body = raw
        throw err
      }
    } finally {
      clearTimeout(timeoutId)
    }

    const tier = mapTier(raw?.verification_tier || raw?.tier)
    const valid = !!(raw?.verified ?? raw?.valid)
    return {
      valid,
      tier,
      ...(raw?.reputation_contribution && { reputationContribution: raw.reputation_contribution }),
      raw
    }
  }
}

/**
 * @param {string} text
 * @returns {unknown}
 * @private
 */
function safeJsonParse (text) {
  try { return JSON.parse(text) } catch { return text }
}

/**
 * @param {string | undefined} t
 * @returns {'payee_attestation' | 'lnd_query' | 'preimage_only' | 'rejected'}
 * @private
 */
function mapTier (t) {
  if (t === 'payee_attestation' || t === 'payee-attestation') return 'payee_attestation'
  if (t === 'lnd_query' || t === 'lnd-query') return 'lnd_query'
  if (t === 'preimage_only' || t === 'preimage-only') return 'preimage_only'
  return 'rejected'
}
