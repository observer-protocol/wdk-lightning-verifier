# @observer-protocol/wdk-lightning-verifier

> Verifiable Lightning for KYA: preimage proofs, transaction visibility, reputation attribution. **Wallet-agnostic.**

**Note**: This package is currently in beta (`0.1.0-beta.1`). The local verification path is production-ready; the three-tier path is a thin wrapper around Observer Protocol's chain verifier (`POST /v1/chain/verify` with `chain="lightning"`) and depends on that endpoint's stability.

---

## What this is

Three primitives for using Lightning payments as Know-Your-Agent signal:

1. **Preimage proofs.** Possession of a Lightning preimage that hashes to a known payment_hash is cryptographic evidence that a payment settled. The local `verifyPreimage(...)` function performs the SHA-256 check with no network I/O and no dependencies on a Lightning node.

2. **Transaction visibility.** When verifying with reputation, the package routes through Observer Protocol's three-tier model — payee attestation (strongest), LND query (medium), preimage-only (weakest, payee-side only) — and returns the tier reached.

3. **Reputation attribution.** Successful verifications contribute to the agent's KYA reputation on Observer Protocol via the `verifyWithReputation(...)` path. Reputation accrues to the agent identity, not the wallet — so reputation built on one Lightning wallet travels with the agent across rails and wallet implementations.

---

## Why it's separate from `@observer-protocol/wdk-protocol-trust`

The decision to ship this as an independent package — not as part of the WDK trust module — is deliberate.

**Lightning preimage verification works for *any* Lightning wallet, not just WDK.** A user holding an Alby wallet, an LND node, a Phoenix wallet, or a custodial Strike wallet all benefit from the same preimage primitive when proving they received a payment. Coupling the verifier to WDK would foreclose those integrations.

**`wdk-protocol-trust` is the WDK-shaped surface to OP's identity / attestation / handshake layer.** This package is the wallet-agnostic surface to OP's Lightning verification primitives. They compose; they don't conflate.

The strategic claim: **infrastructure, not features.** Building each primitive at the right level of abstraction — wallet-bound where the wallet matters, wallet-agnostic where it doesn't — is what makes the work durable across the inevitable wallet ecosystem fragmentation.

---

## Composition with WDK and with `wdk-protocol-trust`

```javascript
import ObserverTrustProtocol from '@observer-protocol/wdk-protocol-trust'
import {
  verifyPreimage,
  ObserverLightningVerifier
} from '@observer-protocol/wdk-lightning-verifier'
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'

// Identity layer (WDK-bound)
const account = new WalletAccountEvm(seedPhrase, "0'/0/0", { provider })
const trust = new ObserverTrustProtocol(account, { apiKey: process.env.OP_INTEGRATOR_KEY })

// Lightning layer (wallet-agnostic)
const lightning = new ObserverLightningVerifier({ apiKey: process.env.OP_INTEGRATOR_KEY })

// Pre-payment: bilateral identity handshake (WDK + OP)
const handshake = await trust.bilateralVerify('seller-agent-7')

// Settlement happens via your Lightning wallet (any wallet — not shown)
const { paymentHash, preimage } = await yourLightningWallet.payInvoice(invoice)

// Verify the Lightning leg with reputation contribution
const verification = await lightning.verifyWithReputation({
  paymentHash,
  preimage,
  presenterRole: 'payer'
})

// Attest the full payment to OP via the trust protocol
await trust.attestPayment({
  txHash: paymentHash,
  recipient: 'seller-agent-7',
  chain: 'lightning',
  metadata: { lightning_tier: verification.tier }
})
```

The composition is loose — the Lightning verifier never touches the WDK account; the trust protocol never touches a Lightning preimage. Each layer does one thing.

---

## Installation

```bash
npm install @observer-protocol/wdk-lightning-verifier
```

No peer dependencies. Pure JavaScript, single dependency on `@noble/hashes`.

Runtime: Node.js 18+ (uses native `fetch` for the three-tier path) or Bare.

---

## Usage

### Local-only — `verifyPreimage`

Pure function. No network I/O. No API key. Returns `{valid, paymentHash, computedHash, error?}`.

```javascript
import { verifyPreimage } from '@observer-protocol/wdk-lightning-verifier'

const result = verifyPreimage({
  paymentHash: '0xab5f8b5cb9435354c7b58603592d5faf081e17ceb05f7a7c67f4b666f12ca457',
  preimage:    '0x030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dc'
})

if (!result.valid) {
  throw new Error(result.error)  // e.g. "preimage does not hash to payment_hash"
}
```

Accepts hex with or without `0x` prefix, case-insensitive, strict 32-byte length on both inputs.

Use this when you need to check a preimage locally — payee-side proof of payment receipt, dispute resolution offline, batch validation of historical payments.

