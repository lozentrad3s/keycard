//! Keycard: API access as an NFT.
//!
//! Each card is an NEP-171 token and its own NEAR account, `c<N>.<this>`,
//! created with no access keys and running the shared card-wallet global
//! contract. The card's credit lives in that account. The current owner uses
//! the card through `use_card`: Keycard checks ownership, holds the call price
//! on the card, and asks OutLayer to run Keycard's WASM in a TEE with the
//! provider's API key, which only this contract may use. On success the card
//! pays the provider; on failure the price goes back onto the card, never to a
//! person. Selling the card moves the access, the credit and the history.
//!
//! See docs/THREAT_MODEL.md for every attack this is built to stop.

use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::{NonFungibleTokenCore, NonFungibleTokenResolver};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::collections::LazyOption;
use near_sdk::json_types::{Base58CryptoHash, U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, CryptoHash, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    PromiseOrValue, PromiseResult,
};
use std::collections::HashMap;

#[cfg(test)]
mod tests;

/// Kept by the contract at mint to pay for the token and its history.
pub const MINT_FEE: NearToken = NearToken::from_millinear(30);
/// Sent to the new card account: its storage plus the wallet's reserve.
pub const CARD_ACCOUNT_FUND: NearToken = NearToken::from_millinear(20);
/// Most history entries kept per card. Older entries are dropped.
pub const HISTORY_CAP: usize = 50;
/// Longest prompt accepted, in bytes.
pub const MAX_PROMPT: usize = 1_000;

const GAS_FOR_OUTLAYER: Gas = Gas::from_tgas(100);
const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(30);
const GAS_FOR_WALLET_PAY: Gas = Gas::from_tgas(10);

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Owner,
    Metadata,
    Enumeration,
    Approval,
    ContractMetadata,
    Cards,
}

