import { near, short, type CardView } from "@/lib/near";

/** The card as an object: who holds it, what's on it. */
export default function Card({ card, label, dim = false }: { card?: CardView | null; label?: string; dim?: boolean }) {
  return (
    <div className={`kcard ${dim ? "dim" : ""}`} aria-label={card ? `Keycard number ${card.token_id}, held by ${card.owner_id}` : "An example Keycard"}>
      <div className="k-top">
        <div className="chip" aria-hidden />
        <div className="k-name">KEYCARD{card ? ` #${card.token_id}` : ""}</div>
      </div>
      <div className="k-mid">{card ? short(card.account) : "c1.keycard-near.testnet"}</div>
      <div className="k-bot">
        <div>
          <span>Holder</span>
          <b className="mono" style={{ fontSize: ".85rem" }}>{card ? short(card.owner_id) : label ?? "you.testnet"}</b>
        </div>
        <div style={{ textAlign: "right" }}>
          <span>Credit</span>
          <b>{card ? near(card.credit) : "0.1 NEAR"}</b>
        </div>
      </div>
    </div>
  );
}
