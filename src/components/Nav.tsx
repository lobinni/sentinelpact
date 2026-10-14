"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mark } from "./Mark";
import { WalletButton } from "./WalletButton";

const LINKS = [
  { href: "/warranties", label: "Warranties" },
  { href: "/incidents", label: "Incidents" },
  { href: "/open", label: "Open" },
  { href: "/protocol", label: "Protocol" },
  { href: "/account", label: "Account" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="nav">
      <div className="container-x flex items-center justify-between gap-4 py-3">
        <Link href="/" className="flex items-center gap-3 text-[var(--ink)]">
          <Mark />
          <span className="leading-none">
            <span className="display block text-[15px] tracking-tight">SentinelPact</span>
            <span className="mono mt-1 block text-[9px] uppercase tracking-[0.22em] text-[var(--muted-fg)]">
              Bonded release warranties
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`nav-link ${pathname.startsWith(link.href) ? "nav-link-active" : ""}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <span className="pill pill-live hidden lg:inline-flex">
            <span>Studionet · 61999</span>
          </span>
          <WalletButton />
        </div>
      </div>

      <nav className="container-x flex gap-5 overflow-x-auto no-scrollbar pb-3 md:hidden">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`nav-link ${pathname.startsWith(link.href) ? "nav-link-active" : ""}`}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
