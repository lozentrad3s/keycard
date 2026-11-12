import Link from "next/link";
import Card from "./card";

const STEPS = [
  { t: "A provider issues cards", d: "Each card is an NEP-171 token with a price per call. Whatever the buyer pays above the fees becomes the card's credit." },
  { t: "Every card is its own account", d: "Minting creates c<N>.keycard-near.testnet running one shared wallet contract (a NEAR global contract). It has no access keys, so no person can ever sign as the card." },
  { t: "The holder asks, the TEE answers", d: "Keycard checks the caller owns the card, holds the price on the card, and asks OutLayer to run the API call in an Intel TDX enclave with the provider's key." },
  { t: "Sell it, and it's gone from you", d: "Transfer the NFT and the access, the credit and the history move with it. The seller has no key, no session and no balance to keep." },
];

const THREATS = [
  ["The seller kept a key to the card's account", "The card account is created with no keys and never gets one. Its wallet obeys only the Keycard contract."],
  ["The seller copied the API key", "Nobody ever had it. It's an OutLayer secret only the Keycard contract may use, read only inside the enclave, and scrubbed from every answer."],
  ["The seller starts a call, then sells mid-call", "The price is held on the card. A refund goes back onto the card, not to a person, so it belongs to the new owner."],
  ["The seller drains the credit while it's listed", "A card with an active marketplace approval can't be used. The balance a buyer sees is the balance they get."],
  ["Everyone reads the answer on chain", "The answer is sealed to a key made in the holder's browser. On chain there is only ciphertext."],
];

export default function Home() {
  return (
    <main>
      <section className="hero">
        <div className="wrap">
          <div>
            <h1>API access you can hold, sell and give away.</h1>
            <p className="lede">
              Keycard turns access to a paid API into an NFT. Each card is a real NEAR account that holds its own credit, and the
              provider&apos;s key stays sealed in a TEE where nobody, not even the holder, can see it.
            </p>
            <div className="row">
              <Link className="btn go" href="/try">Try it: buy, use and sell a card</Link>
              <Link className="btn" href="/cards/1">See card #1&apos;s history</Link>
            </div>
            <p className="small muted" style={{ marginTop: 16 }}>Real transactions on NEAR testnet. No wallet needed: the demo makes two accounts for you.</p>
          </div>
          <Card />
        </div>
      </section>

      <section className="band">
        <div className="wrap split">
          <div>
            <h2>An API key is a secret pretending to be property.</h2>
          </div>
          <div>
            <p className="ps"><b>The problem.</b> Selling access to a paid API means handing out keys. A key can be copied, shared and leaked, and it can&apos;t be taken back from one person without breaking everyone else. People who bought access can&apos;t resell what they didn&apos;t use, and a buyer can never be sure the seller kept no copy.</p>
            <p className="ps"><b>What Keycard does.</b> The key never leaves the provider&apos;s enclave. What people own is a card: an NFT whose credit lives in its own account and whose access follows whoever holds it, checked on chain on every call.</p>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap split">
          <h2>How a card works</h2>
          <ol className="steps">
            {STEPS.map((s) => (
              <li key={s.t}>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <h2 style={{ maxWidth: 760 }}>Every way a seller could try to keep something</h2>
          <p className="ps" style={{ marginTop: 16 }}>Written before the code, as a threat model. Each line has a test in <a href="https://github.com/lozentrad3s/keycard/blob/main/docs/THREAT_MODEL.md">docs/THREAT_MODEL.md</a>.</p>
          <table className="table" style={{ marginTop: 24 }}>
            <thead><tr><th>Attack</th><th>Why it fails</th></tr></thead>
            <tbody>
              {THREATS.map(([a, d]) => (
                <tr key={a}><td><b>{a}</b></td><td className="muted">{d}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="facts">
            <div><b>NEP-171 + NEP-199</b><p>Standard NFT with enumeration, approvals, metadata and a resale royalty to the provider.</p></div>
            <div><b>Global contracts</b><p>One card-wallet contract published once; every card account uses it for under 0.001 NEAR.</p></div>
            <div><b>OutLayer TEE</b><p>The API call runs in an Intel TDX enclave with a secret only the Keycard contract may read.</p></div>
          </div>
        </div>
      </section>

      <section className="band" style={{ borderBottom: 0 }}>
        <div className="wrap split">
          <h2>Try the whole life of a card in two minutes</h2>
          <div>
            <p className="ps">Buy a card, ask the API a question, sell the card to a friend, and watch your own access stop while theirs starts. Every step is a real transaction you can open on the explorer.</p>
            <Link className="btn go" href="/try">Open the demo</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