/// Where Keycard's WASM lives on OutLayer, and whose secret it reads.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct OutLayerConfig {
    /// `outlayer.testnet` or `outlayer.near`.
    pub contract: AccountId,
    /// For example `keycard.testnet/keycard-api`.
    pub project_id: String,
    /// The secrets profile that holds the provider's API key.
    pub secrets_profile: String,
    /// The account that owns those secrets: the provider.
    pub secrets_owner: AccountId,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Entry {
    Minted { to: AccountId, credit: U128 },
    Transferred { from: AccountId, to: AccountId },
    ToppedUp { by: AccountId, amount: U128 },
    CallStarted { by: AccountId, price: U128 },
    CallPaid { by: AccountId, price: U128 },
    CallRefunded { by: AccountId, price: U128, reason: String },
    RoyaltyPaid { to: AccountId, amount: U128 },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct HistoryEntry {
    pub at: U64,
    pub entry: Entry,
}

#[near(serializers = [borsh])]
pub struct Card {
    /// The card's own account, `c<N>.<keycard>`.
    pub account: AccountId,
    /// Credit the card can spend, as Keycard counts it. The card account
    /// always holds at least this much.
    pub credit: u128,
    /// Prices of calls that have started and not yet settled.
    pub held: u128,
    pub calls: u64,
    pub spent: u128,
    /// Every account that has owned the card, in order.
    pub holders: Vec<AccountId>,
    pub history: Vec<HistoryEntry>,
}

#[near(serializers = [json])]
pub struct CardView {
    pub token_id: TokenId,
    pub owner_id: AccountId,
    pub account: AccountId,
    pub credit: U128,
    pub held: U128,
    pub calls: U64,
    pub spent: U128,
    pub holders: Vec<AccountId>,
    pub listed: bool,
    pub calls_left: U64,
}

#[near(serializers = [json])]
pub struct ConfigView {
    pub provider: AccountId,
    pub price_per_call: U128,
    pub royalty_bps: u16,
    pub wallet_code_hash: Base58CryptoHash,
    pub outlayer: OutLayerConfig,
    pub mint_fee: U128,
    pub card_account_fund: U128,
}

/// NEP-199 payout.
#[near(serializers = [json])]
pub struct Payout {
    pub payout: HashMap<AccountId, U128>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Keycard {
    tokens: NonFungibleToken,
    metadata: LazyOption<NFTContractMetadata>,
    cards: LookupMap<TokenId, Card>,
    /// The API provider: paid per call, receives the resale royalty, and may
    /// change the price and the OutLayer settings.
    provider: AccountId,
    price_per_call: u128,
    royalty_bps: u16,
    wallet_code_hash: CryptoHash,
    outlayer: OutLayerConfig,
    next_id: u64,
}

#[near]
impl Keycard {
    #[init]
    pub fn new(
        provider: AccountId,
        price_per_call: U128,
        royalty_bps: u16,
        wallet_code_hash: Base58CryptoHash,
        outlayer: OutLayerConfig,
        name: Option<String>,
    ) -> Self {
        require!(royalty_bps <= 2_000, "Royalty can be at most 20%");
        let metadata = NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: name.unwrap_or_else(|| "Keycard".to_string()),
            symbol: "KEYCARD".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        };
        Self {
            tokens: NonFungibleToken::new(
                Key::Owner,
                env::current_account_id(),
                Some(Key::Metadata),
                Some(Key::Enumeration),
                Some(Key::Approval),
            ),
            metadata: LazyOption::new(Key::ContractMetadata, Some(&metadata)),
            cards: LookupMap::new(Key::Cards),
            provider,
            price_per_call: price_per_call.0,
            royalty_bps,
            wallet_code_hash: wallet_code_hash.into(),
            outlayer,
            next_id: 1,
        }
    }

    // ---------------------------------------------------------------- cards

    /// Buys a card for `receiver_id` (the caller if omitted). The deposit pays
    /// the mint fee and the card account; everything above that is the card's
    /// starting credit. Creates `c<N>.<this>` with no access keys.
    #[payable]
    pub fn issue_card(&mut self, receiver_id: Option<AccountId>, title: Option<String>) -> Promise {
        let buyer = env::predecessor_account_id();
        let receiver = receiver_id.unwrap_or_else(|| buyer.clone());
        let deposit = env::attached_deposit();
        let cost = MINT_FEE.saturating_add(CARD_ACCOUNT_FUND);
        require!(deposit > cost, format!("Attach more than {} to issue a card", cost.exact_amount_display()));
        let credit = deposit.saturating_sub(cost).as_yoctonear();

        let token_id = self.next_id.to_string();
        self.next_id += 1;
        let account: AccountId = format!("c{}.{}", token_id, env::current_account_id()).parse().unwrap();

        let metadata = TokenMetadata {
            title: Some(title.unwrap_or_else(|| format!("Keycard #{}", token_id))),
            description: Some(format!("API access as an NFT. This card's credit lives in {}.", account)),
            media: None,
            media_hash: None,
            copies: Some(1),
            issued_at: Some(env::block_timestamp_ms().to_string()),
            expires_at: None,
            starts_at: None,
            updated_at: None,
            extra: Some(json!({ "card_account": account }).to_string()),
            reference: None,
            reference_hash: None,
        };
        self.tokens.internal_mint(token_id.clone(), receiver.clone(), Some(metadata));

        let mut card = Card {
            account: account.clone(),
            credit,
            held: 0,
            calls: 0,
            spent: 0,
            holders: vec![receiver.clone()],
            history: vec![],
        };
        push(&mut card, Entry::Minted { to: receiver, credit: U128(credit) });
        self.cards.insert(token_id.clone(), card);

        // The card account: created, funded, pointed at the shared wallet
        // code and initialised, in one batch. No key is ever added.
        Promise::new(account)
            .create_account()
            .transfer(CARD_ACCOUNT_FUND.saturating_add(NearToken::from_yoctonear(credit)))
            .use_global_contract(self.wallet_code_hash)
            .function_call(
                "new".to_string(),
                json!({ "token_id": token_id }).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(5),
            )
    }

    /// Adds credit to a card. Anyone may pay for anyone's card.
    #[payable]
    pub fn top_up(&mut self, token_id: TokenId) -> Promise {
        let amount = env::attached_deposit();
        require!(!amount.is_zero(), "Attach the amount to add");
        let by = env::predecessor_account_id();
        let card = self.card_mut(&token_id);
        card.credit += amount.as_yoctonear();
        let account = card.account.clone();
        push(card, Entry::ToppedUp { by, amount: U128(amount.as_yoctonear()) });
        Promise::new(account).transfer(amount)
    }

    /// Uses the card: the current owner asks the API a question. The attached
    /// deposit pays OutLayer's fee and any unused part is refunded to the
    /// caller. The call price is held on the card until OutLayer answers.
    ///
    /// `reply_pubkey` is a base64 X25519 public key. The WASM encrypts the
    /// answer to it, so only the caller can read it.
    #[payable]
    pub fn use_card(&mut self, token_id: TokenId, prompt: String, reply_pubkey: String) -> Promise {
        let caller = env::predecessor_account_id();
        let owner = self.owner_of(&token_id);
        require!(caller == owner, "Only the card's current owner can use it");
        require!(!self.is_listed(&token_id), "This card is listed for sale. Revoke the approval to use it");
        require!(!prompt.trim().is_empty() && prompt.len() <= MAX_PROMPT, "Ask something between 1 and 1000 bytes long");
        require!(reply_pubkey.len() >= 40 && reply_pubkey.len() <= 64, "reply_pubkey must be a base64 X25519 key");
        let fee = env::attached_deposit();
        require!(!fee.is_zero(), "Attach NEAR for OutLayer's fee; the unused part comes back to you");

        let price = self.price_per_call;
        let card = self.card_mut(&token_id);
        require!(card.credit >= price, "Not enough credit on this card. Top it up first");
        // Move the price from credit to held before any promise, so two calls
        // in one block can never spend the same credit.
        card.credit -= price;
        card.held += price;
        push(card, Entry::CallStarted { by: caller.clone(), price: U128(price) });

        let input = json!({ "prompt": prompt, "reply_pubkey": reply_pubkey, "card": token_id }).to_string();
        let args = json!({
            "source": { "Project": { "project_id": self.outlayer.project_id, "version_key": null } },
            "resource_limits": { "max_instructions": 10_000_000_000u64, "max_memory_mb": 128, "max_execution_seconds": 60 },
            "input_data": input,
            "secrets_ref": { "profile": self.outlayer.secrets_profile, "account_id": self.outlayer.secrets_owner },
            "response_format": "Text",
            "payer_account_id": caller,
        });
        Promise::new(self.outlayer.contract.clone())
            .function_call("request_execution".to_string(), args.to_string().into_bytes(), fee, GAS_FOR_OUTLAYER)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_outlayer_result(token_id, caller, U128(price)),
            )
    }

    /// Settles a call. On success the card pays the provider; on failure the
    /// price goes back onto the card. Either way the money follows the card,
    /// whoever owns it now.
    #[private]
    pub fn on_outlayer_result(&mut self, token_id: TokenId, caller: AccountId, price: U128) -> Option<String> {
        // #[private] already enforces this on chain; said again so tests can see it.
        require!(env::predecessor_account_id() == env::current_account_id(), "Method on_outlayer_result is private");
        let provider = self.provider.clone();
        let result = match env::promise_result_checked(0, 900 * 4) {
            Ok(bytes) => parse_outlayer(&bytes),
            Err(PromiseError::Failed) => Err("OutLayer did not run the request".to_string()),
            Err(e) => Err(format!("OutLayer result unreadable: {:?}", e)),
        };
        let card = self.card_mut(&token_id);
        card.held = card.held.saturating_sub(price.0);
        match result {
            Ok(answer) => {
                card.calls += 1;
                card.spent += price.0;
                let account = card.account.clone();
                push(card, Entry::CallPaid { by: caller, price });
                let _ = ext_wallet::ext(account).with_static_gas(GAS_FOR_WALLET_PAY).pay(provider, price);
                Some(answer)
            }
            Err(reason) => {
                card.credit += price.0;
                push(card, Entry::CallRefunded { by: caller, price, reason });
                None
            }
        }
    }

    // ------------------------------------------------------------- provider

    pub fn set_price(&mut self, price_per_call: U128) {
        self.assert_provider();
        self.price_per_call = price_per_call.0;
    }

    pub fn set_outlayer(&mut self, outlayer: OutLayerConfig) {
        self.assert_provider();
        self.outlayer = outlayer;
    }

    // ---------------------------------------------------------------- views

    pub fn card(&self, token_id: TokenId) -> Option<CardView> {
        let card = self.cards.get(&token_id)?;
        Some(CardView {
            owner_id: self.owner_of(&token_id),
            listed: self.is_listed(&token_id),
            account: card.account.clone(),
            credit: U128(card.credit),
            held: U128(card.held),
            calls: U64(card.calls),
            spent: U128(card.spent),
            holders: card.holders.clone(),
            calls_left: U64(if self.price_per_call == 0 { u64::MAX } else { (card.credit / self.price_per_call) as u64 }),
            token_id,
        })
    }

    pub fn history(&self, token_id: TokenId) -> Vec<HistoryEntry> {
        self.cards.get(&token_id).map(|c| c.history.clone()).unwrap_or_default()
    }

    pub fn config(&self) -> ConfigView {
        ConfigView {
            provider: self.provider.clone(),
            price_per_call: U128(self.price_per_call),
            royalty_bps: self.royalty_bps,
            wallet_code_hash: self.wallet_code_hash.into(),
            outlayer: self.outlayer.clone(),
            mint_fee: U128(MINT_FEE.as_yoctonear()),
            card_account_fund: U128(CARD_ACCOUNT_FUND.as_yoctonear()),
        }
    }

    // ------------------------------------------------------- NEP-199 payout

    pub fn nft_payout(&self, token_id: TokenId, balance: U128, max_len_payout: Option<u32>) -> Payout {
        let owner = self.owner_of(&token_id);
        self.payout_for(&owner, balance.0, max_len_payout)
    }

    #[payable]
    pub fn nft_transfer_payout(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        balance: U128,
        max_len_payout: Option<u32>,
    ) -> Payout {
        near_sdk::assert_one_yocto();
        let sender = env::predecessor_account_id();
        let (previous, _) = self.tokens.internal_transfer(&sender, &receiver_id, &token_id, approval_id, memo);
        self.record_transfer(&token_id, previous.clone(), receiver_id);
        let payout = self.payout_for(&previous, balance.0, max_len_payout);
        let royalty = payout.payout.get(&self.provider).map(|a| a.0).unwrap_or(0);
        if royalty > 0 && previous != self.provider {
            let provider = self.provider.clone();
            push(self.card_mut(&token_id), Entry::RoyaltyPaid { to: provider, amount: U128(royalty) });
        }
        payout
    }

    // ------------------------------------------------------------- internal

    fn payout_for(&self, owner: &AccountId, balance: u128, max_len_payout: Option<u32>) -> Payout {
        require!(max_len_payout.map_or(true, |m| m >= 2), "max_len_payout must allow the owner and the provider");
        let royalty = balance * self.royalty_bps as u128 / 10_000;
        let mut payout = HashMap::new();
        if owner == &self.provider || royalty == 0 {
            payout.insert(owner.clone(), U128(balance));
        } else {
            payout.insert(self.provider.clone(), U128(royalty));
            payout.insert(owner.clone(), U128(balance - royalty));
        }
        Payout { payout }
    }

    fn record_transfer(&mut self, token_id: &TokenId, from: AccountId, to: AccountId) {
        let card = self.card_mut(token_id);
        if card.holders.last() != Some(&to) {
            card.holders.push(to.clone());
        }
        push(card, Entry::Transferred { from, to });
    }

    fn owner_of(&self, token_id: &TokenId) -> AccountId {
        self.tokens.owner_by_id.get(token_id).unwrap_or_else(|| env::panic_str("No such card"))
    }

    fn is_listed(&self, token_id: &TokenId) -> bool {
        self.tokens
            .approvals_by_id
            .as_ref()
            .and_then(|a| a.get(token_id))
            .map(|m| !m.is_empty())
            .unwrap_or(false)
    }

    fn card_mut(&mut self, token_id: &TokenId) -> &mut Card {
        self.cards.get_mut(token_id).unwrap_or_else(|| env::panic_str("No such card"))
    }

    fn assert_provider(&self) {
        require!(env::predecessor_account_id() == self.provider, "Only the provider can do this");
    }
}

