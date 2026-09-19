/**
 * The activity registry — every `/mod/<type>/<id>` page in the clone.
 *
 * Moodle gives each assignment, quiz, questionnaire and forum a numeric module
 * id and a page of its own; the course index, the section bands, the dashboard
 * timeline and the notification popover all point at those pages. This module
 * is the single source of truth for them: ids, names, the course and section a
 * breadcrumb has to show, and the Moodle-formatted date lines.
 *
 * Activity *bodies* are generic (the pages are built from the type alone), so
 * nothing below describes a real task. The courses, names and ids are all
 * invented — see the note at the top of `@/data/courses`.
 *
 * There is no backend: `TODAY` for the "time remaining" strings is frozen at
 * Friday, 18 September 2026, 11:23 PM — the moment the live site was captured,
 * and the moment "Homework Return 1" was 11 hours 23 mins overdue.
 */

import type { ActivityKind } from "@/components/Icons";
import { eventHref, getEvent } from "@/data/events";

/* --------------------------------------------------------- course names --- */

const PATTERN_DISCOVERY =
  "CS-E9410 - Foundations of Pattern Discovery D, Contact teaching, 1.9.2026-8.12.2026";
const VISUAL_COMPUTING =
  "CS-E9620 - Visual Computing Systems D, Contact teaching, 3.9.2026-11.12.2026";
const ADAPTIVE_CONTROL =
  "ELEC-E9130 - Adaptive Control and Decision Making D, Contact teaching, 2.9.2026-27.11.2026";
const SIGNAL_ESTIMATION =
  "ELEC-E9740 - Principles of Signal Estimation D, Contact teaching, 7.9.2026-26.11.2026";
/** Not one of the four cloned courses — its activity renders without a drawer. */
const DEEP_REPRESENTATION =
  "CS-E9880 - Deep Representation Learning D, Lecture, 12.1.2026-20.3.2026";

/* ----------------------------------------------------------- activities --- */

/** Moodle's module name, which is also the first `/mod/…` path segment. */
export type ActivityType = "assign" | "quiz" | "feedback" | "forum";

/** One line of the gray dates box. The renderer prints "<label>: <value>". */
export type ActivityDate = {
  label: string;
  value: string;
};

export type Activity = {
  id: string;
  type: ActivityType;
  name: string;
  /** `null` when the course is outside the cloned route set. */
  courseId: string | null;
  /** Full course name for the banner plate and the breadcrumb. */
  courseTitle: string;
  /** Anchor of the parent section, or `null` when the course is not cloned. */
  sectionId: string | null;
  /** Middle breadcrumb segment, e.g. "Homework submission". */
  sectionName: string;
  dates: ActivityDate[];
  /** Assignments only: the deadline has passed, print the row in red. */
  overdue?: boolean;
  /** Assignments only: the whole "Time remaining" cell, ready to render. */
  timeRemaining?: string;
};

/** The yellow activity circle each module type draws. */
export const activityKinds: Record<ActivityType, ActivityKind> = {
  assign: "assignment",
  quiz: "quiz",
  feedback: "questionnaire",
  forum: "forum",
};

/**
 * Quiz open/close windows, in course order. Every quiz opens at 4:00 PM on the
 * lecture day and closes at 2:15 PM, right before the next lecture.
 */
const quizWindows: [opened: string, closes: string][] = [
  ["Wednesday, 2 September 2026, 4:00 PM", "Tuesday, 8 September 2026, 2:15 PM"],
  ["Tuesday, 8 September 2026, 4:00 PM", "Tuesday, 15 September 2026, 2:15 PM"],
  ["Tuesday, 15 September 2026, 4:00 PM", "Tuesday, 22 September 2026, 2:15 PM"],
  ["Tuesday, 22 September 2026, 4:00 PM", "Tuesday, 29 September 2026, 2:15 PM"],
  ["Tuesday, 29 September 2026, 4:00 PM", "Tuesday, 6 October 2026, 2:15 PM"],
  ["Tuesday, 6 October 2026, 4:00 PM", "Tuesday, 20 October 2026, 2:15 PM"],
  ["Tuesday, 20 October 2026, 4:00 PM", "Tuesday, 3 November 2026, 2:15 PM"],
  ["Tuesday, 3 November 2026, 4:00 PM", "Tuesday, 17 November 2026, 2:15 PM"],
];

/** Quiz 1 … Quiz 8 of ELEC-E9130, module ids 900131 … 900138. */
const quizzes: Activity[] = quizWindows.map(([opened, closes], index) => ({
  id: String(900131 + index),
  type: "quiz",
  name: `Quiz ${index + 1}`,
  courseId: "40013",
  courseTitle: ADAPTIVE_CONTROL,
  sectionId: "assignments-and-quizzes",
  sectionName: "Assignments & Quizzes",
  dates: [
    { label: "Opened", value: opened },
    { label: "Closes", value: closes },
  ],
}));

