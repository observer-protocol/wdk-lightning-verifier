// Copyright 2026 Observer Protocol, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

'use strict'

/** @typedef {import('./src/preimage.js').PreimageVerifyOptions} PreimageVerifyOptions */
/** @typedef {import('./src/preimage.js').PreimageVerifyResult} PreimageVerifyResult */
/** @typedef {import('./src/observer-lightning-verifier.js').ObserverLightningVerifierConfig} ObserverLightningVerifierConfig */
/** @typedef {import('./src/observer-lightning-verifier.js').VerifyWithReputationOptions} VerifyWithReputationOptions */
/** @typedef {import('./src/observer-lightning-verifier.js').VerifyWithReputationResult} VerifyWithReputationResult */

export { verifyPreimage } from './src/preimage.js'
export { ObserverLightningVerifier } from './src/observer-lightning-verifier.js'
export { ObserverLightningVerifier as default } from './src/observer-lightning-verifier.js'
