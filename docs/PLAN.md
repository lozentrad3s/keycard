# Keycard plan

**One line:** API access you can hold, sell and give away as an NFT. Each card is a real NEAR account that owns its own credit, and the provider's API key is sealed inside an OutLayer TEE, so nobody, not even a card holder, ever sees it.

Track: **NFTs That Do Something** (`nfts`). Secondary: **Privacy & Private AI** (`privacy`), **Agent Economy** (`agents`).

## The problem

Selling access to a paid API means handing out keys. A key can be copied, shared, leaked or resold without the provider knowing, and it cannot be taken back from one person without breaking everyone. People who bought access cannot resell what they did not use. An API key is a secret pretending to be property.

## The product

1. **A provider issues cards.** Each card is an NEP-171 token with a plan (price per call) and a starting credit.
2. **Every card is its own account.** Minting creates `c<N>.<keycard contract>` running one shared card-wallet contract (NEAR global contract, NEP-591). The card's credit lives there. The account has **no access keys**, so no person can ever sign as the card; only the Keycard contract can move its money, and only by the card's rules.
3. **The holder uses the API.** The current owner calls `use_card`. The contract checks ownership, pays the provider the call price out of the card's wallet, and asks OutLayer to run Keycard's WASM in a TEE. The WASM reads the provider's key from an OutLayer secret that only the Keycard contract may use, calls the API, encrypts the answer to a key the holder supplied, and returns it.
4. **Sell or give the card.** Transfer the NFT and the access, the remaining credit and the history go with it. The seller keeps nothing, because there was never anything to keep: no key, no session, no balance in their name.
5. **A gated console.** A page only the current holder can open (NEAR wallet signature, checked against `nft_token` on chain), with a per-card history: top-ups, calls, refunds, every holder.

## NEAR features used

- NEP-171 core, enumeration, metadata, NEP-199 payout (royalty to the provider on resale), NEP-297 events
- Sub-accounts per token, created by the contract with **no access keys**
- Global contracts (NEP-591): one card-wallet contract deployed once, used by every card for under 0.001 NEAR each
- OutLayer on `outlayer.testnet`: `request_execution` with yield/resume, a secret restricted to the Keycard contract (whitelist + direct calls only + one WASM hash), TEE attestation
- NEP-413 signed messages for the gated page

## What the API is

Recommendation: **NEAR AI Cloud chat** (a private model in a TEE). A card buys short answers from a TEE-hosted model; the provider's NEAR AI key never leaves OutLayer. OutLayer results are limited to 900 bytes, so answers are capped at about 500 characters. Any HTTPS API with a key works the same way.

## Build order and timeline (deadline 2026-11-14 23:59 UTC)

| When | Work | Done when |
| --- | --- | --- |
| 12 Nov | Threat model signed off. OutLayer spike: a hello WASM runs on `outlayer.testnet` with a secret | One `request_execution` returns a result into a test contract |
| 12–13 Nov | Contracts: `keycard` (NEP-171 + payout + `use_card` + history) and `card-wallet` (global). Unit tests incl. every threat below | `cargo test` green, sale-mid-call test passes |
| 13 Nov | WASM: read input, call the API with the sealed key, encrypt the answer, print ≤900 bytes. Deploy to testnet, set the secret | A real card answers a real question on testnet |
| 13–14 Nov | Web (Next.js): issue page, gated console, history view, marketplace-style transfer. `npm run judge` script | A judge can follow the README steps |
| 14 Nov | README for machine and human readers, Vercel deploy, demo video, X post draft, submission payload for the human to confirm | Repo public, demo up |

## Risks and fallbacks

| Risk | Fallback |
| --- | --- |
| OutLayer onboarding (CLI, secrets) takes too long | The contract path stays real; the WASM is shown running locally under wasmtime with the same input, and the README says plainly the TEE call is not wired |
| Global contract API differs from docs | Deploy the card wallet normally per card (costs about 0.3–0.6 testnet NEAR each) |
| 900-byte output limit | Short answers only; stated in the README |
| Testnet NEAR | Faucet accounts |
