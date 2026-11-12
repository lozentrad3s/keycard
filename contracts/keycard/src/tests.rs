//! One test per line of docs/THREAT_MODEL.md that the contract can prove.

use super::*;
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::{test_vm_config, testing_env, RuntimeFeesConfig};

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn near(n: u128) -> NearToken {
    NearToken::from_near(n)
}
const PRICE: u128 = 10_000_000_000_000_000_000_000; // 0.01 NEAR
const KEY: &str = "Ab3dZ8uC5bWqQd0rD8v3Rk6e9pXyT2nM4sL7hJ1fG0A=";

fn ctx(predecessor: &str, deposit: NearToken) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("keycard.testnet"))
        .predecessor_account_id(acc(predecessor))
        .signer_account_id(acc(predecessor))
        .attached_deposit(deposit)
        .account_balance(near(100))
        .block_timestamp(1_800_000_000_000_000_000);
    b
}

fn as_(predecessor: &str, deposit: NearToken) {
    testing_env!(ctx(predecessor, deposit).build());
}

/// Settles the OutLayer callback with the given result, as the contract itself.
fn settle(c: &mut Keycard, token: &str, caller: &str, result: PromiseResult) -> Option<String> {
    testing_env!(
        ctx("keycard.testnet", NearToken::from_yoctonear(0)).build(),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
    c.on_outlayer_result(token.into(), acc(caller), U128(PRICE))
}

fn ok_output() -> PromiseResult {
    PromiseResult::Successful(br#""{\"ok\":true,\"answer\":\"Y2lwaGVydGV4dA==\"}""#.to_vec())
}

fn setup() -> Keycard {
    as_("provider.testnet", NearToken::from_yoctonear(0));
    Keycard::new(
        acc("provider.testnet"),
        U128(PRICE),
        500,
        Base58CryptoHash::from([7u8; 32]),
        OutLayerConfig {
            contract: acc("outlayer.testnet"),
            project_id: "provider.testnet/keycard-api".into(),
            secrets_profile: "keycard".into(),
            secrets_owner: acc("provider.testnet"),
        },
        None,
    )
}

/// Alice buys card "1" with 0.1 NEAR of credit.
fn with_card() -> Keycard {
    let mut c = setup();
    let deposit = MINT_FEE.saturating_add(CARD_ACCOUNT_FUND).saturating_add(NearToken::from_millinear(100));
    as_("alice.testnet", deposit);
    c.issue_card(None, None);
    c
}

fn credit(c: &Keycard) -> u128 {
    c.card("1".into()).unwrap().credit.0
}

#[test]
fn issuing_creates_a_card_with_its_own_account_and_credit() {
    let c = with_card();
    let v = c.card("1".into()).unwrap();
    assert_eq!(v.owner_id, acc("alice.testnet"));
    assert_eq!(v.account, acc("c1.keycard.testnet"));
    assert_eq!(v.credit.0, NearToken::from_millinear(100).as_yoctonear());
    assert_eq!(v.calls_left.0, 10);
    assert_eq!(v.holders, vec![acc("alice.testnet")]);
}

/// T1: the card account is created, funded, given the wallet code and
/// initialised, and no key is ever added to it.
#[test]
fn card_account_has_no_keys() {
    let _c = with_card();
    let receipts = get_created_receipts();
    let card = receipts.iter().find(|r| r.receiver_id == acc("c1.keycard.testnet")).expect("a receipt for the card account");
    let actions = format!("{:?}", card.actions);
    assert!(actions.contains("CreateAccount"), "{actions}");
    assert!(actions.contains("UseGlobalContract"), "{actions}");
    assert!(actions.contains("FunctionCall"), "{actions}");
    assert!(!actions.contains("AddKey"), "the card account must never get a key: {actions}");
    assert!(!actions.contains("DeployContract"), "{actions}");
}

#[test]
#[should_panic(expected = "Attach more than")]
fn issuing_needs_more_than_the_fees() {
    let mut c = setup();
    as_("alice.testnet", MINT_FEE.saturating_add(CARD_ACCOUNT_FUND));
    c.issue_card(None, None);
}

/// M1
#[test]
#[should_panic(expected = "Only the card's current owner")]
fn non_owner_cannot_use() {
    let mut c = with_card();
    as_("mallory.testnet", NearToken::from_millinear(50));
    c.use_card("1".into(), "hello".into(), KEY.into());
}

/// T1 / T3: after a sale the seller has nothing left to use.
#[test]
#[should_panic(expected = "Only the card's current owner")]
fn old_owner_cannot_use_after_transfer() {
    let mut c = with_card();
    as_("alice.testnet", NearToken::from_yoctonear(1));
    c.nft_transfer(acc("bob.testnet"), "1".into(), None, None);
    as_("alice.testnet", NearToken::from_millinear(50));
    c.use_card("1".into(), "hello".into(), KEY.into());
}

#[test]
fn new_owner_can_use_after_transfer_and_history_shows_both() {
    let mut c = with_card();
    as_("alice.testnet", NearToken::from_yoctonear(1));
    c.nft_transfer(acc("bob.testnet"), "1".into(), None, None);
    as_("bob.testnet", NearToken::from_millinear(50));
    c.use_card("1".into(), "hello".into(), KEY.into());
    let v = c.card("1".into()).unwrap();
    assert_eq!(v.holders, vec![acc("alice.testnet"), acc("bob.testnet")]);
    assert_eq!(v.held.0, PRICE);
    let h = c.history("1".into());
    assert!(matches!(h[1].entry, Entry::Transferred { .. }));
    assert!(matches!(h[2].entry, Entry::CallStarted { .. }));
}

#[test]
fn a_successful_call_pays_the_provider_from_the_card() {
    let mut c = with_card();
    let before = credit(&c);
    as_("alice.testnet", NearToken::from_millinear(50));
    c.use_card("1".into(), "hello".into(), KEY.into());
    let answer = settle(&mut c, "1", "alice.testnet", ok_output());
    assert_eq!(answer.as_deref(), Some("Y2lwaGVydGV4dA=="));
    let v = c.card("1".into()).unwrap();
    assert_eq!(v.credit.0, before - PRICE);
    assert_eq!(v.held.0, 0);
    assert_eq!(v.calls.0, 1);
    assert_eq!(v.spent.0, PRICE);
    // The payment goes from the card's account to the provider.
    let pay = get_created_receipts().into_iter().find(|r| r.receiver_id == acc("c1.keycard.testnet")).expect("pay receipt");
    let call = pay.actions.iter().find_map(|a| match a {
        near_sdk::mock::MockAction::FunctionCallWeight { method_name, args, .. } => Some((String::from_utf8(method_name.clone()).unwrap(), String::from_utf8(args.clone()).unwrap())),
        _ => None,
    });
    let (method, args) = call.expect("a function call to the card account");
    assert_eq!(method, "pay");
    assert!(args.contains("\"receiver_id\":\"provider.testnet\"") && args.contains(&PRICE.to_string()), "{args}");
}

#[test]
fn a_failed_call_puts_the_price_back_on_the_card() {
    let mut c = with_card();
    let before = credit(&c);
    as_("alice.testnet", NearToken::from_millinear(50));
    c.use_card("1".into(), "hello".into(), KEY.into());
    assert_eq!(settle(&mut c, "1", "alice.testnet", PromiseResult::Failed), None);
    let v = c.card("1".into()).unwrap();
    assert_eq!(v.credit.0, before);
    assert_eq!(v.held.0, 0);
    assert_eq!(v.calls.0, 0);
    assert!(matches!(c.history("1".into()).last().unwrap().entry, Entry::CallRefunded { .. }));
}

#[test]
fn an_api_error_from_the_wasm_is_refunded_too() {
    let mut c = with_card();
    let before = credit(&c);
    as_("alice.testnet", NearToken::from_millinear(50));
    c.use_card("1".into(), "hello".into(), KEY.into());
    let out = PromiseResult::Successful(br#"{"ok":false,"error":"rate limited"}"#.to_vec());
    assert_eq!(settle(&mut c, "1", "alice.testnet", out), None);
    assert_eq!(credit(&c), before);
}

/// T4, the track's "sale during a payout": Alice starts a call, sells the
/// card to Bob while OutLayer is still running, and the call fails. The
/// refund goes back onto the card, which Bob now owns, not to Alice.
#[test]
fn sale_during_call_refund_goes_to_card() {
    let mut c = with_card();
    let before = credit(&c);
    as_("alice.testnet", NearToken::from_millinear(50));
    c.use_card("1".into(), "hello".into(), KEY.into());
    as_("alice.testnet", NearToken::from_yoctonear(1));
    c.nft_transfer(acc("bob.testnet"), "1".into(), None, None);
    settle(&mut c, "1", "alice.testnet", PromiseResult::Failed);
    let v = c.card("1".into()).unwrap();
    assert_eq!(v.owner_id, acc("bob.testnet"));
    assert_eq!(v.credit.0, before, "the refund stays on the card");
    let receipts = get_created_receipts();
    assert!(
        !receipts.iter().any(|r| r.receiver_id == acc("alice.testnet")),
        "nothing may be sent to the seller"
    );
}

/// T4, the other branch: the call succeeds after the sale. The card pays the
/// provider and Bob keeps the remaining credit.
#[test]
fn sale_during_call_success_is_paid_by_the_card() {
    let mut c = with_card();
    let before = credit(&c);
    as_("alice.testnet", NearToken::from_millinear(50));
    c.use_card("1".into(), "hello".into(), KEY.into());
    as_("alice.testnet", NearToken::from_yoctonear(1));
    c.nft_transfer(acc("bob.testnet"), "1".into(), None, None);
    settle(&mut c, "1", "alice.testnet", ok_output());
    let v = c.card("1".into()).unwrap();
    assert_eq!(v.credit.0, before - PRICE);
    assert_eq!(v.owner_id, acc("bob.testnet"));
}

/// T5
#[test]
#[should_panic(expected = "listed for sale")]
fn use_blocked_while_approved() {
    let mut c = with_card();
    as_("alice.testnet", NearToken::from_millinear(10));
    c.nft_approve("1".into(), acc("market.testnet"), None);
    as_("alice.testnet", NearToken::from_millinear(50));
    c.use_card("1".into(), "hello".into(), KEY.into());
}

#[test]
fn use_allowed_again_after_revoking() {
    let mut c = with_card();
    as_("alice.testnet", NearToken::from_millinear(10));
    c.nft_approve("1".into(), acc("market.testnet"), None);
    as_("alice.testnet", NearToken::from_yoctonear(1));
    c.nft_revoke("1".into(), acc("market.testnet"));
    as_("alice.testnet", NearToken::from_millinear(50));
    c.use_card("1".into(), "hello".into(), KEY.into());
}

/// T7
#[test]
#[should_panic(expected = "Sender not approved")]
fn stale_approval_rejected() {
    let mut c = with_card();
    as_("alice.testnet", NearToken::from_millinear(10));
    c.nft_approve("1".into(), acc("market.testnet"), None);
    as_("alice.testnet", NearToken::from_yoctonear(1));
    c.nft_transfer(acc("bob.testnet"), "1".into(), None, None);
    // The old listing tries to sell Bob's card.
    as_("market.testnet", NearToken::from_yoctonear(1));
    c.nft_transfer(acc("mallory.testnet"), "1".into(), Some(0), None);
}

/// T8
#[test]
fn payout_includes_royalty() {
    let mut c = with_card();
    as_("alice.testnet", NearToken::from_millinear(10));
    c.nft_approve("1".into(), acc("market.testnet"), None);
    as_("market.testnet", NearToken::from_yoctonear(1));
    let p = c.nft_transfer_payout(acc("bob.testnet"), "1".into(), None, None, U128(1_000), Some(10));
    assert_eq!(p.payout.get(&acc("provider.testnet")), Some(&U128(50)));
    assert_eq!(p.payout.get(&acc("alice.testnet")), Some(&U128(950)));
    assert_eq!(c.card("1".into()).unwrap().owner_id, acc("bob.testnet"));
    assert!(matches!(c.history("1".into()).last().unwrap().entry, Entry::RoyaltyPaid { .. }));
}

/// M3
#[test]
#[should_panic(expected = "Not enough credit")]
fn insufficient_credit_rejected() {
    let mut c = setup();
    let deposit = MINT_FEE.saturating_add(CARD_ACCOUNT_FUND).saturating_add(NearToken::from_yoctonear(PRICE - 1));
    as_("alice.testnet", deposit);
    c.issue_card(None, None);
    as_("alice.testnet", NearToken::from_millinear(50));
    c.use_card("1".into(), "hello".into(), KEY.into());
}

/// M4: two calls started before either settles can't spend the same credit.
#[test]
fn two_calls_cannot_overspend() {
    let mut c = setup();
    let deposit = MINT_FEE.saturating_add(CARD_ACCOUNT_FUND).saturating_add(NearToken::from_yoctonear(PRICE * 3 / 2));
    as_("alice.testnet", deposit);
    c.issue_card(None, None);
    as_("alice.testnet", NearToken::from_millinear(50));
    c.use_card("1".into(), "one".into(), KEY.into());
    let second = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        as_("alice.testnet", NearToken::from_millinear(50));
        c.use_card("1".into(), "two".into(), KEY.into());
    }));
    assert!(second.is_err(), "the second call must be refused");
}

