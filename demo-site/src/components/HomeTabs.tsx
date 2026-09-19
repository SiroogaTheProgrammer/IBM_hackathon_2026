"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type HomeTab = {
  id: string;
  label: string;
  /**
   * Rendered on the server and handed over as an RSC payload, so the panel
   * markup never enters the client bundle — only the tab switching does.
   */
  panel: ReactNode;
};

export type HomeTabsProps = {
  tabs: HomeTab[];
  ariaLabel: string;
  /** Extra classes for the tab strip — it spans the full viewport width. */
  tabsClassName?: string;
  /** Extra classes for the panel — the content column is narrower. */
  panelClassName?: string;
};

/**
 * The front page's secondary tab strip (Home | Course feedback). The live site
 * swaps the content region in place and keeps the banner and heading fixed,
 * so only this strip and the active panel are client-side.
 */
export default function HomeTabs({
  tabs,
  ariaLabel,
  tabsClassName = "",
  panelClassName = "",
}: HomeTabsProps) {
  const [activeId, setActiveId] = useState<string>(() => tabs[0]?.id ?? "");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();

    const current = tabs.findIndex((tab) => tab.id === activeId);
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const next = (current + offset + tabs.length) % tabs.length;
    const nextTab = tabs[next];
    if (!nextTab) return;

    setActiveId(nextTab.id);
    tabRefs.current[next]?.focus();
  };

  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  return (
    <>
      <div
        className={`mc-tabs ${tabsClassName}`.trim()}
        role="tablist"
        aria-label={ariaLabel}
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={tab.id === activeId}
            aria-controls={`panel-${tab.id}`}
            tabIndex={tab.id === activeId ? 0 : -1}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            className={`mc-tab${tab.id === activeId ? " is-active" : ""}`}
            onClick={() => setActiveId(tab.id)}
            onKeyDown={handleKeyDown}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {active ? (
        <div
          id={`panel-${active.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${active.id}`}
          className={panelClassName}
        >
          {active.panel}
        </div>
      ) : null}
    </>
  );
}
