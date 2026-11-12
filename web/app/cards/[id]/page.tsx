"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Card from "../../card";
import { accessKeys, accountUrl, describe, near, view, when, type CardView, type HistoryEntry } from "@/lib/near";

/** Public: what a card earned, paid and who held it. Buyers check this before they buy. */
export default function CardPage() {
  const { id } = useParams<{ id: string }>();
  const [card, setCard] = useState<CardView | null | undefined>(undefined);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [keys, setKeys] = useState<number | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);

  useEffect(() => {
    view<CardView | null>("card", { token_id: id }).then(async (c) => {
      setCard(c);
      if (!c) return;
      view<HistoryEntry[]>("history", { token_id: id }).then(setHistory).catch(() => {});
      accessKeys(c.account).then((k) => setKeys(k.length)).catch(() => setKeys(null));
      view<string>("balance", {}, c.account).then(setWallet).catch(() => setWallet(null));
    }).catch(() => setCard(null));
  }, [id]);

  if (card === undefined) return <main className="page wrap"><div className="skeleton" /></main>;
  if (card === null) return <main className="page wrap"><h1 style={{ fontSize: "2.4rem" }}>No card #{id}</h1><p className="muted">It hasn&apos;t been issued yet. <Link href="/try">Buy one in the demo.</Link></p></main>;

  const paid = history.filter((h) => "CallPaid" in h.entry).length;
  const refunded = history.filter((h) => "CallRefunded" in h.entry).length;

  return (
    <main className="page wrap">
      <div className="split" style={{ alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: "clamp(2.2rem,1.4rem+3vw,3.4rem)" }}>Card #{card.token_id}</h1>
          <p className="lede">Its own account, its own credit, and every holder it has had. This page is public: a buyer can check it before they buy.</p>
          <dl className="kv" style={{ marginTop: 24 }}>
            <dt>Held by</dt><dd className="mono"><a href={accountUrl(card.owner_id)}>{card.owner_id}</a></dd>
            <dt>Card account</dt><dd className="mono"><a href={accountUrl(card.account)}>{card.account}</a></dd>
            <dt>Keys on that account</dt><dd>{keys === null ? "checking…" : keys === 0 ? "None. Nobody can sign as the card." : `${keys}`}</dd>
            <dt>Credit (Keycard&apos;s count)</dt><dd>{near(card.credit)} · {card.calls_left} questions left</dd>
            <dt>Held in the account</dt><dd>{wallet ? near(wallet) : "…"} (always at least the credit)</dd>
            <dt>Earned by the provider</dt><dd>{near(card.spent)} over {card.calls} answered questions</dd>
            <dt>Listed for sale</dt><dd>{card.listed ? "Yes: the card can't be used until the listing is removed" : "No"}</dd>
          </dl>
        </div>
        <Card card={card} />
      </div>

      <section className="split" style={{ marginTop: 56 }}>
        <div>
          <h2 style={{ fontSize: "1.8rem" }}>History</h2>
          <p className="muted">{history.length} entries · {paid} paid {paid === 1 ? "call" : "calls"} · {refunded} refunded · {card.holders.length} {card.holders.length === 1 ? "holder" : "holders"}</p>
          <p className="small muted">Kept by the Keycard contract, last 50 entries per card. Every number above is read from NEAR testnet when you open the page.</p>
        </div>
        <ol className="hist">
          {[...history].reverse().map((h, i) => {
            const d = describe(h.entry);
            return (
              <li key={i} className={d.kind}>
                <b>{d.title}</b>
                <span>{d.detail}</span>
                <span className="small" style={{ display: "block" }}>{when(h.at)}</span>
              </li>
            );
          })}
        </ol>
      </section>
    </main>
  );
}
