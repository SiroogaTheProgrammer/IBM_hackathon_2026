/**
 * Static content for `/my` (the Moodle Dashboard).
 *
 * The layout follows the live Aalto MyCourses dashboard as it was captured on
 * Friday, 18 September 2026; the courses and deadlines are invented. There is
 * no backend: the Timeline filters operate on these constants alone.
 */

import type { ActivityKind } from "@/components/Icons";
import { targetHref } from "@/data/activities";

/** The day the dashboard is frozen on. Every `offsetDays` counts from here. */
export const TODAY_LABEL = "Friday, 18 September 2026";

/* ------------------------------------------------------------- timeline --- */

export type TimelineRange = {
  label: string;
  /** How many days ahead the filter keeps. */
  days: number;
};

/** The "Next 7 days ⌄" pill — Moodle's stock range list. */
export const timelineRanges: TimelineRange[] = [
  { label: "Next 7 days", days: 7 },
  { label: "Next 30 days", days: 30 },
  { label: "Next 3 months", days: 92 },
  { label: "Next 6 months", days: 183 },
  { label: "All", days: Number.POSITIVE_INFINITY },
];

/** The "Sort by dates ⌄" pill. */
export const timelineSorts = ["Sort by dates", "Sort by courses"] as const;

export type TimelineSort = (typeof timelineSorts)[number];

export type TimelineItem = {
  id: string;
  /** Whole days from `TODAY_LABEL`; drives the "Next N days" filter. */
  offsetDays: number;
  /** Group heading used when sorting by dates. */
  dateLabel: string;
  /** Left-hand clock column, e.g. "12:00". */
  time: string;
  kind: ActivityKind;
  title: string;
  /** The activity in `@/data/activities` the bold title and the button open. */
  activityId: string;
  /** Moodle's "what is happening" phrase, e.g. "Assignment is due". */
  actionText: string;
  courseName: string;
  /** Course route, or "#" when the course is outside the cloned route set. */
  courseHref: string;
  /** Right-hand action button; `buttonHref` is `activityId` resolved. */
  buttonLabel: string;
  buttonHref: string;
  overdue?: boolean;
};

export const timelineItems: TimelineItem[] = [
  {
    id: "homework-return-1",
    offsetDays: 0,
    dateLabel: "Friday, 18 September 2026",
    time: "12:00",
    kind: "assignment",
    title: "Homework Return 1",
    activityId: "900151",
    actionText: "Assignment is due",
    courseName:
      "ELEC-E9740 - Principles of Signal Estimation D, Contact teaching, 7.9.2026-26.11.2026",
    courseHref: "/course/40014",
    buttonLabel: "Add submission",
    buttonHref: targetHref("900151"),
    overdue: true,
  },
  {
    id: "extra-exam-interest",
    offsetDays: 3,
    dateLabel: "Monday, 21 September 2026",
    time: "23:59",
    kind: "questionnaire",
    title: "Indicate your interest and availability for the extra exam",
    activityId: "900171",
    actionText: "Questionnaire requires action",
    courseName:
      "CS-E9880 - Deep Representation Learning D, Lecture, 12.1.2026-20.3.2026",
    courseHref: "#",
    buttonLabel: "View",
    buttonHref: targetHref("900171"),
  },
  {
    id: "quiz-3",
    offsetDays: 4,
    dateLabel: "Tuesday, 22 September 2026",
    time: "14:15",
    kind: "quiz",
    title: "Quiz 3",
    activityId: "900133",
    actionText: "Quiz closes",
    courseName:
      "ELEC-E9130 - Adaptive Control and Decision Making D, Contact teaching, 2.9.2026-27.11.2026",
    courseHref: "/course/40013",
    buttonLabel: "Attempt quiz now",
    buttonHref: targetHref("900133"),
  },
];

/* ---------------------------------------------- recently accessed courses --- */

export type RecentCourse = {
  id: string;
  name: string;
  href: string;
};

export const recentCourses: RecentCourse[] = [
  {
    id: "40014",
    name: "ELEC-E9740 - Principles of Signal Estimation D, Contact teaching, 7.9.2026-26.11.2026",
    href: "/course/40014",
  },
  {
    id: "40013",
    name: "ELEC-E9130 - Adaptive Control and Decision Making D, Contact teaching, 2.9.2026-27.11.2026",
    href: "/course/40013",
  },
  {
    id: "40012",
    name: "CS-E9620 - Visual Computing Systems D, Contact teaching, 3.9.2026-11.12.2026",
    href: "/course/40012",
  },
];

/* -------------------------------------------------------- upcoming events --- */

export type UpcomingEvent = {
  id: string;
  kind: ActivityKind;
  title: string;
  /** Gray line below the link, exactly as the live site prints it. */
  date: string;
  /**
   * What the row opens: either an activity id (numeric, `@/data/activities`)
   * or a calendar session event slug (`ev-…`, `@/data/events`).
   */
  targetId: string;
  /** `targetId` already resolved to a route, so the view stays dumb. */
  href: string;
};

export const upcomingEvents: UpcomingEvent[] = [
  {
    id: "e1",
    kind: "group",
    title: "L01",
    date: "Monday, 21 September, 08:15 » 10:00",
    targetId: "ev-cv-0921",
    href: targetHref("ev-cv-0921"),
  },
  {
    id: "e2",
    kind: "questionnaire",
    title: "Indicate your interest and …",
    date: "Monday, 21 September, 23:59",
    targetId: "900171",
    href: targetHref("900171"),
  },
  {
    id: "e3",
    kind: "group",
    title: "L01",
    date: "Tuesday, 22 September, 12:15 » 14:00",
    targetId: "ev-sf-0922",
    href: targetHref("ev-sf-0922"),
  },
  {
    id: "e4",
    kind: "group",
    title: "L01",
    date: "Tuesday, 22 September, 14:15 » 16:00",
    targetId: "ev-rl-0922",
    href: targetHref("ev-rl-0922"),
  },
  {
    id: "e5",
    kind: "quiz",
    title: "Quiz 3 closes",
    date: "Tuesday, 22 September, 14:15",
    targetId: "900133",
    href: targetHref("900133"),
  },
  {
    id: "e6",
    kind: "quiz",
    title: "Quiz 4 opens",
    date: "Tuesday, 22 September, 16:00",
    targetId: "900134",
    href: targetHref("900134"),
  },
  {
    id: "e7",
    kind: "group",
    title: "L01",
    date: "Tuesday, 22 September, 16:15 » 18:00",
    targetId: "ev-dm-0922",
    href: targetHref("ev-dm-0922"),
  },
  {
    id: "e8",
    kind: "assignment",
    title: "Homework Return 2 is due",
    date: "Friday, 25 September, 12:00",
    targetId: "900152",
    href: targetHref("900152"),
  },
];
