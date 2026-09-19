"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { ActivityIcon, ChevronLeft, Close } from "@/components/Icons";
import type { ActivityKind } from "@/components/Icons";
import SafeLink from "@/components/SafeLink";

export type { ActivityKind };

export type BlockDrawerProps = {
  children: ReactNode;
  /** Start collapsed. Defaults to open, like the real site. */
  defaultOpen?: boolean;
  /** Accessible name for the aside. */
  ariaLabel?: string;
  className?: string;
};

/**
 * The 315px right-hand block drawer shared by the dashboard and the course
 * pages. Collapsing swaps the panel for a narrow rail with a reopen button.
 */
export default function BlockDrawer({
  children,
  defaultOpen = true,
  ariaLabel = "Block drawer",
  className,
}: BlockDrawerProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (!open) {
    return (
      <div className="mc-drawer-rail">
        <button
          type="button"
          className="mc-drawer-rail-btn"
          aria-label={`Open ${ariaLabel.toLowerCase()}`}
          onClick={() => setOpen(true)}
        >
          <ChevronLeft />
        </button>
      </div>
    );
  }

  return (
    <aside
      className={`mc-drawer mc-drawer--right${className ? ` ${className}` : ""}`}
      aria-label={ariaLabel}
    >
      <div className="mc-drawer-head">
        <span />
        <button
          type="button"
          className="mc-drawer-close"
          aria-label={`Close ${ariaLabel.toLowerCase()}`}
          onClick={() => setOpen(false)}
        >
          <Close />
        </button>
      </div>
      {children}
    </aside>
  );
}

export type BlockCardProps = {
  title: string;
  children: ReactNode;
  /** Optional controls rendered at the right of the card header. */
  actions?: ReactNode;
  className?: string;
};

/** A bordered Moodle block card with a title row. */
export function BlockCard({
  title,
  children,
  actions,
  className,
}: BlockCardProps) {
  return (
    <section className={`mc-card${className ? ` ${className}` : ""}`}>
      <div className="mc-card-header">
        <h2 className="mc-card-title">{title}</h2>
        {actions}
      </div>
      <div className="mc-card-body">{children}</div>
    </section>
  );
}

export type EventRowProps = {
  kind: ActivityKind;
  /** Blue activity link text. */
  title: string;
  /** Gray date line, e.g. "Monday, 21 September, 08:15 » 10:00". */
  date: string;
  /**
   * The `/mod/…` or `/calendar/event/…` page the row opens. Required: every
   * event in the data layer resolves to one, and a row that silently fell
   * back to "#" would be a dead task link.
   */
  href: string;
};

/** One "Upcoming events" row: yellow activity circle + blue link + date. */
export function EventRow({ kind, title, date, href }: EventRowProps) {
  return (
    <div className="mc-event">
      <span className="mc-activity-icon mc-activity-icon--sm">
        <ActivityIcon kind={kind} size={16} />
      </span>
      <div className="mc-event-body">
        <SafeLink className="mc-event-link" href={href}>
          {title}
        </SafeLink>
        <div className="mc-event-date">{date}</div>
      </div>
    </div>
  );
}
