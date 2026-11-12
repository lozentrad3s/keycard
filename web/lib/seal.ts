"use client";

// The holder's reply key. Each visit makes an X25519 key pair in the browser;
// the public half goes with the question, the TEE seals the answer to it, and
// only this browser can open what lands on chain.

type Sodium = typeof import("libsodium-wrappers-sumo");
let ready: Promise<Sodium> | null = null;
const sodium = () => (ready ??= import("libsodium-wrappers-sumo").then(async (m) => {
  const s = (m as unknown as { default?: Sodium }).default ?? (m as unknown as Sodium);
  await s.ready;
  return s;
}));

const STORE = "keycard-reply-key-v1";

export async function replyKey(): Promise<{ publicKey: string; open: (sealedB64: string) => Promise<string> }> {
  const s = await sodium();
  let pair: { publicKey: Uint8Array; privateKey: Uint8Array };
  try {
    const saved = sessionStorage.getItem(STORE);
    if (saved) {
      const { pk, sk } = JSON.parse(saved);
      pair = { publicKey: s.from_base64(pk, s.base64_variants.ORIGINAL), privateKey: s.from_base64(sk, s.base64_variants.ORIGINAL) };
    } else throw new Error("none");
  } catch {
    pair = s.crypto_box_keypair();
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ pk: s.to_base64(pair.publicKey, s.base64_variants.ORIGINAL), sk: s.to_base64(pair.privateKey, s.base64_variants.ORIGINAL) }));
    } catch {
      // Storage refused: the key lives for this page only.
    }
  }
  return {
    publicKey: s.to_base64(pair.publicKey, s.base64_variants.ORIGINAL),
    open: async (sealedB64: string) => {
      const opened = s.crypto_box_seal_open(s.from_base64(sealedB64, s.base64_variants.ORIGINAL), pair.publicKey, pair.privateKey);
      return new TextDecoder().decode(opened);
    },
  };
}