/// M5
#[test]
#[should_panic(expected = "is private")]
fn callback_is_private() {
    let mut c = with_card();
    as_("alice.testnet", NearToken::from_millinear(50));
    c.use_card("1".into(), "hello".into(), KEY.into());
    as_("mallory.testnet", NearToken::from_yoctonear(0));
    c.on_outlayer_result("1".into(), acc("alice.testnet"), U128(PRICE));
}

/// M6
#[test]
fn history_is_capped() {
    let mut c = with_card();
    for _ in 0..(HISTORY_CAP + 10) {
        as_("carol.testnet", NearToken::from_millinear(1));
        c.top_up("1".into());
    }
    assert_eq!(c.history("1".into()).len(), HISTORY_CAP);
}

/// T6: there is no method that sends a card's credit to a person.
#[test]
fn no_withdraw_path() {
    let src = include_str!("lib.rs");
    for word in ["fn withdraw", "fn claim", "fn sweep", "fn drain"] {
        assert!(!src.contains(word), "unexpected method: {word}");
    }
}

#[test]
fn anyone_can_top_up_and_it_reaches_the_card_account() {
    let mut c = with_card();
    let before = credit(&c);
    as_("carol.testnet", NearToken::from_millinear(200));
    c.top_up("1".into());
    assert_eq!(credit(&c), before + NearToken::from_millinear(200).as_yoctonear());
    let r = get_created_receipts().into_iter().find(|r| r.receiver_id == acc("c1.keycard.testnet")).unwrap();
    assert!(format!("{:?}", r.actions).contains("Transfer"));
}

#[test]
fn only_the_provider_changes_the_price() {
    let mut c = setup();
    as_("provider.testnet", NearToken::from_yoctonear(0));
    c.set_price(U128(1));
    assert_eq!(c.config().price_per_call.0, 1);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        as_("alice.testnet", NearToken::from_yoctonear(0));
        c.set_price(U128(0));
    }));
    assert!(r.is_err());
}

#[test]
fn outlayer_outputs_are_parsed_strictly() {
    assert_eq!(parse_outlayer(br#"{"ok":true,"answer":"abc"}"#), Ok("abc".into()));
    assert_eq!(parse_outlayer(br#""{\"ok\":true,\"answer\":\"abc\"}""#), Ok("abc".into()));
    assert!(parse_outlayer(br#"{"ok":false,"error":"nope"}"#).is_err());
    assert!(parse_outlayer(b"hello").is_err());
    assert!(parse_outlayer(br#"{"ok":true}"#).is_err());
}
