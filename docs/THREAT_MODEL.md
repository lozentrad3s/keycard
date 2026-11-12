# Keycard threat model

Written before any code, as the track asks. Each line names an attack, how Keycard stops it, and the test that proves it. Sign-off is needed before building.

## What is being protected

- The **provider's API key**. If it leaks, everything is lost.
- The **card's credit**, held in the card's own account `c<N>.<keycard>`.
- **Access** to the API, which must belong to exactly one account at a time: the card's current owner.
- The **history** of the card, which buyers rely on.

## Actors

Provider (issues cards, owns the key), holder (current owner), seller (previous owner), buyer, marketplace (approved to transfer), OutLayer worker (TEE), anyone else on the network.

## Transfer: every way a seller could try to keep something

| # | Attack | How Keycard stops it | Test |
| --- | --- | --- | --- |
| T1 | Seller keeps a key to the card's account and spends its credit after the sale | The card account is created with **no access keys** and never gets one. Its code (the global card wallet) obeys only the Keycard contract, and Keycard only obeys the current owner | `card_account_has_no_keys`, `old_owner_cannot_use_after_transfer` |
| T2 | Seller copied the API key | The key is never given to anyone. It lives in an OutLayer secret that only the Keycard contract may use (whitelist, direct calls only, one WASM hash) and only the TEE decrypts | Manual: the secret's access condition is shown in the README and checked by `npm run judge` |
| T3 | Seller keeps a session token, cookie or signed message for the gated page | The page checks ownership **on every request** against `nft_token` on chain, with a fresh NEP-413 nonce; no session outlives a transfer | `console_rejects_previous_owner` (web test) |
| T4 | Seller starts a call, then sells mid-call; the refund or the answer goes to the seller | The price is taken from the **card's** wallet, and any refund on failure goes back to the **card's** wallet, never to a person. The answer is encrypted to the key supplied by whoever called, who paid nothing personally | `sale_during_call_refund_goes_to_card` (the "sale during a payout" test) |
| T5 | Seller drains the credit just before the sale completes | While a marketplace approval is active, `use_card` is refused, so the balance a buyer sees is the balance they get. The owner can revoke the approval to use the card again | `use_blocked_while_approved` |
| T6 | Seller withdraws the credit to themselves | There is no withdraw to a person. Credit leaves only as a call price paid to the provider, or as a refund to the card itself | `no_withdraw_path` |
| T7 | Seller transfers, then front-runs with a stale approval | NEP-171 approval ids are bumped on every transfer and checked on `nft_transfer`; old approvals die with the transfer | `stale_approval_rejected` |
| T8 | Resale royalty is skipped | NEP-199 `nft_transfer_payout` pays the provider's royalty; marketplaces that skip it are visible in the history | `payout_includes_royalty` |

## The key and the TEE

| # | Attack | Defence |
| --- | --- | --- |
| K1 | A holder asks the WASM to print the key | The WASM never echoes input or environment; it only returns the API's answer, encrypted. Its source and hash are published |
| K2 | Someone runs a modified WASM with the secret | The secret is bound to one WASM SHA-256; a different build cannot read it |
| K3 | Someone calls OutLayer directly with Keycard's secret | Direct-calls-only plus whitelist: only `request_execution` made by the Keycard contract account gets the secret |
| K4 | The answer is read by everyone on chain | The holder supplies an X25519 public key per call; the WASM encrypts the answer to it (NaCl box). On chain there is only ciphertext |
| K5 | Prompt injection in the request makes the API misbehave | The request is passed as data to the API; the WASM has no other tools. Worst case the holder wastes their own credit |

## Money and accounting

| # | Attack | Defence | Test |
| --- | --- | --- | --- |
| M1 | Calling `use_card` on someone else's card | `predecessor == owner` check | `non_owner_cannot_use` |
| M2 | Calling a card wallet directly | Wallet methods require `predecessor == keycard contract` | `wallet_rejects_strangers` |
| M3 | Using a card with too little credit | Checked before the OutLayer call; the call price is held and released only by the callback | `insufficient_credit_rejected` |
| M4 | Re-entrancy: two calls in one block on one credit | The price is moved out of the wallet before the OutLayer promise; balances can't go negative | `two_calls_cannot_overspend` |
| M5 | OutLayer callback forged | The callback is `#[private]` and only reads `promise_result(0)` | `callback_is_private` |
| M6 | Storage exhaustion through history | History is capped per card (last 50 entries) and paid for at mint | `history_is_capped` |

## Out of scope, stated plainly

- A provider who changes their own API or revokes their own key can break cards. Keycard shows the provider on every card; it does not insure them.
- OutLayer's TEE and attestation are trusted; Keycard shows the attestation but does not re-verify the hardware quote.
- Testnet only.
