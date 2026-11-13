import type { Metadata } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import Nav from "./nav";
import "./globals.css";

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

const site =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3100");
const title = "Keycard: API access as an NFT";
const description = "Each card is its own NEAR account holding its credit. The provider's API key stays sealed in an OutLayer TEE. Sell the card and the access goes with it.";

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: title, template: "%s · Keycard" },
  description,
  openGraph: { title, description, type: "website", siteName: "Keycard" },
  twitter: { card: "summary_large_image", title, description },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <header className="top">
          <div className="wrap">
            <a className="brand" href="/" aria-label="Keycard home"><i aria-hidden />Keycard</a>
            <Nav />
          </div>
        </header>
        {children}
        <footer className="foot">
          <div className="wrap">
            <div>
              <p style={{ margin: 0 }}><b style={{ color: "var(--text)" }}>Keycard</b>. Built at NEAR HACKATHON 2026 on NEAR testnet with OutLayer and NEAR AI Cloud.</p>
            </div>
            <div className="row">
              <a href="https://github.com/lozentrad3s/keycard">GitHub</a>
              <a href="https://testnet.nearblocks.io/address/keycard-near.testnet">Contract</a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