fn push(card: &mut Card, entry: Entry) {
    card.history.push(HistoryEntry { at: U64(env::block_timestamp_ms()), entry });
    if card.history.len() > HISTORY_CAP {
        let extra = card.history.len() - HISTORY_CAP;
        card.history.drain(0..extra);
    }
}

/// OutLayer returns the WASM's stdout. Keycard's WASM prints
/// `{"ok":true,"answer":"<base64 ciphertext>"}` or `{"ok":false,"error":"..."}`.
/// Anything else counts as a failure, so the card is refunded.
pub fn parse_outlayer(bytes: &[u8]) -> Result<String, String> {
    let text = String::from_utf8_lossy(bytes).to_string();
    // The callback may receive the output as a JSON string or as an object
    // with the output inside; accept both.
    let value: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::String(text.clone()));
    let inner = match &value {
        serde_json::Value::String(s) => serde_json::from_str(s).unwrap_or(serde_json::Value::Null),
        serde_json::Value::Object(o) if o.contains_key("ok") => value.clone(),
        serde_json::Value::Object(o) => o
            .get("output")
            .or_else(|| o.get("result"))
            .and_then(|v| v.as_str().map(|s| serde_json::from_str(s).unwrap_or(serde_json::Value::Null)).or(Some(v.clone())))
            .unwrap_or(serde_json::Value::Null),
        _ => serde_json::Value::Null,
    };
    match inner.get("ok").and_then(|v| v.as_bool()) {
        Some(true) => inner
            .get("answer")
            .and_then(|a| a.as_str())
            .map(|a| a.to_string())
            .ok_or_else(|| "The answer was missing".to_string()),
        Some(false) => Err(inner.get("error").and_then(|e| e.as_str()).unwrap_or("The API call failed").chars().take(200).collect()),
        None => Err("OutLayer returned something Keycard did not expect".to_string()),
    }
}

