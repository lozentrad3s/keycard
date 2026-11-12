"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Card from "../card";
import { loadGuest, signLogin, type Guest } from "@/lib/guest";
import { short, type CardView } from "@/lib/near";

interface Opened {
  card: CardView;
  perks: string[];
  checked: { signature: boolean; full_access_key: boolean; owns_card_now: boolean; at: string };
}

export default function ConsolePage() {
  return (
    <Suspense fallback={<main className="page wrap"><div className="skeleton" /></main>}>
      <Console />
    </Suspense>
  );
}

/** Opens only for the card's current holder, checked again on every request. */
function Console() {
  const params = useSearchParams();
  const [guest, setGuest] = useState<Guest | null>(null);
  const [token, setToken] = useState(params.get("card") ?? "1");
  const [as, setAs] = useState<"you" | "friend">("you");
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [refused, setRefused] = useState("");

  useEffect(() => setGuest(loadGuest()), []);

  const open = async () => {
    if (!guest) return;
    setBusy(true);
    setOpened(null);
    setRefused("");
    const account = as === "you" ? guest.you : guest.friend;
    const key = as === "you" ? guest.youKey : guest.friendKey;
    try {
      const signed = await signLogin(account, key);
      const res = await fetch("/api/console", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token_id: token, ...signed }) });
      const data = await res.json();
      if (res.ok) setOpened(data);
      else setRefused(data.error || "Refused.");
    } catch (e) {
      setRefused(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page wrap">
      <div className="page-head">
        <h1 style={{ fontSize: "clamp(2.2rem,1.4rem+3vw,3.4rem)" }}>Holder console</h1>
        <p>Only the person who holds a card right now can open this page. Each visit signs a fresh message; the server checks the signature, that the key belongs to the account, and that the account owns the card on chain at this moment. Nothing outlives a sale.</p>
      </div>

      {!guest ? (
        <p className="notice" style={{ maxWidth: 680 }}>This console signs in with the demo accounts. <Link href="/try">Start the demo</Link> and buy a card first, then come back.</p>
      ) : (
        <div className="panel" style={{ maxWidth: 680 }}>
          <div className="row" style={{ alignItems: "end" }}>
            <label style={{ flex: "1 1 160px" }}>
              Card number
              <input value={token} inputMode="numeric" onChange={(e) => setToken(e.target.value.replace(/\D/g, ""))} />
            </label>
            <label style={{ flex: "1 1 220px" }}>
              Sign in as
              <select value={as} onChange={(e) => setAs(e.target.value as "you" | "friend")}>
                <option value="you">You ({short(guest.you)})</option>
                <option value="friend">Your friend ({short(guest.friend)})</option>
              </select>
            </label>
            <button className="btn go" onClick={open} disabled={busy || !token}>{busy ? <><span className="spinner" /> Checking…</> : "Sign and open"}</button>
          </div>
          {refused && <p className="notice bad" role="alert" style={{ margin: 0 }}>{refused}</p>}
        </div>
      )}

      {opened && (
        <section className="split" style={{ marginTop: 32, alignItems: "start" }}>
          <Card card={opened.card} />
          <div className="panel">
            <div className="panel-head"><b>Welcome, holder of card #{opened.card.token_id}</b><span className="tag on">Verified now</span></div>
            <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8 }}>
              {opened.perks.map((p) => <li key={p}>{p}</li>)}
            </ul>
            <dl className="kv">
              <dt>Signature</dt><dd>{opened.checked.signature ? "Valid" : "Invalid"}</dd>
              <dt>Key on the account</dt><dd>{opened.checked.full_access_key ? "Full access" : "No"}</dd>
              <dt>Owns the card now</dt><dd>{opened.checked.owns_card_now ? "Yes, read from chain" : "No"}</dd>
              <dt>Checked at</dt><dd>{new Date(opened.checked.at).toLocaleTimeString()}</dd>
            </dl>
            <div className="row">
              <Link className="btn small" href="/try">Use the card</Link>
              <Link className="btn small" href={`/cards/${opened.card.token_id}`}>History</Link>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
