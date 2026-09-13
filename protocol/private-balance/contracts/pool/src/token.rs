use soroban_sdk::{Address, Env, token::Client as TokenClient};

pub(crate) fn deposit(env: &Env, asset: &Address, source: &Address, amount: u64) {
    source.require_auth();
    TokenClient::new(env, asset).transfer(
        source,
        env.current_contract_address(),
        &i128::from(amount),
    );
}

pub(crate) fn withdraw(env: &Env, asset: &Address, recipient: &Address, amount: u64) {
    TokenClient::new(env, asset).transfer(
        &env.current_contract_address(),
        recipient,
        &i128::from(amount),
    );
}
