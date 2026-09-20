"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, ChevronUp } from "@/components/Icons";

export type DropdownItem = {
  label: string;
  /** Internal route or "#". Omit when the item only opens a submenu. */
  href?: string;
  onSelect?: () => void;
  /** Render as a real external anchor with target="_blank". */
  external?: boolean;
  /** Current choice in a set of options — draws a trailing check. */
  active?: boolean;
  /** Nested items render as an inline, expandable submenu. */
  items?: DropdownItem[];
  /** `data-trace` anchor for the study flow (`@/data/taskFlow`). */
  traceId?: string;
};

export type DropdownProps = {
  /** Toggle content. A plain string gets the usual chevron treatment. */
  label: ReactNode;
  items: DropdownItem[];
  /** 'nav' = navbar link with the underline slot, 'pill' = rounded filter pill. */
  variant?: "nav" | "pill";
  align?: "left" | "right";
  className?: string;
  /** Extra classes on the floating menu (e.g. a wider min-width). */
  menuClassName?: string;
  /** Accessible name when `label` is not plain text. */
  ariaLabel?: string;
  /** Hide the trailing chevron (used by the avatar toggle, which draws its own). */
  hideChevron?: boolean;
  /** `data-trace` anchor on the toggle, for the study flow. */
  traceId?: string;
};

/**
 * Click-to-open dropdown used by the navbar, the user menu and the page
 * filter pills. Closes on outside click and on Escape.
 */
export default function Dropdown({
  label,
  items,
  variant = "nav",
  align = "left",
  className,
  menuClassName,
  ariaLabel,
  hideChevron = false,
  traceId,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const close = useCallback(() => {
    setOpen(false);
    setExpanded(null);
  }, []);

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

  const toggleClass =
    variant === "pill"
      ? `mc-pill-toggle${className ? ` ${className}` : ""}`
      : `mc-nav-link${className ? ` ${className}` : ""}`;

  return (
    <div className="mc-dropdown" ref={rootRef}>
      <button
        type="button"
        className={toggleClass}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        data-trace={traceId}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {label}
        {hideChevron ? null : <ChevronDown />}
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          className={`mc-menu${align === "right" ? " is-right" : ""}${
            menuClassName ? ` ${menuClassName}` : ""
          }`}
        >
          {items.map((item, index) => (
            <DropdownRow
              key={`${item.label}-${index}`}
              item={item}
              expanded={expanded === `${item.label}-${index}`}
              onExpand={() =>
                setExpanded((current) =>
                  current === `${item.label}-${index}`
                    ? null
                    : `${item.label}-${index}`,
                )
              }
              onClose={close}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DropdownRow({
  item,
  expanded,
  onExpand,
  onClose,
}: {
  item: DropdownItem;
  expanded: boolean;
  onExpand: () => void;
  onClose: () => void;
}) {
  if (item.items && item.items.length > 0) {
    return (
      <>
        <button
          type="button"
          role="menuitem"
          className="mc-menu-item"
          aria-expanded={expanded}
          onClick={onExpand}
        >
          <span>{item.label}</span>
          {expanded ? <ChevronUp /> : <ChevronRight />}
        </button>
        {expanded ? (
          <div className="mc-submenu">
            {item.items.map((child, index) => (
              <DropdownLeaf
                key={`${child.label}-${index}`}
                item={child}
                onClose={onClose}
              />
            ))}
          </div>
        ) : null}
      </>
    );
  }

  return <DropdownLeaf item={item} onClose={onClose} />;
}

function DropdownLeaf({
  item,
  onClose,
}: {
  item: DropdownItem;
  onClose: () => void;
}) {
  const handleClick = () => {
    item.onSelect?.();
    onClose();
  };

  /** Label plus, for the active option, the trailing check. */
  const content = (
    <>
      <span>{item.label}</span>
      {item.active ? <Check /> : null}
    </>
  );
  const current = item.active ? true : undefined;

  if (!item.href) {
    return (
      <button
        type="button"
        role="menuitem"
        className="mc-menu-item"
        aria-current={current}
        data-trace={item.traceId}
        onClick={handleClick}
      >
        {content}
      </button>
    );
  }

  if (item.external || item.href.startsWith("http")) {
    return (
      <a
        role="menuitem"
        className="mc-menu-item"
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        aria-current={current}
        data-trace={item.traceId}
        onClick={handleClick}
      >
        {content}
      </a>
    );
  }

  if (item.href === "#") {
    return (
      <a
        role="menuitem"
        className="mc-menu-item"
        href="#"
        aria-current={current}
        data-trace={item.traceId}
        onClick={(event) => {
          event.preventDefault();
          handleClick();
        }}
      >
        {content}
      </a>
    );
  }

  return (
    <Link
      role="menuitem"
      className="mc-menu-item"
      href={item.href}
      aria-current={current}
      data-trace={item.traceId}
      onClick={handleClick}
    >
      {content}
    </Link>
  );
}