export const activities: Activity[] = [
  /* 40011 — CS-E9410 Foundations of Pattern Discovery */
  {
    id: "900101",
    type: "forum",
    name: "Announcements",
    courseId: "40011",
    courseTitle: PATTERN_DISCOVERY,
    sectionId: "general",
    sectionName: "General",
    dates: [],
  },
  {
    id: "900102",
    type: "assign",
    name: "Homework 1 – DL 28.9.",
    courseId: "40011",
    courseTitle: PATTERN_DISCOVERY,
    sectionId: "homework-submission",
    sectionName: "Homework submission",
    dates: [{ label: "Due", value: "Monday, 28 September 2026, 11:59 PM" }],
    timeRemaining: "10 days 36 mins remaining",
  },

  /* 40012 — CS-E9620 Visual Computing Systems */
  {
    id: "900111",
    type: "forum",
    name: "Announcements",
    courseId: "40012",
    courseTitle: VISUAL_COMPUTING,
    sectionId: "general",
    sectionName: "General",
    dates: [],
  },

  /* 40013 — ELEC-E9130 Adaptive Control and Decision Making */
  {
    id: "900121",
    type: "forum",
    name: "Announcements",
    courseId: "40013",
    courseTitle: ADAPTIVE_CONTROL,
    sectionId: "general",
    sectionName: "General",
    dates: [],
  },
  ...quizzes,

  /* 40014 — ELEC-E9740 Principles of Signal Estimation */
  {
    id: "900141",
    type: "forum",
    name: "Announcements",
    courseId: "40014",
    courseTitle: SIGNAL_ESTIMATION,
    sectionId: "general",
    sectionName: "General",
    dates: [],
  },
  {
    id: "900151",
    type: "assign",
    name: "Homework Return 1",
    courseId: "40014",
    courseTitle: SIGNAL_ESTIMATION,
    sectionId: "schedule",
    sectionName: "Schedule",
    dates: [{ label: "Due", value: "Friday, 18 September 2026, 12:00 PM" }],
    overdue: true,
    timeRemaining: "Assignment is overdue by: 11 hours 23 mins",
  },
  {
    id: "900152",
    type: "assign",
    name: "Homework Return 2",
    courseId: "40014",
    courseTitle: SIGNAL_ESTIMATION,
    sectionId: "schedule",
    sectionName: "Schedule",
    dates: [{ label: "Due", value: "Friday, 25 September 2026, 12:00 PM" }],
    timeRemaining: "6 days 12 hours remaining",
  },
  {
    id: "900153",
    type: "assign",
    name: "Homework Return 3",
    courseId: "40014",
    courseTitle: SIGNAL_ESTIMATION,
    sectionId: "schedule",
    sectionName: "Schedule",
    dates: [{ label: "Due", value: "Friday, 2 October 2026, 12:00 PM" }],
    timeRemaining: "13 days 12 hours remaining",
  },
  {
    id: "900154",
    type: "assign",
    name: "Homework Return 4",
    courseId: "40014",
    courseTitle: SIGNAL_ESTIMATION,
    sectionId: "schedule",
    sectionName: "Schedule",
    dates: [{ label: "Due", value: "Friday, 9 October 2026, 12:00 PM" }],
    timeRemaining: "20 days 12 hours remaining",
  },
  {
    id: "900161",
    type: "assign",
    name: "Project work part 1",
    courseId: "40014",
    courseTitle: SIGNAL_ESTIMATION,
    sectionId: "project-work",
    sectionName: "Project work",
    dates: [{ label: "Due", value: "Friday, 30 October 2026, 12:00 PM" }],
    timeRemaining: "41 days 12 hours remaining",
  },
  {
    id: "900162",
    type: "assign",
    name: "Project work part 2",
    courseId: "40014",
    courseTitle: SIGNAL_ESTIMATION,
    sectionId: "project-work",
    sectionName: "Project work",
    dates: [{ label: "Due", value: "Friday, 20 November 2026, 12:00 PM" }],
    timeRemaining: "62 days 12 hours remaining",
  },

  /* CS-E9880 Deep Representation Learning — not cloned, so no course drawer */
  {
    id: "900171",
    type: "feedback",
    name: "Indicate your interest and availability for the extra exam",
    courseId: null,
    courseTitle: DEEP_REPRESENTATION,
    sectionId: null,
    sectionName: "Extra exam",
    dates: [
      { label: "Opened", value: "Monday, 14 September 2026, 9:00 AM" },
      { label: "Closes", value: "Monday, 21 September 2026, 11:59 PM" },
    ],
  },
];

/* -------------------------------------------------------------- lookups --- */

/** Every activity id, in registry order. */
export const activityIds: string[] = activities.map((activity) => activity.id);

/** `generateStaticParams` for the `/mod/[type]/[id]` route. */
export const activityParams: { type: ActivityType; id: string }[] =
  activities.map((activity) => ({ type: activity.type, id: activity.id }));

export function getActivity(id: string): Activity | undefined {
  return activities.find((activity) => activity.id === id);
}

/** The route of an activity page. */
export function activityHref(activity: Activity): string {
  return `/mod/${activity.type}/${activity.id}`;
}

export function activitiesForCourse(courseId: string): Activity[] {
  return activities.filter((activity) => activity.courseId === courseId);
}

/**
 * Resolves the `targetId` carried by a timeline row or an "Upcoming events"
 * row, which may name either an activity (numeric Moodle module id) or a
 * calendar session event (`ev-…` slug).
 *
 * Unknown ids fall back to "#" — `SafeLink` renders that as a clickable but
 * inert anchor — but every id shipped in `@/data/courses` and
 * `@/data/dashboard` resolves, so the fallback is a safety net only.
 */
export function targetHref(targetId: string): string {
  const activity = getActivity(targetId);
  if (activity) return activityHref(activity);

  const event = getEvent(targetId);
  if (event) return eventHref(event);

  return "#";
}
