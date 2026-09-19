"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import Dropdown from "@/components/Dropdown";
import type { DropdownItem } from "@/components/Dropdown";
import { ChevronDown, Message, Moon, Search } from "@/components/Icons";
import NotificationPanel from "@/components/NotificationPanel";
import { getActivity } from "@/data/activities";
import {
  assets,
  intelliboard,
  primaryNav,
  schools,
  serviceLinks,
  userMenu,
} from "@/data/site";
import { USER_COOKIE, USER_COOKIE_MAX_AGE, userIds, users } from "@/data/users";
import type { SiteUser, SiteUserId } from "@/data/users";

/**
 * Custom event the course-index drawer toggle fires. Course and activity
 * pages listen for it on `window` to open/close their left drawer, since the
 * navbar lives in the root layout and cannot reach into the page tree.
 */
export const COURSE_DRAWER_EVENT = "mc:toggle-course-index";

/** Routes that show the "Edit mode" switch at the far right of the navbar. */
const EDIT_MODE_ROUTES = ["/my", "/user/profile"];

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Captures the module id out of a `/mod/<type>/<id>` pathname. */
const ACTIVITY_PATH = /^\/mod\/[^/]+\/([^/]+)/;

/**
 * Whether the page below the navbar owns a course-index drawer for the
 * hamburger to toggle: every course page, plus the activity pages whose
 * course is one of the cloned four. CS-E9880's questionnaire renders
 * drawerless, so it gets no toggle either.
 */
function hasCourseIndex(pathname: string): boolean {
  if (pathname.startsWith("/course/")) return true;

  const match = ACTIVITY_PATH.exec(pathname);
  if (!match) return false;
  return getActivity(match[1])?.courseId != null;
}

/**
 * Write the chosen user to the cookie the server reads. The cookie is the
 * single source of truth for identity, so nothing here touches React state:
 * the refresh that follows re-renders the whole tree as the other person.
 */
function writeUserCookie(id: SiteUserId): void {
  document.cookie = `${USER_COOKIE}=${id}; path=/; max-age=${USER_COOKIE_MAX_AGE}; samesite=lax`;
}

/**
 * Sign out: drop the identity cookie so the server has no one to render as,
 * the way a real MyCourses log-out ends the session. The caller then sends
 * the user to `/login`.
 */
function clearUserCookie(): void {
  document.cookie = `${USER_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

/**
 * The avatar menu: the transcribed MyCourses entries, in their original
 * order, with the study-only "Switch user" submenu slipped in above
 * "Log out" — where Moodle itself keeps "Switch role to…".
 */
function buildUserMenu(
  activeId: SiteUserId,
  onSwitch: (id: SiteUserId) => void,
  onLogOut: () => void,
): DropdownItem[] {
  const switcher: DropdownItem = {
    label: "Switch user",
    items: userIds.map((id) => ({
      label: users[id].fullName,
      active: id === activeId,
      onSelect: () => onSwitch(id),
    })),
  };

  // Moodle's "Log out" is a plain "#" placeholder in the transcription; here it
  // is the one live entry — dropping its href makes the Dropdown render it as a
  // button that runs the sign-out handler.
  const items: DropdownItem[] = userMenu.map((item) =>
    item.label === "Log out" ? { label: "Log out", onSelect: onLogOut } : item,
  );
  const logOut = items.findIndex((item) => item.label === "Log out");
  items.splice(logOut < 0 ? items.length : logOut, 0, switcher);
  return items;
}

export type NavbarProps = {
  /** Signed-in user, resolved from the `mc-user` cookie by the root layout. */
  user: SiteUser;
};

export default function Navbar({ user }: NavbarProps) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const showDrawerToggle = hasCourseIndex(pathname);
  const showEditMode = EDIT_MODE_ROUTES.includes(pathname);

  const userMenuItems = buildUserMenu(
    user.id,
    (id) => {
      writeUserCookie(id);
      router.refresh();
    },
    () => {
      clearUserCookie();
      router.push("/login");
    },
  );

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();

    function onPointerDown(event: MouseEvent) {
      const root = searchRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) {
        setSearchOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSearchOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [searchOpen]);

  return (
    <header className="mc-navbar">
      <div className="mc-navbar-inner">
        <div className="mc-navbar-left">
          {showDrawerToggle ? (
            <button
              type="button"
              className="mc-icon-btn"
              aria-label="Open course index"
              onClick={() =>
                window.dispatchEvent(new CustomEvent(COURSE_DRAWER_EVENT))
              }
            >
              <HamburgerGlyph />
            </button>
          ) : null}

          <Link href="/" className="mc-brand" aria-label="MyCourses home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={assets.logo}
              alt="Aalto University"
              width={42}
              height={40}
            />
          </Link>

          <nav className="mc-nav" aria-label="Site">
            {primaryNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`mc-nav-link${
                  isActive(pathname, item.href, item.exact) ? " is-active" : ""
                }`}
                aria-current={
                  isActive(pathname, item.href, item.exact) ? "page" : undefined
                }
              >
                {item.label}
              </Link>
            ))}

            <Dropdown label="Schools" items={schools} variant="nav" />
            <Dropdown
              label="Service Links"
              items={serviceLinks}
              variant="nav"
              menuClassName="mc-menu-service"
            />
            <Dropdown label="Intelliboard" items={intelliboard} variant="nav" />
          </nav>
        </div>

        <div className="mc-navbar-right">
          <div className="mc-navbar-search" ref={searchRef}>
            {searchOpen ? (
              <input
                ref={searchInputRef}
                type="search"
                className="mc-input"
                placeholder="Search courses"
                aria-label="Search courses"
              />
            ) : null}
            <button
              type="button"
              className="mc-icon-btn"
              aria-label="Toggle search input"
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen((value) => !value)}
            >
              <Search />
            </button>
          </div>

          {/* Owns both the bell and the popover hanging under it. */}
          <NotificationPanel />

          <button type="button" className="mc-icon-btn" aria-label="Messages">
            <Message />
          </button>

          <button
            type="button"
            className="mc-icon-btn"
            aria-label="Toggle dark mode"
          >
            <Moon />
          </button>

          <Dropdown
            variant="nav"
            align="right"
            hideChevron
            ariaLabel="User menu"
            items={userMenuItems}
            label={
              <>
                <Avatar size="sm" user={user} alt="" />
                <ChevronDown />
              </>
            }
          />

          {showEditMode ? (
            <div className="mc-editmode">
              <span id="mc-editmode-label">Edit mode</span>
              <button
                type="button"
                role="switch"
                aria-checked={editMode}
                aria-labelledby="mc-editmode-label"
                className={`mc-switch${editMode ? " is-on" : ""}`}
                onClick={() => setEditMode((value) => !value)}
              >
                <span className="mc-switch-knob" />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function HamburgerGlyph() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}