#[near_sdk::ext_contract(ext_wallet)]
pub trait CardWallet {
    fn pay(&mut self, receiver_id: AccountId, amount: U128) -> Promise;
}

// ---------------------------------------------------------------- NEP-171

#[near]
impl NonFungibleTokenCore for Keycard {
    #[payable]
    fn nft_transfer(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>) {
        near_sdk::assert_one_yocto();
        let sender = env::predecessor_account_id();
        let (previous, _) = self.tokens.internal_transfer(&sender, &receiver_id, &token_id, approval_id, memo);
        self.record_transfer(&token_id, previous, receiver_id);
    }

    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        let previous = self.owner_of(&token_id);
        self.record_transfer(&token_id, previous, receiver_id.clone());
        self.tokens.nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenResolver for Keycard {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        let kept = self.tokens.nft_resolve_transfer(previous_owner_id.clone(), receiver_id.clone(), token_id.clone(), approved_account_ids);
        if !kept {
            // The receiver sent it back.
            self.record_transfer(&token_id, receiver_id, previous_owner_id);
        }
        kept
    }
}

#[near]
impl NonFungibleTokenApproval for Keycard {
    #[payable]
    fn nft_approve(&mut self, token_id: TokenId, account_id: AccountId, msg: Option<String>) -> Option<Promise> {
        self.tokens.nft_approve(token_id, account_id, msg)
    }

    #[payable]
    fn nft_revoke(&mut self, token_id: TokenId, account_id: AccountId) {
        self.tokens.nft_revoke(token_id, account_id)
    }

    #[payable]
    fn nft_revoke_all(&mut self, token_id: TokenId) {
        self.tokens.nft_revoke_all(token_id)
    }

    fn nft_is_approved(&self, token_id: TokenId, approved_account_id: AccountId, approval_id: Option<u64>) -> bool {
        self.tokens.nft_is_approved(token_id, approved_account_id, approval_id)
    }
}

#[near]
impl NonFungibleTokenEnumeration for Keycard {
    fn nft_total_supply(&self) -> U128 {
        self.tokens.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens(from_index, limit)
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.tokens.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens_for_owner(account_id, from_index, limit)
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Keycard {
    fn nft_metadata(&self) -> NFTContractMetadata {
        self.metadata.get().unwrap()
    }
}

// Keeps PromiseResult in scope for older near-sdk helpers used in tests.
#[allow(dead_code)]
fn _unused(_: PromiseResult) {}
