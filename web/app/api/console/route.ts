import { NextResponse } from "next/server";
import { PublicKey } from "near-api-js";
import { accessKey, view, type CardView } from "@/lib/near";
import { clientIp, limited } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FRESH_MS = 2 * 60_000;

/**
 * The holder-only console. Every request proves, again, three things: the
 * message was signed by the key it names, that key is a full-access key on
 * the account, and the account owns the card on chain right now. No session
 * or cookie survives a transfer, so a seller loses the console the moment
 * the card moves.
 */
export async function POST(req: Request) {
  if (limited(`console:${clientIp(req)}`, 30)) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  let body: { token_id?: string; account?: string; message?: string; public_key?: string; signature?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  const { token_id, account, message, public_key, signature } = body;
  if (!token_id || !account || !message || !public_key || !signature) return NextResponse.json({ error: "token_id, account, message, public_key and signature are required." }, { status: 400 });

  const m = /^keycard-console:([^:]+):(\d+)$/.exec(message);
  if (!m || m[1] !== account || Math.abs(Date.now() - Number(m[2])) > FRESH_MS) return NextResponse.json({ error: "That sign-in has expired. Sign again." }, { status: 401 });

  let signed = false;
  try {
    signed = PublicKey.fromString(public_key).verify(new TextEncoder().encode(message), Buffer.from(signature, "base64"));
  } catch {
    signed = false;
  }
  if (!signed) return NextResponse.json({ error: "The signature doesn't match." }, { status: 401 });
  const key = await accessKey(account, public_key);
  if (key?.permission !== "FullAccess") return NextResponse.json({ error: "That key doesn't belong to this account." }, { status: 401 });

  const card = await view<CardView | null>("card", { token_id }).catch(() => null);
  if (!card) return NextResponse.json({ error: "No such card." }, { status: 404 });
  if (card.owner_id !== account) {
    return NextResponse.json({ error: `Only the card's current holder can open this console. Card #${token_id} belongs to ${card.owner_id}.`, holder: card.owner_id }, { status: 403 });
  }

  // What only a holder sees: the card's private settings and perks.
  return NextResponse.json({
    ok: true,
    card,
    perks: [
      "Ask the provider's API through the TEE. The key never leaves OutLayer.",
      "Answers are sealed to a key made in your browser; on chain there is only ciphertext.",
      "Top up from any account. Sell or give the card and the credit goes with it.",
    ],
    checked: { signature: true, full_access_key: true, owns_card_now: true, at: new Date().toISOString() },
  });
}
