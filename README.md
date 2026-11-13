# Keycard

**API access as an NFT. Every card is its own NEAR account that holds its credit, and the provider's API key stays sealed in an OutLayer TEE.**

Selling access to a paid API means handing out keys, and a key is a secret pretending to be property: it can be copied, shared and leaked, can't be taken back from one person, and can't be resold. Keycard replaces the key with a card. The provider's key never leaves an Intel TDX enclave on OutLayer. What people own is an NEP-171 token whose credit lives in its own keyless account and whose access follows whoever holds it, checked on chain on every call. Sell the card and the access, the remaining credit and the history go with it; the seller has nothing left to keep.

Contract: [`keycard-near.testnet`](https://testnet.nearblocks.io/address/keycard-near.testnet) · OutLayer project: `keycard-provider.testnet/keycard-api` · Track: **NFTs That Do Something** (also Privacy & Private AI)

## Try it

**Live:** _(link added when deployed)_

1. Open **/try** → press **Start: make my two accounts**.
   → Two real testnet accounts are made: you, and a friend. Their keys are made in your browser.
2. Press **Buy a card**.
   → Card #N is issued for 0.15 NEAR. Its credit (0.1 NEAR) goes into a new account `cN.keycard-near.testnet`, and the page shows **"Access keys on it: None. Nobody can sign as the card."**
3. Press **Ask** under "You".
   → The contract holds the price on the card and asks OutLayer to run the call in the TEE. The answer comes back sealed to a key made in your browser and is opened on the page. If the provider's API doesn't answer, the price goes back onto the card.
4. Press **Sell the card to your friend**, then **Try to use the card anyway** as yourself.
   → The contract refuses: *"Only the card's current owner can use it."* Your friend's panel now shows the card with its remaining credit, and their **Ask** works.
5. Open **/console** and sign in as yourself, then as your friend.
   → The holder-only console refuses you and opens for your friend.
6. Open **/cards/N**.
   → The card's public history: issued, questions, payments, refunds, every holder.

Every step links to its transaction on the testnet explorer.

## How it works

```
buyer ── issue_card (0.15 NEAR) ──▶ Keycard contract ── creates cN.keycard-near.testnet
                                     (NEP-171 token)     · no access keys, ever
                                                         · runs the card-wallet global contract
                                                         · holds the card's credit

holder ── use_card(prompt, reply key) ──▶ Keycard: owner? not listed? credit ≥ price?
                                           │  price moved from credit to "held"
                                           ▼
                              outlayer.testnet request_execution  (yield / resume)
                                           │  secret NEARAI_API_KEY, readable only by
                                           │  keycard-near.testnet, only for this WASM build
                                           ▼
                              Intel TDX enclave: keycard-api.wasm
                                calls NEAR AI Cloud with the key, scrubs the key from the
                                answer, seals the answer to the holder's X25519 key
                                           │
                                           ▼
                              on_outlayer_result:  ok  → card pays the provider
                                                   err → price back onto the card
```

| Part | Where | What it does |
| --- | --- | --- |
| Keycard contract | [`contracts/keycard`](contracts/keycard) | NEP-171 with enumeration, metadata, approvals and NEP-199 payout. Creates each card's account, holds call prices, settles with OutLayer, keeps a capped per-card history |
| Card wallet | [`contracts/card-wallet`](contracts/card-wallet) | The code every card account runs, published once as a global contract. Holds the credit; pays out only when the Keycard contract asks |
| TEE app | [`wasm/keycard-api`](wasm/keycard-api) | Runs on OutLayer (`wasm32-wasip2`). Reads the request, calls the API with the sealed key, seals the answer, prints at most 900 bytes |
| Web | [`web`](web) | Next.js: landing, `/try`, `/console` (holder only), `/cards/[id]` (history) |
| Threat model | [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) | Written before the code: every way a seller could try to keep something, and the test for each |

### How control passes on transfer, and what stops the old owner

- **No key to keep.** A card account is created by the Keycard contract with `CreateAccount`, `Transfer`, `UseGlobalContract` and an init call, and never an `AddKey`. Nobody, including the buyer, the seller and the provider, can sign as the card. Test: `card_account_has_no_keys`; on testnet, `/cards/N` reads the account's key list from chain (empty).
- **No session to keep.** The console checks a fresh signature, that the key is a full-access key on the account, and that the account owns the card on chain, on every request.
- **No money to keep.** There is no withdraw. Credit leaves only as a call price paid to the provider. A refund for a failed call goes back onto the card, so a sale in the middle of a call leaves the refund with the new owner. Tests: `sale_during_call_refund_goes_to_card`, `sale_during_call_success_is_paid_by_the_card`, `no_withdraw_path`.
- **No last-minute drain.** A card with an active marketplace approval can't be used, so the credit a buyer sees is the credit they get. Test: `use_blocked_while_approved`.
- **No copy of the API key.** It's an OutLayer secret the provider set with access `whitelist:keycard-near.testnet`, `--direct` (only calls made by the Keycard contract itself) and `--build <hash>` (only this exact WASM). The WASM never prints it and removes it from any answer before sealing. Test: `the_key_never_leaves`.

## Run the checks yourself

```bash
git clone https://github.com/lozentrad3s/keycard && cd keycard
cd contracts && cargo test          # 27 tests, one per threat
cd ../wasm/keycard-api && cargo test   # 5 tests for the TEE app
```

Run the site:

```bash
cd web && npm install && npm run dev   # http://localhost:3100
```

`/cards/1` and the landing page work with no setup. The `/try` demo needs a funded sponsor account in a `.env` at the repository root:

| Variable | Meaning |
| --- | --- |
| `GUEST_SPONSOR_ACCOUNT`, `GUEST_SPONSOR_KEY` | A funded testnet account that creates the two demo accounts (about 1.05 NEAR per visitor, most of it returned by **Start over**) |
| `NEXT_PUBLIC_KEYCARD_CONTRACT` | Optional. Defaults to `keycard-near.testnet` |

The provider's API key is not a site variable. It lives only in OutLayer:

```bash
outlayer login testnet
outlayer secrets set '{"NEARAI_API_KEY":"..."}' --project keycard-provider.testnet/keycard-api \
  --access whitelist:keycard-near.testnet --direct --build <wasm sha256>
```

### Deploying your own

```bash
cd contracts
cargo near build non-reproducible-wasm --no-abi --manifest-path card-wallet/Cargo.toml
cargo near build non-reproducible-wasm --no-abi --manifest-path keycard/Cargo.toml
near contract deploy-as-global use-file target/near/card_wallet/card_wallet.wasm as-global-hash <publisher> network-config testnet sign-with-keychain send
near contract deploy <keycard account> use-file target/near/keycard/keycard.wasm with-init-call new json-args '{"provider":"…","price_per_call":"10000000000000000000000","royalty_bps":500,"wallet_code_hash":"<hash>","outlayer":{"contract":"outlayer.testnet","project_id":"<provider>/keycard-api","secrets_profile":"default","secrets_owner":"<provider>"}}' prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send
cd ../wasm/keycard-api && cargo build --release --target wasm32-wasip2
outlayer upload target/wasm32-wasip2/release/keycard-api.wasm && outlayer deploy keycard-api <FastFS URL>
```

## NEAR features used

- **NEP-171** NFT core, enumeration, metadata and approvals; **NEP-199** payout (5% resale royalty to the provider)
- **Sub-accounts** per token, created by the contract with **no access keys**
- **Global contracts (NEP-591)**: the card wallet is published once by hash (immutable); each card account references it
- **OutLayer**: `request_execution` with yield/resume on `outlayer.testnet`, a project-bound secret with whitelist, direct-call and build conditions, Intel TDX execution
- **NEAR AI Cloud** inference (`Qwen/Qwen3.6-35B-A3B-FP8`) as the API behind the cards

## Limits, stated plainly

- Testnet only.
- OutLayer returns at most 900 bytes, so answers are capped at about 500 characters.
- Keycard trusts OutLayer's TEE and attestation; it doesn't re-verify the hardware quote.
- The demo signs with keys made in the browser for two throwaway accounts. Wallet sign-in for your own account is not built.
- A provider who revokes their own API key breaks their cards; Keycard shows the provider on every card but doesn't insure them.

## Built during the hackathon

All code was written during NEAR HACKATHON (1–14 November 2026). Libraries: near-sdk, near-contract-standards, cargo-near, crypto_box, wasi-http-client, Next.js, React, near-api-js, libsodium. AI coding assistants were used.

## Other project by the same team

Disclosed under rule Q-015: the same team also submitted **Pause AI** (https://github.com/lozentrad3s/pause), an AI agent that plans, secures and pays for group events. It is an independent project: separate repository, contracts, accounts and deployment, with no shared code.

## License

MIT
