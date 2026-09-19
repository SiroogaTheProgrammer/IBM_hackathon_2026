/**
 * Static content for `/user/profile` — the MyCourses "user tab".
 *
 * The page follows the live profile layout; the course history below it is
 * invented. There is no backend, so links that fall outside the cloned route
 * set point at "#" rather than navigating a study participant off the site.
 */

import { routes } from "@/data/site";
import type { SiteUser } from "@/data/users";

export type ProfileLink = {
  /** Stable key — the course-profile list contains two identical labels. */
  id: string;
  label: string;
  href: string;
};

export type ProfileDetail = {
  label: string;
  /** Rendered as a blue link when `href` is set, otherwise as plain text. */
  value: string;
  href?: string;
  /** Trailing plain-text note, e.g. "(Visible to other course participants)". */
  note?: string;
};

/* ------------------------------------------------------------ left column */

/**
 * The "User details" card. Two of its three rows name the signed-in user, so
 * this is a function of whoever the avatar menu last switched to rather than
 * a constant.
 */
export function getUserDetails(user: SiteUser): ProfileDetail[] {
  return [
    {
      label: "Email address",
      value: user.email,
      // "#", not a mailto: — a click must not pull a participant out of the study.
      href: "#",
      note: "(Visible to other course participants)",
    },
    { label: "Timezone", value: user.timezone },
    { label: "User account contains (use: aalto.fi)", value: "aalto.fi" },
  ];
}

export const badgesIntro = "Badges from MyCourses:";

export const badges: ProfileLink[] = [
  {
    id: "mycourses-orientation",
    label: "MyCourses Orientation",
    href: "#",
  },
];

export const privacyLinks: ProfileLink[] = [
  { id: "privacy-officer", label: "Contact the privacy officer", href: "#" },
  { id: "data-requests", label: "Data requests", href: "#" },
  { id: "export-data", label: "Export all of my personal data", href: "#" },
  { id: "policies", label: "Policies and agreements", href: "#" },
];

/* ----------------------------------------------------------- right column */

export const courseProfilesHeading = "Course profiles";

export const courseProfiles: ProfileLink[] = [
  {
    id: "cs-a9120",
    label: "CS-A9120 - Programming Foundations 2, Lecture, 26.2.2024-31.5.2024",
    href: "#",
  },
  {
    id: "cs-a9140",
    label:
      "CS-A9140 - Algorithmic Problem Solving, Lecture, 4.9.2023-4.12.2023",
    href: "#",
  },
  {
    id: "cs-a9155",
    label: "CS-A9155 - Data Stores for Analytics, Lecture, 9.4.2024-11.6.2024",
    href: "#",
  },
  {
    id: "cs-c9160",
    label: "CS-C9160 - Models of Computation, Lecture, 9.1.2024-19.4.2024",
    href: "#",
  },
  {
    id: "cs-e9903",
    label:
      "CS-E9903 - Special Assignment in Computer Science D, Lectures, 1.1.2026-31.7.2026",
    href: "#",
  },
  {
    id: "cs-e9580",
    label:
      "CS-E9580 - Programming Manycore Processors D, Lecture, 20.4.2026-29.5.2026",
    href: "#",
  },
  {
    id: "cs-e9410",
    label:
      "CS-E9410 - Foundations of Pattern Discovery D, Contact teaching, 1.9.2026-8.12.2026",
    // The only entry in this list that is also a cloned course page.
    href: routes.course(40011),
  },
  {
    id: "cs-e9675-spring",
    label:
      "CS-E9675 - Modern Web Application Development D, Project, 1.1.2024-31.7.2024",
    href: "#",
  },
  {
    id: "cs-e9675-autumn",
    label:
      "CS-E9675 - Modern Web Application Development D, Project, 1.8.2023-31.12.2023",
    href: "#",
  },
  {
    id: "cs-e9715",
    label:
      "CS-E9715 - Statistical Learning Methods D, Lecture, 2.9.2025-9.12.2025",
    href: "#",
  },
];

export const miscellaneousLinks: ProfileLink[] = [
  { id: "forum-posts", label: "Forum posts", href: "#" },
  { id: "forum-discussions", label: "Forum discussions", href: "#" },
];

export const reportLinks: ProfileLink[] = [
  { id: "browser-sessions", label: "Browser sessions", href: "#" },
  { id: "grades-overview", label: "Grades overview", href: "#" },
];

export const mobileApp = {
  heading: "QR code for mobile app access",
  body:
    "Scan the QR code with your mobile app and you will be automatically logged in. The QR code will expire in 10 mins.",
  buttonLabel: "View QR code",
} as const;

export const lastAccess = {
  heading: "Last access to site",
  value: "Monday, 7 September 2026, 9:42 AM  (12 days 3 hours)",
} as const;
