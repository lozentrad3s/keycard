import "server-only";
import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";
import { RPC } from "./near";

export const provider = new JsonRpcProvider({ url: RPC });

/** The funded account that creates demo accounts. Null when not configured. */
export function sponsor(): Account | null {
  const id = process.env.GUEST_SPONSOR_ACCOUNT;
  const key = process.env.GUEST_SPONSOR_KEY;
  if (!id || !key) return null;
  return new Account(id, provider, KeyPairSigner.fromSecretKey(key as `ed25519:${string}`));
}

const hits = new Map<string, number[]>();
/** A small per-IP limit so a public demo can't drain the sponsor. */
export function limited(key: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}

export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
