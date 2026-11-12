import { NextResponse } from "next/server";
import { clientIp, limited, sponsor } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const YOU = 600_000_000_000_000_000_000_000n; // 0.6 NEAR: a card (0.15), OutLayer fees and gas reserved up front
const FRIEND = 450_000_000_000_000_000_000_000n; // 0.45 NEAR: enough to use a card a few times
const KEY = /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/;

/** Whether demo accounts are available. */
export async function GET() {
  const s = sponsor();
  if (!s) return NextResponse.json({ enabled: false });
  try {
    const left = (await s.getBalance()) / (YOU + FRIEND);
    return NextResponse.json({ enabled: true, sets: Number(left) });
  } catch {
    return NextResponse.json({ enabled: true, sets: 0 });
  }
}

/**
 * Creates two testnet accounts, "you" and "a friend", from public keys made
 * in the visitor's browser. The private keys never reach this server.
 */
export async function POST(req: Request) {
  const s = sponsor();
  if (!s) return NextResponse.json({ error: "Demo accounts aren't switched on here. Run the site with GUEST_SPONSOR_ACCOUNT and GUEST_SPONSOR_KEY set." }, { status: 503 });
  if (limited(`guest:${clientIp(req)}`, 3, 10 * 60_000)) return NextResponse.json({ error: "You've started a few demos already. Give it ten minutes." }, { status: 429 });
  let body: { youKey?: string; friendKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON with youKey and friendKey." }, { status: 400 });
  }
  if (!KEY.test(body.youKey ?? "") || !KEY.test(body.friendKey ?? "")) return NextResponse.json({ error: "Both keys must be ed25519 public keys." }, { status: 400 });
  try {
    if ((await s.getBalance()) < (YOU + FRIEND) * 2n) return NextResponse.json({ error: "The demo has run out of testnet NEAR for now. Please try again later." }, { status: 503 });
    const tag = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, "0")).join("");
    const you = `you-${tag}.${s.accountId}`;
    const friend = `friend-${tag}.${s.accountId}`;
    await s.createSubAccount({ accountOrPrefix: you, publicKey: body.youKey!, nearToTransfer: YOU });
    await s.createSubAccount({ accountOrPrefix: friend, publicKey: body.friendKey!, nearToTransfer: FRIEND });
    return NextResponse.json({ you, friend, sponsor: s.accountId });
  } catch (e) {
    console.error("guest", e);
    return NextResponse.json({ error: "NEAR testnet didn't answer in time. Please press the button again." }, { status: 502 });
  }
}
