// Read-only access to the Keycard contract, shared by the browser and the server.

export const NETWORK = "testnet";
export const CONTRACT = process.env.NEXT_PUBLIC_KEYCARD_CONTRACT || "keycard-near.testnet";
export const RPC = "https://rpc.testnet.near.org";
export const EXPLORER = "https://testnet.nearblocks.io";
export const PROJECT = "keycard-provider.testnet/keycard-api";

export const txUrl = (hash: string) => `${EXPLORER}/txns/${hash}`;
export const accountUrl = (id: string) => `${EXPLORER}/address/${id}`;

export interface CardView {
  token_id: string;
  owner_id: string;
  account: string;
  credit: string;
  held: string;
  calls: string;
  spent: string;
  holders: string[];
  listed: boolean;
  calls_left: string;
}

export type Entry =
  | { Minted: { to: string; credit: string } }
  | { Transferred: { from: string; to: string } }
  | { ToppedUp: { by: string; amount: string } }
  | { CallStarted: { by: string; price: string } }
  | { CallPaid: { by: string; price: string } }
  | { CallRefunded: { by: string; price: string; reason: string } }
  | { RoyaltyPaid: { to: string; amount: string } };

export interface HistoryEntry {
  at: string;
  entry: Entry;
}

export interface ConfigView {
  provider: string;
  price_per_call: string;
  royalty_bps: number;
  wallet_code_hash: string;
  outlayer: { contract: string; project_id: string; secrets_profile: string; secrets_owner: string };
  mint_fee: string;
  card_account_fund: string;
}

async function rpc<T>(method: string, params: object): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "kc", method, params }),
    cache: "no-store",
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error?.cause?.name || data.error?.message || "RPC error");
  return data.result as T;
}

/** Calls a view method on any contract. */
export async function view<T>(method: string, args: object = {}, contract = CONTRACT): Promise<T> {
  const r = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: contract,
    method_name: method,
    args_base64: btoa(JSON.stringify(args)),
  });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))) as T;
}

/** Access keys on an account. A card account must have none. */
export async function accessKeys(account: string): Promise<{ public_key: string; access_key: { permission: unknown } }[]> {
  const r = await rpc<{ keys: { public_key: string; access_key: { permission: unknown } }[] }>("query", {
    request_type: "view_access_key_list",
    finality: "optimistic",
    account_id: account,
  });
  return r.keys;
}

export async function accessKey(account: string, publicKey: string): Promise<{ permission: unknown } | null> {
  try {
    return await rpc<{ permission: unknown }>("query", { request_type: "view_access_key", finality: "optimistic", account_id: account, public_key: publicKey });
  } catch {
    return null;
  }
}

export async function balance(account: string): Promise<bigint> {
  const r = await rpc<{ amount: string }>("query", { request_type: "view_account", finality: "optimistic", account_id: account });
  return BigInt(r.amount);
}

const YOCTO = 10n ** 24n;

/** "0.1 NEAR"; never raw yoctoNEAR on screen. */
export function near(yocto: string | bigint, digits = 3): string {
  const v = typeof yocto === "bigint" ? yocto : BigInt(yocto || "0");
  const whole = v / YOCTO;
  const frac = (v % YOCTO).toString().padStart(24, "0").slice(0, digits).replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""} NEAR`;
}

export function toYocto(amount: string): string {
  const [w, f = ""] = amount.split(".");
  return (BigInt(w || "0") * YOCTO + BigInt((f + "0".repeat(24)).slice(0, 24))).toString();
}

export const short = (id: string) => (id.length > 28 ? `${id.slice(0, 14)}…${id.slice(-10)}` : id);

export function when(ms: string | number): string {
  const d = new Date(Number(ms));
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** One plain sentence per history entry. */
export function describe(e: Entry): { title: string; detail: string; kind: "mint" | "move" | "money" | "call" | "refund" } {
  if ("Minted" in e) return { title: "Card issued", detail: `to ${e.Minted.to}, with ${near(e.Minted.credit)} of credit`, kind: "mint" };
  if ("Transferred" in e) return { title: "Changed hands", detail: `${e.Transferred.from} → ${e.Transferred.to}`, kind: "move" };
  if ("ToppedUp" in e) return { title: "Topped up", detail: `${near(e.ToppedUp.amount)} added by ${e.ToppedUp.by}`, kind: "money" };
  if ("CallStarted" in e) return { title: "Question sent", detail: `by ${e.CallStarted.by}; ${near(e.CallStarted.price)} held on the card`, kind: "call" };
  if ("CallPaid" in e) return { title: "Answered", detail: `the card paid the provider ${near(e.CallPaid.price)}`, kind: "money" };
  if ("CallRefunded" in e) return { title: "Refunded to the card", detail: `${near(e.CallRefunded.price)} back on the card: ${e.CallRefunded.reason}`, kind: "refund" };
  if ("RoyaltyPaid" in e) return { title: "Royalty paid", detail: `${near(e.RoyaltyPaid.amount)} to ${e.RoyaltyPaid.to}`, kind: "money" };
  return { title: "Event", detail: "", kind: "call" };
}
