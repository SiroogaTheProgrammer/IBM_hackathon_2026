"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Bell, Close } from "@/components/Icons";
import SafeLink from "@/components/SafeLink";
import { allNotificationsHref, notifications } from "@/data/notifications";

/**
 * The navbar bell and the notification popover it opens: a header with
 * "Mark all as read" / preferences / close, the scrollable deadline alerts,
 * and a centred "See all" footer.
 *
 * Opens and closes on click, and closes on outside click or Escape — the
 * same contract as `Dropdown`, which this cannot reuse because the panel is
 * a dialog of stacked rows rather than a list of menu items.
 */
export default function NotificationPanel() {
  const [open, setOpen] = useState(false);
  /** Ids cleared by "Mark all as read"; the badge counts what is left. */
  const [readIds, setReadIds] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  const unreadCount = notifications.filter(
    (item) => item.unread && !readIds.includes(item.id),
  ).length;

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) {
        close();
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  /**
   * Following a notification navigates client-side, which leaves the panel
   * mounted and open over the new page — so any anchor click dismisses it.
   */
  const closeOnLinkClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target instanceof Element && event.target.closest("a")) close();
    },
    [close],
  );

  return (
    <div className="mc-dropdown mc-dropdown--stretch" ref={rootRef}>
      <button
        type="button"
        className="mc-icon-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={
          unreadCount > 0
            ? `Show notifications (${unreadCount} unread)`
            : "Show notifications"
        }
        onClick={() => setOpen((value) => !value)}
      >
        <Bell />
        {unreadCount > 0 ? (
          <span className="mc-count-badge">{unreadCount}</span>
        ) : null}
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Notifications"
          className="mc-menu is-right mc-notif-panel"
          onClick={closeOnLinkClick}
        >
          <div className="mc-notif-head">
            <span className="mc-notif-head-title">Notifications</span>
            <div className="mc-notif-head-actions">
              <button
                type="button"
                className="mc-icon-btn"
                aria-label="Mark all as read"
                title="Mark all as read"
                onClick={() =>
                  setReadIds(notifications.map((item) => item.id))
                }
              >
                <CheckGlyph />
              </button>
              <button
                type="button"
                className="mc-icon-btn"
                aria-label="Notification preferences"
                title="Notification preferences"
              >
                <GearGlyph />
              </button>
              <button
                type="button"
                className="mc-icon-btn"
                aria-label="Close notifications"
                title="Close"
                onClick={close}
              >
                <Close size={16} />
              </button>
            </div>
          </div>

          <div className="mc-notif-list">
            {notifications.map((item) => {
              const unread = item.unread && !readIds.includes(item.id);

              return (
                <div
                  key={item.id}
                  className={`mc-notif-item${unread ? " is-unread" : ""}`}
                >
                  <div className="mc-notif-item-title">{item.title}</div>
                  <div className="mc-notif-item-meta">
                    <span className="mc-small mc-muted">{item.time}</span>
                    <SafeLink className="mc-link mc-small" href={item.href}>
                      View full notification
                    </SafeLink>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mc-notif-foot">
            <SafeLink className="mc-link" href={allNotificationsHref}>
              See all
            </SafeLink>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- glyphs --- */

/** "Mark all as read" tick. Local, like the navbar's own hamburger. */
function CheckGlyph() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

/** "Notification preferences" cog. */
function GearGlyph() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 14.6a1.5 1.5 0 0 0 .3 1.7l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-2.5 1v.3a1.8 1.8 0 1 1-3.6 0v-.2a1.5 1.5 0 0 0-2.6-1l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0-1-2.5h-.3a1.8 1.8 0 1 1 0-3.6h.2a1.5 1.5 0 0 0 1-2.6l-.1-.1a1.8 1.8 0 1 1 2.6-2.6l.1.1a1.5 1.5 0 0 0 1.7.3h.1a1.5 1.5 0 0 0 .9-1.4v-.3a1.8 1.8 0 1 1 3.6 0v.2a1.5 1.5 0 0 0 2.5 1l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0 1 2.5h.3a1.8 1.8 0 1 1 0 3.6h-.2a1.5 1.5 0 0 0-1.4.9Z" />
    </svg>
  );
}