### Three-tier — `ObserverLightningVerifier.verifyWithReputation`

Wraps Observer Protocol's chain verifier. Requires an integrator API key. Returns the verification tier reached and any reputation contribution.

```javascript
import { ObserverLightningVerifier } from '@observer-protocol/wdk-lightning-verifier'

const verifier = new ObserverLightningVerifier({
  apiKey: process.env.OP_INTEGRATOR_KEY,
  apiBase: 'https://api.observerprotocol.org' // default
})

const result = await verifier.verifyWithReputation({
  paymentHash,
  preimage,
  presenterRole: 'payee', // or 'payer'
  payeeAttestation: {     // optional — signed counterparty receipt for tier-1 verification
    credential: { /* W3C VC */ }
  }
})

console.log(result.valid)                  // boolean
console.log(result.tier)                   // 'payee_attestation' | 'lnd_query' | 'preimage_only' | 'rejected'
console.log(result.reputationContribution) // signal contributed back to OP
```

#### Three-tier model

Per Observer Protocol's Lightning verification design:

| Tier | Evidence | Strength | Who can use it |
|---|---|---|---|
| 1 — Payee attestation | Signed `LightningPaymentReceipt` VC from payee | **Strongest** | Payer (with receipt from payee) |
| 2 — LND node query | Direct query to a Lightning node for settlement status | Medium | Either party (if LND access available) |
| 3 — Preimage only | `SHA-256(preimage) == payment_hash` | Weakest | **Payee only** |

A payer presenting **only a preimage** (no payee attestation, no LND evidence) is **rejected** by the API. This prevents a known attack vector where a payer claims a payment using a probed or intercepted preimage.

If you only have a preimage, use `verifyPreimage(...)` for local validation — don't claim it as proof of payment authorization.

---

## Method reference

### `verifyPreimage({ paymentHash, preimage }) → PreimageVerifyResult`

Pure local check. No network, no API key.

| Field | Type |
|---|---|
| `paymentHash` | hex string, 64 chars (32 bytes), with or without `0x` prefix |
| `preimage` | hex string, 64 chars (32 bytes), with or without `0x` prefix |

Returns `{ valid: boolean, paymentHash, computedHash, error? }`.

### `new ObserverLightningVerifier(config)`

| Config | Type | Description |
|---|---|---|
| `apiBase` | `string` | Default `https://api.observerprotocol.org` |
| `apiKey` | `string` | Integrator API key, required for `verifyWithReputation` |
| `requestTimeoutMs` | `number` | Default 15000 |
| `fetchImpl` | `typeof fetch` | Override `fetch` for testing |

### `verifier.verifyPreimage(opts)` — same as the standalone function.

### `await verifier.verifyWithReputation(opts) → VerifyWithReputationResult`

| `opts` field | Type | Required |
|---|---|---|
| `paymentHash` | hex string | yes |
| `preimage` | hex string | yes |
| `presenterRole` | `'payer'` \| `'payee'` | yes |
| `receiptReference` | string | no — defaults to `lightning-{paymentHash}` |
| `payeeAttestation` | object (signed VC) | no — supplies tier-1 evidence |
| `metadata` | object | no |

Returns `{ valid, tier, reputationContribution?, raw?, error? }`.

---

## Roadmap

| Item | Status |
|---|---|
| Local `verifyPreimage(...)` | **v0.1 — shipped** |
| Three-tier `verifyWithReputation(...)` (calls OP `/v1/chain/verify`) | **v0.1 — shipped** |
| BOLT-11 invoice decoder (extract `payment_hash` from invoice string directly) | v0.2 — planned |
| LND-direct path (skip OP, query a node directly) | v0.2 — under consideration |
| Reputation contribution on first-party LND verification | v0.2 — planned |
| Bare-runtime native fetch optimization | v0.2 — planned |

---

## Publication status

> This package is in active development. The canonical home is `observer-protocol/wdk-lightning-verifier` (or the personal account fallback during organization access transitions). Once organization access stabilizes, all references will resolve to the canonical org URL.

---

## Links

- **Companion package:** `@observer-protocol/wdk-protocol-trust` — the WDK-shaped surface for agent identity and bilateral handshake
- **Observer Protocol:** [observerprotocol.org](https://observerprotocol.org)
- **AIP v0.5 spec (Lightning verification model):** §10 of [AIP v0.5](https://observerprotocol.org/papers/aip-v0.5.pdf)
- **OP API docs:** [api.observerprotocol.org/docs](https://api.observerprotocol.org/docs)
- **BOLT-11 spec:** [bolt 11](https://github.com/lightning/bolts/blob/master/11-payment-encoding.md)

---

## License

Apache-2.0 © 2026 Observer Protocol, Inc.
