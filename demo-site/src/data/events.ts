/**
 * Calendar session events — the `/calendar/event/<id>` pages.
 *
 * Moodle puts a calendar entry behind every lecture (L01), exercise session
 * (H0x) and activity deadline, and the "Upcoming events" drawers link to it.
 * Deadlines that own a real activity page link there instead (see
 * `@/data/activities`); everything left over — the sessions, plus the few
 * deadlines whose activity is not part of the cloned course outline — lives
 * here so no event row is ever a dead link.
 *
 * Ids are hand-written slugs (`ev-<course>-<date>`) rather than Moodle's
 * numeric event ids, so the route set stays readable.
 */

import type { ActivityKind } from "@/components/Icons";

/* --------------------------------------------------------- course names --- */

/**
 * Full course titles, repeated here rather than imported from
 * `@/data/courses`: that module reads this one back through
 * `@/data/activities`, and a cycle would leave the arrays half-initialised.
 */
const PATTERN_DISCOVERY =
  "CS-E9410 - Foundations of Pattern Discovery D, Contact teaching, 1.9.2026-8.12.2026";
const VISUAL_COMPUTING =
  "CS-E9620 - Visual Computing Systems D, Contact teaching, 3.9.2026-11.12.2026";
const ADAPTIVE_CONTROL =
  "ELEC-E9130 - Adaptive Control and Decision Making D, Contact teaching, 2.9.2026-27.11.2026";
const SIGNAL_ESTIMATION =
  "ELEC-E9740 - Principles of Signal Estimation D, Contact teaching, 7.9.2026-26.11.2026";

/* --------------------------------------------------------------- events --- */

export type CalendarEvent = {
  id: string;
  /** Event name, e.g. "L01" — also the `<h2>` of the event page. */
  name: string;
  /** Moodle's full "When" line, `start » end` for sessions. */
  when: string;
  courseId: string;
  courseTitle: string;
  /** One generic line for the event page's description row. */
  description: string;
  /** Which yellow activity circle the drawer rows draw. */
  kind: ActivityKind;
};

const LECTURE = "Lecture session.";
const EXERCISE = "Exercise session.";
const DEADLINE = "Assignment deadline.";

