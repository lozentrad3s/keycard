"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Card from "../card";
import { call, closeGuest, createGuest, loadGuest, type Guest } from "@/lib/guest";
import { accessKeys, near, short, toYocto, txUrl, view, type CardView, type ConfigView } from "@/lib/near";
import { replyKey } from "@/lib/seal";

interface Line {
  who: string;
  text: string;
  hash: string | null;
  tone?: "good" | "bad";
}

const OUTLAYER_FEE = "0.05"; // attached for OutLayer; the unused part comes back
const SUGGESTED = ["Explain NEAR Protocol in one sentence.", "What is a TEE, in plain words?", "Give me a haiku about API keys."];

export default function TryPage() {
  const [guest, setGuest] = useState<Guest | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [card, setCard] = useState<CardView | null>(null);
  const [config, setConfig] = useState<ConfigView | null>(null);
  const [keys, setKeys] = useState<number | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState<Record<"you" | "friend", { q: string; a: string; refunded?: string } | null>>({ you: null, friend: null });
  const [prompt, setPrompt] = useState<Record<"you" | "friend", string>>({ you: SUGGESTED[0], friend: SUGGESTED[1] });
  const [log, setLog] = useState<Line[]>([]);

  const note = (who: string, text: string, hash: string | null, tone?: Line["tone"]) => setLog((l) => [{ who, text, hash, tone }, ...l]);

  const refresh = useCallback(async (g: Guest | null = guest, id?: string) => {
    if (!g) return;
    let tokenId = id ?? card?.token_id;
    if (!tokenId) {
      for (const owner of [g.you, g.friend]) {
        const mine = await view<{ token_id: string }[]>("nft_tokens_for_owner", { account_id: owner, limit: 50 }).catch(() => []);
        if (mine.length) tokenId = mine[mine.length - 1].token_id;
      }
    }
    if (!tokenId) return setCard(null);
    const c = await view<CardView | null>("card", { token_id: tokenId }).catch(() => null);
    setCard(c);
    if (c) accessKeys(c.account).then((k) => setKeys(k.length)).catch(() => setKeys(null));
  }, [guest, card?.token_id]);

  useEffect(() => {
    const g = loadGuest();
    setGuest(g);
    setLoaded(true);
    fetch("/api/guest").then((r) => r.json()).then((d) => setEnabled(!!d.enabled && (d.sets ?? 0) > 0)).catch(() => setEnabled(false));
    view<ConfigView>("config").then(setConfig).catch(() => {});
    if (g) refresh(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    setBusy("start");
    setError("");
    try {
      const g = await createGuest();
      setGuest(g);
      note("Setup", `Made two testnet accounts: you (${short(g.you)}) and a friend (${short(g.friend)})`, null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const buy = async () => {
    if (!guest) return;
    setBusy("buy");
    setError("");
    const r = await call(guest.you, guest.youKey, "issue_card", { title: "Keycard: NEAR AI answers" }, toYocto("0.15"), 100);
    if (r.failure) {
      setError(r.failure);
    } else {
      note("You", "Bought a card for 0.15 NEAR: 0.1 NEAR of it is the card's credit, held in the card's own account", r.hash, "good");
      const mine = await view<{ token_id: string }[]>("nft_tokens_for_owner", { account_id: guest.you, limit: 50 }).catch(() => []);
      await refresh(guest, mine[mine.length - 1]?.token_id);
    }
    setBusy("");
  };

  const ask = async (who: "you" | "friend") => {
    if (!guest || !card) return;
    setBusy(`ask-${who}`);
    setError("");
    const account = who === "you" ? guest.you : guest.friend;
    const key = who === "you" ? guest.youKey : guest.friendKey;
    const label = who === "you" ? "You" : "Your friend";
    const q = prompt[who].trim();
    const rk = await replyKey();
    const r = await call<string | null>(account, key, "use_card", { token_id: card.token_id, prompt: q, reply_pubkey: rk.publicKey }, toYocto(OUTLAYER_FEE), 200);
    if (r.failure) {
      const refused = /current owner/.test(r.failure);
      note(label, refused ? `Tried to use the card and was refused: "${r.failure}"` : `Couldn't use the card: ${r.failure}`, r.hash, refused ? "bad" : undefined);
      if (!refused) setError(r.failure);
    } else if (typeof r.value === "string") {
      let text = "";
      try {
        text = await rk.open(r.value);
      } catch {
        text = "(The answer arrived sealed to a different key.)";
      }
      setAnswers((a) => ({ ...a, [who]: { q, a: text } }));
      note(label, `Asked the API. The card paid the provider ${config ? near(config.price_per_call) : "the call price"}; the answer came back sealed`, r.hash, "good");
    } else {
      setAnswers((a) => ({ ...a, [who]: { q, a: "", refunded: "The API call didn't complete, so the price went back onto the card. The card's history shows why." } }));
      note(label, "Asked the API; it didn't answer, so the price went back onto the card (not to a person)", r.hash);
    }
    await refresh();
    setBusy("");
  };

  const sell = async () => {
    if (!guest || !card) return;
    setBusy("sell");
    setError("");
    const r = await call(guest.you, guest.youKey, "nft_transfer", { receiver_id: guest.friend, token_id: card.token_id, memo: "Sold to a friend" }, "1", 50);
    if (r.failure) setError(r.failure);
    else note("You", "Sold the card to your friend. The credit and the history went with it", r.hash, "good");
    await refresh();
    setBusy("");
  };

  const topUp = async (who: "you" | "friend") => {
    if (!guest || !card) return;
    setBusy(`top-${who}`);
    const account = who === "you" ? guest.you : guest.friend;
    const key = who === "you" ? guest.youKey : guest.friendKey;
    const r = await call(account, key, "top_up", { token_id: card.token_id }, toYocto("0.02"), 50);
    if (r.failure) setError(r.failure);
    else note(who === "you" ? "You" : "Your friend", "Added 0.02 NEAR to the card. It went to the card's account, not to its holder", r.hash, "good");
    await refresh();
    setBusy("");
  };

  const reset = async () => {
    if (!guest) return;
    setBusy("reset");
    await closeGuest(guest);
    setGuest(null);
    setCard(null);
    setAnswers({ you: null, friend: null });
    setLog([]);
    setBusy("");
  };

  if (!loaded) return <main className="page wrap"><div className="skeleton" /></main>;

  if (!guest) {
    return (
      <main className="page wrap">
        <div className="page-head">
          <h1 style={{ fontSize: "clamp(2.2rem,1.4rem+3vw,3.6rem)" }}>Buy a card, use it, sell it.</h1>
          <p>You&apos;ll get two real accounts on NEAR testnet: you, and a friend you&apos;ll sell the card to. The keys are made in this browser; the server only sees the public halves.</p>
        </div>
        <ol className="steps" style={{ maxWidth: 760, marginBottom: 28 }}>
          <li><h3>Buy a card</h3><p>Its credit goes into its own new account, which has no keys.</p></li>
          <li><h3>Ask the API</h3><p>The provider&apos;s key is used inside OutLayer&apos;s TEE; the answer is sealed to your browser.</p></li>
          <li><h3>Sell it to your friend</h3><p>Then try to use it yourself. The contract refuses: access left with the card.</p></li>
        </ol>
        <button className="btn go" onClick={start} disabled={!!busy || enabled === false}>{busy ? <><span className="spinner" /> Making two accounts…</> : "Start: make my two accounts"}</button>
        {enabled === false && <p className="notice" style={{ marginTop: 16, maxWidth: 640 }}>Demo accounts aren&apos;t available on this deployment right now. Card #1&apos;s <Link href="/cards/1">history</Link> shows a real card, and the README explains how to run the demo yourself.</p>}
        {error && <p className="notice bad" role="alert" style={{ marginTop: 16 }}>{error}</p>}
      </main>
    );
  }

  const owner = card?.owner_id;
  const youHold = owner === guest.you;
  const friendHolds = owner === guest.friend;

  const askBox = (who: "you" | "friend", holds: boolean) => (
    <div style={{ display: "grid", gap: 10 }}>
      <label>
        Ask the API
        <textarea value={prompt[who]} maxLength={900} onChange={(e) => setPrompt((p) => ({ ...p, [who]: e.target.value }))} />
      </label>
      <div className="row">
        <button className={`btn ${holds ? "go" : ""}`} onClick={() => ask(who)} disabled={!!busy || !card || !prompt[who].trim()}>
          {busy === `ask-${who}` ? <><span className="spinner" /> Asking through the TEE…</> : holds ? `Ask (${config ? near(config.price_per_call) : "0.01 NEAR"} from the card)` : "Try to use the card anyway"}
        </button>
        <button className="btn small" onClick={() => topUp(who)} disabled={!!busy || !card}>Top up 0.02</button>
      </div>
      {answers[who] && (
        <div className="answer" aria-live="polite">
          {answers[who]!.refunded ? <span className="muted">{answers[who]!.refunded}</span> : answers[who]!.a}
          {!answers[who]!.refunded && <small>Opened in this browser from the sealed answer on chain.</small>}
        </div>
      )}
    </div>
  );

  return (
    <main className="page wrap">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 20 }}>
        <p className="muted small" style={{ margin: 0 }}>Demo accounts: <span className="mono">{short(guest.you)}</span> and <span className="mono">{short(guest.friend)}</span></p>
        <button className="btn small" onClick={reset} disabled={!!busy}>{busy === "reset" ? "Closing accounts…" : "Start over"}</button>
      </div>
      {error && <p className="notice bad" role="alert">{error}</p>}

      {!card ? (
        <div className="panel" style={{ maxWidth: 640 }}>
          <div className="panel-head"><b>You</b><span className="tag">No card yet</span></div>
          <p className="muted" style={{ margin: 0 }}>A card costs 0.15 NEAR here: 0.03 for the token, 0.02 to open the card&apos;s own account, and 0.1 of credit, enough for ten questions.</p>
          <button className="btn go" onClick={buy} disabled={!!busy}>{busy === "buy" ? <><span className="spinner" /> Issuing the card…</> : "Buy a card"}</button>
        </div>
      ) : (
        <>
          <div className="phones">
            <section className="panel" aria-label="You">
              <div className="panel-head"><b>You</b><span className={`tag ${youHold ? "on" : ""}`}>{youHold ? "Holder" : "Sold it"}</span></div>
              <Card card={card} dim={!youHold} />
              {askBox("you", youHold)}
              {youHold && <button className="btn" onClick={sell} disabled={!!busy}>{busy === "sell" ? <><span className="spinner" /> Transferring…</> : "Sell the card to your friend"}</button>}
            </section>
            <section className="panel" aria-label="Your friend">
              <div className="panel-head"><b>Your friend</b><span className={`tag ${friendHolds ? "on" : ""}`}>{friendHolds ? "Holder" : "Waiting"}</span></div>
              {friendHolds ? <Card card={card} /> : <p className="muted" style={{ margin: 0 }}>Your friend has no card yet. Sell yours to them and it appears here, with whatever credit is left on it.</p>}
              {friendHolds && askBox("friend", true)}
            </section>
          </div>

          <section className="panel" style={{ marginTop: 20 }} aria-label="The card on chain">
            <div className="panel-head"><b>Card #{card.token_id} on chain</b><Link href={`/cards/${card.token_id}`} className="small">Full history →</Link></div>
            <dl className="kv">
              <dt>Card account</dt><dd className="mono">{card.account}</dd>
              <dt>Access keys on it</dt><dd>{keys === null ? "checking…" : keys === 0 ? "None. Nobody can sign as the card." : `${keys} (unexpected)`}</dd>
              <dt>Credit</dt><dd>{near(card.credit)} · {card.calls_left} questions left</dd>
              <dt>Calls paid</dt><dd>{card.calls} · {near(card.spent)} to the provider</dd>
              <dt>Holders</dt><dd>{card.holders.map(short).join(" → ")}</dd>
            </dl>
            <p className="small muted" style={{ margin: 0 }}>Holder-only page: <Link href={`/console?card=${card.token_id}`}>open the console</Link> as whoever holds the card now.</p>
          </section>
        </>
      )}

      {log.length > 0 && (
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: "1.5rem", marginBottom: 12 }}>What happened on NEAR</h2>
          <ol className="log">
            {log.map((l, i) => (
              <li key={i}>
                <span className="who">{l.who}</span>
                <span style={{ color: l.tone === "bad" ? "#ffb3ab" : l.tone === "good" ? "var(--text)" : "var(--muted)" }}>{l.text}</span>
                {l.hash ? <a href={txUrl(l.hash)} target="_blank" rel="noreferrer">View transaction</a> : <span />}
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
