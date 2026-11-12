"use client";

// Two real testnet accounts for a visitor, "you" and "a friend", so the whole
// life of a card can be tried without a wallet: buy it, use it, sell it, and
// watch the seller lose access. Key pairs are made in this browser and kept
// in sessionStorage; the server only ever receives the public keys.

import { CONTRACT, RPC } from "./near";

export interface Guest {
  you: string;
  friend: string;
  youKey: string;
  friendKey: string;
  sponsor: string;
}

const STORE = "keycard-guest-v1";
const lib = () => import("near-api-js");

export function loadGuest(): Guest | null {
  try {
    const raw = sessionStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Guest) : null;
  } catch {
    return null;
  }
}

export function saveGuest(g: Guest | null) {
  try {
    if (g) sessionStorage.setItem(STORE, JSON.stringify(g));
    else sessionStorage.removeItem(STORE);
  } catch {
    // Private windows can refuse storage; the session still works until reload.
  }
}

export async function createGuest(): Promise<Guest> {
  const { KeyPair } = await lib();
  const a = KeyPair.fromRandom("ed25519");
  const b = KeyPair.fromRandom("ed25519");
  const res = await fetch("/api/guest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ youKey: a.getPublicKey().toString(), friendKey: b.getPublicKey().toString() }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Couldn't create the demo accounts.");
  const g: Guest = { you: data.you, friend: data.friend, sponsor: data.sponsor, youKey: a.toString(), friendKey: b.toString() };
  saveGuest(g);
  return g;
}

export interface Sent<T> {
  hash: string | null;
  value: T | null;
  failure: string | null;
}

/** Signs one call to the Keycard contract. A contract panic comes back as `failure`, not a throw. */
export async function call<T = unknown>(accountId: string, secretKey: string, method: string, args: object, depositYocto = "0", gasTera = 100): Promise<Sent<T>> {
  const { Account, JsonRpcProvider, KeyPairSigner } = await lib();
  const account = new Account(accountId, new JsonRpcProvider({ url: RPC }), KeyPairSigner.fromSecretKey(secretKey as `ed25519:${string}`));
  try {
    const outcome = (await account.callFunctionRaw({
      contractId: CONTRACT,
      methodName: method,
      args: args as Record<string, unknown>,
      deposit: BigInt(depositYocto),
      gas: BigInt(gasTera) * 1_000_000_000_000n,
    })) as { status?: { SuccessValue?: string; Failure?: unknown }; transaction?: { hash?: string } };
    const hash = outcome.transaction?.hash ?? null;
    if (outcome.status?.Failure) return { hash, value: null, failure: plain(JSON.stringify(outcome.status.Failure)) };
    let value: T | null = null;
    const raw = outcome.status?.SuccessValue;
    if (raw) {
      try {
        value = JSON.parse(atob(raw)) as T;
      } catch {
        value = null;
      }
    }
    return { hash, value, failure: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { hash: /transaction ([1-9A-HJ-NP-Za-km-z]{43,44})/.exec(msg)?.[1] ?? null, value: null, failure: plain(msg) };
  }
}

/** Signs a short message with the account's key, for the holder-only console. */
export async function signLogin(accountId: string, secretKey: string) {
  const { KeyPair } = await lib();
  const pair = KeyPair.fromString(secretKey as `ed25519:${string}`);
  const message = `keycard-console:${accountId}:${Date.now()}`;
  const { signature } = pair.sign(new TextEncoder().encode(message));
  return { account: accountId, message, public_key: pair.getPublicKey().toString(), signature: btoa(String.fromCharCode(...signature)) };
}

/** Closes both accounts and returns what's left to the sponsor. */
export async function closeGuest(g: Guest) {
  const { Account, JsonRpcProvider, KeyPairSigner } = await lib();
  const provider = new JsonRpcProvider({ url: RPC });
  for (const [id, key] of [[g.you, g.youKey], [g.friend, g.friendKey]] as const) {
    try {
      await new Account(id, provider, KeyPairSigner.fromSecretKey(key as `ed25519:${string}`)).deleteAccount(g.sponsor);
    } catch {
      // Already gone or testnet is slow.
    }
  }
  saveGuest(null);
}

/** A contract panic or RPC error as one plain sentence. */
export function plain(raw: string): string {
  const panic = /Smart contract panicked: ([^"\\]+)/.exec(raw)?.[1] ?? /"ExecutionError":"([^"]+)"/.exec(raw)?.[1];
  if (panic) return panic.replace(/^Smart contract panicked: /, "");
  if (/NotEnoughBalance|LackBalance/i.test(raw)) return "This demo account has run out of testnet NEAR. Press Start over.";
  if (/timeout|fetch failed|Failed to fetch/i.test(raw)) return "NEAR testnet is slow right now. Please try again.";
  return raw.length > 180 ? "That didn't go through. Please try again." : raw;
}