export const calendarEvents: CalendarEvent[] = [
  /* 40011 — CS-E9410, lectures Tuesdays 16:15, exercises Fridays 12:15 */
  {
    id: "ev-dm-0922",
    name: "L01",
    when: "Tuesday, 22 September 2026, 4:15 PM » 6:00 PM",
    courseId: "40011",
    courseTitle: PATTERN_DISCOVERY,
    description: LECTURE,
    kind: "group",
  },
  {
    id: "ev-dm-0929",
    name: "L01",
    when: "Tuesday, 29 September 2026, 4:15 PM » 6:00 PM",
    courseId: "40011",
    courseTitle: PATTERN_DISCOVERY,
    description: LECTURE,
    kind: "group",
  },
  {
    id: "ev-dm-h08",
    name: "H08",
    when: "Friday, 2 October 2026, 12:15 PM » 2:00 PM",
    courseId: "40011",
    courseTitle: PATTERN_DISCOVERY,
    description: EXERCISE,
    kind: "group",
  },
  {
    id: "ev-dm-1006",
    name: "L01",
    when: "Tuesday, 6 October 2026, 4:15 PM » 6:00 PM",
    courseId: "40011",
    courseTitle: PATTERN_DISCOVERY,
    description: LECTURE,
    kind: "group",
  },
  {
    id: "ev-dm-1020",
    name: "L01",
    when: "Tuesday, 20 October 2026, 4:15 PM » 6:00 PM",
    courseId: "40011",
    courseTitle: PATTERN_DISCOVERY,
    description: LECTURE,
    kind: "group",
  },

  /* 40012 — CS-E9620, lectures Mondays 8:15, guidance Tue/Thu 14:15 */
  {
    id: "ev-cv-0921",
    name: "L01",
    when: "Monday, 21 September 2026, 8:15 AM » 10:00 AM",
    courseId: "40012",
    courseTitle: VISUAL_COMPUTING,
    description: LECTURE,
    kind: "group",
  },
  {
    id: "ev-cv-h01-0922",
    name: "H01",
    when: "Tuesday, 22 September 2026, 2:15 PM » 4:00 PM",
    courseId: "40012",
    courseTitle: VISUAL_COMPUTING,
    description: EXERCISE,
    kind: "group",
  },
  {
    id: "ev-cv-h02-0924",
    name: "H02",
    when: "Thursday, 24 September 2026, 2:15 PM » 4:00 PM",
    courseId: "40012",
    courseTitle: VISUAL_COMPUTING,
    description: EXERCISE,
    kind: "group",
  },
  {
    id: "ev-cv-hw3-0925",
    name: "Homework 3 is due",
    when: "Friday, 25 September 2026, 11:59 AM",
    courseId: "40012",
    courseTitle: VISUAL_COMPUTING,
    description: DEADLINE,
    kind: "assignment",
  },
  {
    id: "ev-cv-0928",
    name: "L01",
    when: "Monday, 28 September 2026, 8:15 AM » 10:00 AM",
    courseId: "40012",
    courseTitle: VISUAL_COMPUTING,
    description: LECTURE,
    kind: "group",
  },
  {
    id: "ev-cv-hw4-1002",
    name: "Homework 4 is due",
    when: "Friday, 2 October 2026, 11:59 AM",
    courseId: "40012",
    courseTitle: VISUAL_COMPUTING,
    description: DEADLINE,
    kind: "assignment",
  },

  /* 40013 — ELEC-E9130, lectures Tuesdays 14:15, exercises Wednesdays 10:15 */
  {
    id: "ev-rl-0922",
    name: "L01",
    when: "Tuesday, 22 September 2026, 2:15 PM » 4:00 PM",
    courseId: "40013",
    courseTitle: ADAPTIVE_CONTROL,
    description: LECTURE,
    kind: "group",
  },
  {
    id: "ev-rl-h01-0923",
    name: "H01",
    when: "Wednesday, 23 September 2026, 10:15 AM » 12:00 PM",
    courseId: "40013",
    courseTitle: ADAPTIVE_CONTROL,
    description: EXERCISE,
    kind: "group",
  },
  {
    id: "ev-rl-ex3-0928",
    name: "Exercise 3 is due",
    when: "Monday, 28 September 2026, 11:59 PM",
    courseId: "40013",
    courseTitle: ADAPTIVE_CONTROL,
    description: DEADLINE,
    kind: "assignment",
  },
  {
    id: "ev-rl-0929",
    name: "L01",
    when: "Tuesday, 29 September 2026, 2:15 PM » 4:00 PM",
    courseId: "40013",
    courseTitle: ADAPTIVE_CONTROL,
    description: LECTURE,
    kind: "group",
  },

  /* 40014 — ELEC-E9740, lectures Tuesdays 12:15, exercises Fridays 12:15 */
  {
    id: "ev-sf-0922",
    name: "L01",
    when: "Tuesday, 22 September 2026, 12:15 PM » 2:00 PM",
    courseId: "40014",
    courseTitle: SIGNAL_ESTIMATION,
    description: LECTURE,
    kind: "group",
  },
  {
    id: "ev-sf-h01-0925",
    name: "H01",
    when: "Friday, 25 September 2026, 12:15 PM » 2:00 PM",
    courseId: "40014",
    courseTitle: SIGNAL_ESTIMATION,
    description: EXERCISE,
    kind: "group",
  },
  {
    id: "ev-sf-0929",
    name: "L01",
    when: "Tuesday, 29 September 2026, 12:15 PM » 2:00 PM",
    courseId: "40014",
    courseTitle: SIGNAL_ESTIMATION,
    description: LECTURE,
    kind: "group",
  },
  {
    id: "ev-sf-1006",
    name: "L01",
    when: "Tuesday, 6 October 2026, 12:15 PM » 2:00 PM",
    courseId: "40014",
    courseTitle: SIGNAL_ESTIMATION,
    description: LECTURE,
    kind: "group",
  },
];

/* -------------------------------------------------------------- lookups --- */

/** Every event id, for `/calendar/event/[id]`'s `generateStaticParams`. */
export const eventIds: string[] = calendarEvents.map((event) => event.id);

export function getEvent(id: string): CalendarEvent | undefined {
  return calendarEvents.find((event) => event.id === id);
}

/** The route of an event page. */
export function eventHref(event: CalendarEvent): string {
  return `/calendar/event/${event.id}`;
}

export function eventsForCourse(courseId: string): CalendarEvent[] {
  return calendarEvents.filter((event) => event.courseId === courseId);
}
