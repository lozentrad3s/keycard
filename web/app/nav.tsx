"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/try", label: "Try it" },
  { href: "/console", label: "Holder console" },
  { href: "/cards/1", label: "Card #1", hideSm: true },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map((l) => {
        const on = l.href === "/" ? path === "/" : path.startsWith(l.href.split("/").slice(0, 2).join("/"));
        return (
          <Link key={l.href} href={l.href} className={`${on ? "on" : ""} ${l.hideSm ? "hide-sm" : ""}`} aria-current={on ? "page" : undefined}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
