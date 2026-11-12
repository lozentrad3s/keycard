//! The contract every Keycard card account runs.
//!
//! Each card is its own NEAR account, `c<N>.<keycard contract>`, created with
//! no access keys and pointed at this code as a global contract (NEP-591).
//! Nobody can sign as the card. Its NEAR is the card's credit, and it leaves
//! only when the Keycard contract that created it asks: as a call price paid
//! to the provider. Anyone may top it up.

use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

/// Kept back so the account can always pay for its own storage.
const STORAGE_RESERVE: NearToken = NearToken::from_millinear(5);

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct CardWallet {
    /// The Keycard contract. The only account this wallet obeys.
    parent: AccountId,
    /// Which card this account is, for anyone reading it directly.
    token_id: String,
}

#[near]
impl CardWallet {
    /// Called by the Keycard contract in the same transaction that creates
    /// the account, so nobody else can initialise it first.
    #[init]
    pub fn new(token_id: String) -> Self {
        Self { parent: env::predecessor_account_id(), token_id }
    }

    /// Pays `amount` to `receiver_id`. Only the Keycard contract may call it,
    /// and it never pays out the storage reserve.
    pub fn pay(&mut self, receiver_id: AccountId, amount: U128) -> Promise {
        require!(env::predecessor_account_id() == self.parent, "Only the Keycard contract can move this card's credit");
        let amount = NearToken::from_yoctonear(amount.0);
        require!(amount <= self.spendable(), "Not enough credit on this card");
        Promise::new(receiver_id).transfer(amount)
    }

    /// Anyone can add credit to a card. A plain transfer to the account works too.
    #[payable]
    pub fn top_up(&mut self) -> U128 {
        self.balance()
    }

    /// Credit the card can spend, after its storage reserve.
    pub fn balance(&self) -> U128 {
        U128(self.spendable().as_yoctonear())
    }

    pub fn parent(&self) -> AccountId {
        self.parent.clone()
    }

    pub fn token_id(&self) -> String {
        self.token_id.clone()
    }

    fn spendable(&self) -> NearToken {
        let storage = env::storage_byte_cost().saturating_mul(env::storage_usage() as u128);
        env::account_balance().saturating_sub(storage).saturating_sub(STORAGE_RESERVE)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn ctx(predecessor: AccountId, balance: NearToken) {
        testing_env!(VMContextBuilder::new()
            .current_account_id("c1.keycard.testnet".parse().unwrap())
            .predecessor_account_id(predecessor)
            .account_balance(balance)
            .storage_usage(200)
            .build());
    }

    #[test]
    fn remembers_its_parent() {
        ctx(accounts(0), NearToken::from_near(1));
        let w = CardWallet::new("1".into());
        assert_eq!(w.parent(), accounts(0));
        assert_eq!(w.token_id(), "1");
    }

    #[test]
    fn parent_can_pay_within_balance() {
        ctx(accounts(0), NearToken::from_near(1));
        let mut w = CardWallet::new("1".into());
        let _ = w.pay(accounts(2), U128(NearToken::from_millinear(100).as_yoctonear()));
    }

    #[test]
    #[should_panic(expected = "Only the Keycard contract")]
    fn wallet_rejects_strangers() {
        ctx(accounts(0), NearToken::from_near(1));
        let mut w = CardWallet::new("1".into());
        ctx(accounts(1), NearToken::from_near(1));
        let _ = w.pay(accounts(1), U128(1));
    }

    #[test]
    #[should_panic(expected = "Not enough credit")]
    fn cannot_pay_out_the_storage_reserve() {
        ctx(accounts(0), NearToken::from_millinear(6));
        let mut w = CardWallet::new("1".into());
        let _ = w.pay(accounts(2), U128(NearToken::from_millinear(5).as_yoctonear()));
    }
}
