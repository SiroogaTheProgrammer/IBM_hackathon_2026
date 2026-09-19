"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Close,
  Home,
  Kebab,
} from "@/components/Icons";
import { COURSE_DRAWER_EVENT } from "@/components/Navbar";
import SafeLink from "@/components/SafeLink";
import type { CourseIndexEntry } from "@/data/courses";

/** Sticky-navbar allowance when deciding which section is "current". */
const SCROLL_OFFSET = 70;


export type CourseIndexDrawerProps = {
  courseId: string;
  sections: CourseIndexEntry[];
  /**
   * Set by an activity page: that child row takes the dark highlight and the
   * section rows stop competing for it. Omitted on the main course page.
   */
  activeActivityId?: string;
};

/**
 * The 285px left-hand course index. Sections scroll their card into view and
 * take the dark highlight; a scroll listener keeps the highlight on whichever
 * section is currently at the top of the viewport. On an activity page there
 * are no section cards to scroll past, so the highlight sits on the activity
 * instead and the section rows link back to the course page's anchors.
 *
 * The navbar hamburger toggles this drawer through a window CustomEvent, so
 * the two client components stay independent.
 */
export default function CourseIndexDrawer({
  courseId,
  sections,
  activeActivityId,
}: CourseIndexDrawerProps) {
  /** On an activity page the index is a navigation list, not a scroll spy. */
  const onActivityPage = Boolean(activeActivityId);
  const [open, setOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [current, setCurrent] = useState(
    onActivityPage ? "" : sections[0]?.id ?? "",
  );
  /**
   * Section pinned by a click. A section near the end of the page cannot
   * reach the top of the viewport, so the scroll listener would otherwise
   * snap the highlight straight back off the section the user just picked.
   * The pin is released as soon as the user scrolls by their own hand.
   */
  const pinned = useRef<string | null>(null);

  useEffect(() => {
    const toggle = () => setOpen((wasOpen) => !wasOpen);
    window.addEventListener(COURSE_DRAWER_EVENT, toggle);
    return () => window.removeEventListener(COURSE_DRAWER_EVENT, toggle);
  }, []);

  useEffect(() => {
    if (onActivityPage) return;

    const ids = sections.map((section) => section.id);

    const update = () => {
      if (pinned.current) return;

      let active = ids[0] ?? "";
      for (const id of ids) {
        const element = document.getElementById(id);
        if (!element) continue;
        if (element.getBoundingClientRect().top <= SCROLL_OFFSET) active = id;
      }
      setCurrent(active);
    };

    // Wheel / touch / keys / scrollbar drags are the user taking over.
    const release = () => {
      if (!pinned.current) return;
      pinned.current = null;
      update();
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchmove", release, { passive: true });
    window.addEventListener("keydown", release);
    window.addEventListener("mousedown", release);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchmove", release);
      window.removeEventListener("keydown", release);
      window.removeEventListener("mousedown", release);
    };
  }, [onActivityPage, sections]);

  /**
   * The anchor href does the scrolling (native, and `scroll-margin-top` on
   * each section keeps it clear of the sticky navbar); this only moves the
   * highlight and pins it to the section the user picked.
   */
  const selectSection = useCallback((id: string) => {
    pinned.current = id;
    setCurrent(id);
  }, []);

  const toggleSection = useCallback((id: string) => {
    setCollapsed((ids) =>
      ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id],
    );
  }, []);

  if (!open) {
    return (
      <div className="mc-drawer-rail">
        <button
          type="button"
          className="mc-drawer-rail-btn"
          aria-label="Open course index"
          onClick={() => setOpen(true)}
        >
          <ChevronRight />
        </button>
      </div>
    );
  }

  return (
    <aside
      className="mc-drawer mc-drawer--left sticky top-[51px] max-h-[calc(100vh-51px)] overflow-y-auto"
      aria-label="Course index"
    >
      <div className="mc-drawer-head">
        <button
          type="button"
          className="mc-drawer-close"
          aria-label="Close course index"
          onClick={() => setOpen(false)}
        >
          <Close />
        </button>
        <button
          type="button"
          className="mc-kebab"
          aria-label="Course index options"
        >
          <Kebab />
        </button>
      </div>

      <Link href={`/course/${courseId}`} className="mc-index-link">
        <Home size={16} />
        <span>Main course page</span>
      </Link>

      <ul className="mt-1">
        {sections.map((section) => {
          const isCollapsed = collapsed.includes(section.id);
          const hasChildren = section.children.length > 0;

          return (
            <li key={section.id}>
              <div
                className={`mc-index-link${
                  current === section.id ? " is-current" : ""
                }`}
              >
                {/*
                 * The live course index shows a chevron on EVERY section,
                 * including ones with no activities yet — so the toggle is
                 * always rendered.
                 */}
                <button
                  type="button"
                  className="inline-flex shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 text-inherit"
                  aria-expanded={!isCollapsed}
                  aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${
                    section.name
                  }`}
                  onClick={() => toggleSection(section.id)}
                >
                  {isCollapsed ? (
                    <ChevronRight size={16} />
                  ) : (
                    <ChevronDown size={16} />
                  )}
                </button>

                {/*
                 * On the course page the section is on screen, so a plain
                 * in-page anchor scrolls to it; from an activity page it has
                 * to be the course route plus that anchor.
                 */}
                {onActivityPage ? (
                  <SafeLink
                    href={`/course/${courseId}#${section.id}`}
                    className="min-w-0 flex-1 font-medium text-inherit no-underline"
                  >
                    {section.name}
                  </SafeLink>
                ) : (
                  <a
                    href={`#${section.id}`}
                    className="min-w-0 flex-1 font-medium text-inherit no-underline"
                    onClick={() => selectSection(section.id)}
                  >
                    {section.name}
                  </a>
                )}
              </div>

              {hasChildren && !isCollapsed ? (
                <ul>
                  {section.children.map((child) => (
                    <li key={child.activityId}>
                      <SafeLink
                        href={child.href}
                        className={`mc-index-link mc-index-child${
                          child.activityId === activeActivityId
                            ? " is-current"
                            : ""
                        }`}
                      >
                        {child.name}
                      </SafeLink>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
