"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export type SafeLinkProps = {
  href: string;
  className?: string;
  children: ReactNode;
};

/**
 * The single link helper for targets that may or may not exist in this clone.
 *
 * This site is the stimulus for a mouse-movement study, so a click must never
 * do something the real site would not: a bare "#" href would yank the page
 * back to the top and pollute the recording, and an outbound link would take
 * the participant off the site mid-session.
 *
 *   "/…"        → real cloned route, rendered with next/link
 *   "http(s)…"  → genuine external link, opened in a new tab
 *   "#"         → placeholder, clickable but inert
 *   "#section"  → in-page anchor, left to the browser
 */
export default function SafeLink({ href, className, children }: SafeLinkProps) {
  if (href.startsWith("/")) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }

  if (href.startsWith("http://") || href.startsWith("https://")) {
    return (
      <a
        href={href}
        className={className}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  }

  if (href === "#") {
    return (
      <a
        href="#"
        className={className}
        onClick={(event) => event.preventDefault()}
      >
        {children}
      </a>
    );
  }

  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}
