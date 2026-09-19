/**
 * Static course data for the four cloned MyCourses course pages.
 *
 * The "General" section of every Moodle course is a chunk of authored HTML
 * followed by that section's activities. Rather than shipping raw HTML we model
 * it as structured content blocks (heading / paragraph / list / table /
 * activity) so the renderer can emit real headings, lists and <table> elements.
 *
 * Every other section is a collapsed "band" card on the main course page; its
 * activities only show up as children in the left-hand course index.
 *
 * Every course, name and date below is invented. There is no backend.
 */

import type { ActivityKind } from "@/components/Icons";
import { targetHref } from "@/data/activities";

/* ----------------------------------------------------------------- text --- */

/** A run of text inside a paragraph, list item or table cell. */
export type InlineSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** `http…` opens in a new tab, `/…` is an internal route. */
  href?: string;
};

/** Either a plain string or a sequence of styled runs. */
export type RichText = string | (string | InlineSpan)[];

/** A list item, optionally with one level of nested items below it. */
export type ListEntry = RichText | { text: RichText; items: ListEntry[] };

/* --------------------------------------------------------------- blocks --- */

export type HeadingBlock = {
  type: "heading";
  level: 2 | 3 | 4;
  text: string;
};

export type ParagraphBlock = {
  type: "paragraph";
  text: RichText;
};

export type ListBlock = {
  type: "list";
  ordered?: boolean;
  items: ListEntry[];
};

export type TableBlock = {
  type: "table";
  caption?: string;
  headers: string[];
  rows: RichText[][];
};

/** An activity rendered inline in the section body (yellow circle + link). */
export type ActivityBlock = {
  type: "activity";
  kind: ActivityKind;
  name: string;
  /** Id in `@/data/activities`; resolve with `targetHref` for the link. */
  activityId: string;
  /** Small gray line under the activity name, e.g. "Forum". */
  meta?: string;
};

export type ContentBlock =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | TableBlock
  | ActivityBlock;

/* -------------------------------------------------------------- courses --- */

/** A child activity of a band section, listed in the left course index. */
export type CourseActivity = {
  name: string;
  kind: ActivityKind;
  /** Id in `@/data/activities` — the `/mod/…` page the row opens. */
  activityId: string;
};

export type SectionProgress = {
  done: number;
  total: number;
};

export type CourseSection = {
  /** Anchor id; also the key used by the course index drawer. */
  id: string;
  name: string;
  /** "general" renders its body inline, "band" renders a gray band card. */
  kind: "general" | "band";
  /** Body of the General section. */
  blocks?: ContentBlock[];
  /** Children listed under the section in the left drawer. */
  activities?: CourseActivity[];
  /** Moodle's resource summary, e.g. ["Files: 12"]. */
  resourceCounts?: string[];
  progress: SectionProgress;
};

export type CourseEvent = {
  kind: ActivityKind;
  title: string;
  date: string;
  /**
   * What the row opens: either an activity id (numeric, `@/data/activities`)
   * or a calendar session event slug (`ev-…`, `@/data/events`).
   */
  targetId: string;
  /** `targetId` already resolved to a route, so the view stays dumb. */
  href: string;
};

export type Course = {
  id: string;
  /** Full Moodle course name, as shown on the banner plate. */
  title: string;
  department: string;
  sections: CourseSection[];
  upcomingEvents: CourseEvent[];
};

/** One activity row under a section in the left-hand course index. */
export type CourseIndexChild = {
  /** Also what marks the row as current on that activity's own page. */
  activityId: string;
  name: string;
  kind: ActivityKind;
  /** Resolved `/mod/<type>/<id>` route. */
  href: string;
};

/** Flattened entry for the left-hand course index drawer. */
export type CourseIndexEntry = {
  id: string;
  name: string;
  children: CourseIndexChild[];
};

const NO_PROGRESS: SectionProgress = { done: 0, total: 0 };

/* ======================================================================= */
/* 40011 — CS-E9410 Foundations of Pattern Discovery                       */
/* ======================================================================= */

const patternDiscovery: Course = {
  id: "40011",
  title:
    "CS-E9410 - Foundations of Pattern Discovery D, Contact teaching, 1.9.2026-8.12.2026",
  department: "Department of Computer Science",
  sections: [
    {
      id: "general",
      name: "General",
      kind: "general",
      progress: NO_PROGRESS,
      blocks: [
        {
          type: "paragraph",
          text: [
            "Welcome to the ",
            { text: "CS-E9410 Foundations of Pattern Discovery", bold: true },
            " course in autumn 2026!",
          ],
        },
        {
          type: "paragraph",
          text:
            "Everything about how the course runs, the study material, the tasks and the announcements that matter will be posted on this page. The slides of the opening lecture go deeper into prerequisites and day-to-day practicalities.",
        },
        { type: "heading", level: 3, text: "Overview" },
        {
          type: "paragraph",
          text:
            "The course surveys the ideas behind finding structure in large collections of data and how far they carry on messy problems. It covers the main families of patterns and the algorithms that search for them: itemsets and rules, subgraphs, ways of grouping high-dimensional observations, mining of interaction networks, and the statistics that separate a genuine finding from an artefact of the search.",
        },
        { type: "heading", level: 3, text: "Lectures" },
        {
          type: "paragraph",
          text:
            "Twelve lectures are held in Hall A1, always from 16:15–18:00. The slot is Tuesday for all but one of them — week 37 adds a Wednesday meeting on top of its Tuesday one, so read the table before turning up!",
        },
        {
          type: "table",
          headers: ["Weekday", "Date", "Topic"],
          rows: [
            [
              "Tuesday",
              "1.9.",
              "L1: Introduction, the discovery pipeline, preparing the data",
            ],
            ["Tuesday", "8.9.", "L2: Proximity measures and representations"],
            [
              "Wednesday",
              "9.9.",
              "L3: Projection methods, is there any structure at all",
            ],
            [
              "Tuesday",
              "15.9.",
              "L4: Partitioning and agglomerative grouping",
            ],
            ["Tuesday", "22.9.", "L5: Graph-cut grouping, cluster validity"],
            [
              "Tuesday",
              "29.9.",
              "L6: Learned embeddings for grouping, frequency-driven rule search",
            ],
            ["Tuesday", "6.10.", "L7: Significance testing for rules"],
            ["Tuesday", "20.10.", "L8: Constrained and condensed pattern sets"],
            ["Tuesday", "27.10.", "L9: Mining structured and graph data"],
            ["Tuesday", "3.11.", "L10: Community structure in networks"],
            ["Tuesday", "10.11.", "L11: Stream mining, recommendation"],
            ["Tuesday", "17.11.", "L12: Synthesis"],
            [
              "Tuesday",
              "24.11.",
              [
                {
                  text: "room booked, no lecture scheduled",
                  italic: true,
                },
              ],
            ],
          ],
        },
        { type: "heading", level: 3, text: "Prerequisites" },
        {
          type: "paragraph",
          text:
            "Expected background: fluency in one programming language at the level of CS-A9110, algorithms and data structures at the level of CS-A9140, the probability and statistics toolkit of MS-A9050, and linear algebra at the level of MS-A9000. MS-C9620 on statistical inference helps but is not assumed. The prerequisite test in the section of the same name shows within minutes which of these you should refresh.",
        },
        { type: "heading", level: 3, text: "Material" },
        {
          type: "paragraph",
          text:
            "The course follows the textbook R. Lindqvist: Patterns in Large Data Sets. Academic Press, 2021. An electronic copy can be read through the Aalto library (login to aalto-primo). Beyond that there will be a handful of additional readings (linked from the course page). The material belonging to each topic is listed in section Lectures, below the lecture it goes with.",
        },
        {
          type: "paragraph",
          text:
            "Everything handed out during the term — recordings, slides, exercise sheets, extra notes — lands here in MyCourses.",
        },
        { type: "heading", level: 3, text: "Workload" },
        {
          type: "paragraph",
          text:
            "Budget roughly 140h in total. Of those, 36h go to contact teaching (12 lectures plus 6 exercise sessions), 18h to the homework and 18h to revising for the exam; the remaining 68h split between exercise work and reading on your own. How that 68h divides is a matter of temperament. Some students read a topic until it is solid and then write the week’s solutions in one sitting, on average 70min per task, which puts them near 44h of reading and 24h of exercises. Others treat the exercise sheet as the way in and consult the material as they go, closer to 34h on each side and about 2h per task. Skipping lectures or sessions moves hours into self-study rather than removing them. Either rhythm works, but reserve a fixed weekly slot for reading regardless: the exercises deliberately do not touch every corner of the syllabus.",
        },
        { type: "heading", level: 3, text: "Grading" },
        {
          type: "paragraph",
          text: "Four things feed into the course performance:",
        },
        {
          type: "list",
          ordered: true,
          items: [
            "the prerequisite test, deadline 14.9.2026 (max 2p)",
            "exercise tasks solved on your own plus taking part in the sessions — 18 tasks across 6 sessions, max 18p",
            "homework returned by teams of two or three, 4 tasks in all, max 12p",
            "the exam, Tue 8.12. at 13:00–16:00 (max 28p)",
          ],
        },
        { type: "paragraph", text: "Sum 60p" },
        {
          type: "paragraph",
          text: [
            "Your grade follows from the total across those four components. Two thresholds have to be cleared at once: ",
            {
              text: "half of the overall points and half of the exam points.",
              bold: true,
            },
          ],
        },
        {
          type: "paragraph",
          text:
            "Grade boundaries: grade 1 from 30 points, grade 2 from 36, grade 3 from 42, grade 4 from 48 and grade 5 from 54 upwards",
        },
        { type: "heading", level: 3, text: "Communication" },
        {
          type: "paragraph",
          text: [
            "Anything every participant needs to know goes out as a MyCourses announcement — it shows up on this page and is pushed to everyone enrolled unless you turn that off. Longer conversations, questions and advice belong in the course chat at ",
            {
              text: "https://coursechat.example.com/pattern-discovery-2026",
              href: "https://coursechat.example.com/pattern-discovery-2026",
            },
            ".",
          ],
        },
        {
          type: "paragraph",
          text:
            "Ask in the chat, at the end of a lecture or in an exercise session — whichever is nearest to hand. Anything that concerns only you is better raised in the weekly staff office hour listed in the syllabus, which keeps the channel readable for everyone else. Asking in the open usually gets you an answer sooner, and it leaves that answer where the next person with the same question will find it.",
        },
        {
          type: "paragraph",
          text: [
            {
              text:
                "The opening lecture walks through the rest of the practicalities!",
              bold: true,
            },
          ],
        },
        {
          type: "activity",
          kind: "forum",
          name: "Announcements",
          activityId: "900101",
          meta: "Forum",
        },
      ],
    },
    {
      id: "ai-and-collaboration",
      name: "AI and collaboration",
      kind: "band",
      progress: NO_PROGRESS,
    },
    {
      id: "prerequisite-test",
      name: "Prerequisite test",
      kind: "band",
      progress: NO_PROGRESS,
    },
    {
      id: "lectures",
      name: "Lectures",
      kind: "band",
      progress: NO_PROGRESS,
    },
    {
      id: "extra-materials",
      name: "Extra materials",
      kind: "band",
      progress: NO_PROGRESS,
    },
    {
      id: "exercises",
      name: "Exercises",
      kind: "band",
      progress: NO_PROGRESS,
    },
    {
      id: "homework-submission",
      name: "Homework submission",
      kind: "band",
      progress: NO_PROGRESS,
      resourceCounts: ["Assignment: 1"],
      activities: [
        {
          name: "Homework 1 – DL 28.9.",
          kind: "assignment",
          activityId: "900102",
        },
      ],
    },
    {
      id: "weekly-recap-tasks",
      name: "Weekly recap tasks",
      kind: "band",
      progress: NO_PROGRESS,
    },
  ],
  upcomingEvents: [
    {
      kind: "group",
      title: "L01",
      date: "Tuesday, 22 September, 16:15 » 18:00",
      targetId: "ev-dm-0922",
      href: targetHref("ev-dm-0922"),
    },
    {
      kind: "assignment",
      title: "Homework 1 – DL 28.9. is …",
      date: "Monday, 28 September, 23:59",
      targetId: "900102",
      href: targetHref("900102"),
    },
    {
      kind: "group",
      title: "L01",
      date: "Tuesday, 29 September, 16:15 » 18:00",
      targetId: "ev-dm-0929",
      href: targetHref("ev-dm-0929"),
    },
    {
      kind: "group",
      title: "H08",
      date: "Friday, 2 October, 12:15 » 14:00",
      targetId: "ev-dm-h08",
      href: targetHref("ev-dm-h08"),
    },
    {
      kind: "group",
      title: "L01",
      date: "Tuesday, 6 October, 16:15 » 18:00",
      targetId: "ev-dm-1006",
      href: targetHref("ev-dm-1006"),
    },
    {
      kind: "group",
      title: "L01",
      date: "Tuesday, 20 October, 16:15 » 18:00",
      targetId: "ev-dm-1020",
      href: targetHref("ev-dm-1020"),
    },
  ],
};

/* ======================================================================= */
/* 40012 — CS-E9620 Visual Computing Systems                               */
/* ======================================================================= */

const visualComputing: Course = {
  id: "40012",
  title:
    "CS-E9620 - Visual Computing Systems D, Contact teaching, 3.9.2026-11.12.2026",
  department: "Department of Computer Science",
  sections: [
    {
      id: "general",
      name: "General",
      kind: "general",
      progress: NO_PROGRESS,
      blocks: [
        { type: "heading", level: 3, text: "Course description" },
        {
          type: "paragraph",
          text:
            "This course introduces the systems side of visual computing: how an image is formed and filtered, how local features are found and matched, how geometry and camera motion are recovered from many views, how movement is tracked, and how objects are located and labelled. The lectures cover the algorithms, the models behind them and the trade-offs between them.",
        },
        { type: "heading", level: 3, text: "Teachers" },
        {
          type: "paragraph",
          text: [
            "Teaching is led by Associate Professor Markus Halonen (",
            {
              text: "https://people.example.com/mhalonen",
              href: "https://people.example.com/mhalonen",
            },
            "). The main course assistant is Doctor Elina Ruusu. Questions to the course personnel go through the course chat or the guidance sessions rather than to personal inboxes.",
          ],
        },
        { type: "heading", level: 3, text: "Schedule" },
        {
          type: "paragraph",
          text:
            "The lecture slot is Monday 8:15–10:00 in Hall B2, opening on Monday September 7. Every session is recorded, and the video appears under the “Lectures and materials” section of this page once it has been processed.",
        },
        {
          type: "paragraph",
          text:
            "Weekly homework starts straight away: round one closes Friday September 11 at 11:59 (noon).",
        },
        {
          type: "paragraph",
          text:
            "After that, every round closes at 11:59 (noon) on a Friday. Guidance sessions in Studio 2 on Tuesdays and Thursdays, 14:15–16:00, are where the assistants help you get a foothold on the current task. A short video walkthrough of each round appears the week after it closes.",
        },
        {
          type: "paragraph",
          text:
            "The course calendar in MyCourses lists every session together with its room. Nobody is marked present and turning up earns nothing on its own, but the homework itself has to be returned and carries bonus points towards the grade.",
        },
        { type: "heading", level: 3, text: "Registration and requirements" },
        {
          type: "paragraph",
          text:
            "Registration for Aalto students goes through Sisu. Passing the course takes both of the following:",
        },
        {
          type: "list",
          items: [
            "Score above zero on nine or more of the weekly rounds — the “Assignments” page tracks the count",
            "Reach a passing grade in the exam",
          ],
        },
        { type: "heading", level: 3, text: "Exams" },
        {
          type: "paragraph",
          text:
            "Sisu carries the official exam dates. For the autumn edition the main sitting falls in the closing week of teaching in December, and two further attempts are arranged over the spring term.",
        },
        { type: "heading", level: 3, text: "Pre-requisites" },
        {
          type: "paragraph",
          text:
            "You will need to be comfortable writing code, and to have met data structures along with the mathematics the course leans on throughout: linear algebra, a little geometry and elementary probability.",
        },
        {
          type: "activity",
          kind: "forum",
          name: "Announcements",
          activityId: "900111",
          meta: "Forum",
        },
      ],
    },
    {
      id: "lectures-and-materials",
      name: "Lectures and materials",
      kind: "band",
      progress: NO_PROGRESS,
      resourceCounts: ["Files: 12"],
    },
    {
      id: "homework-assignments",
      name: "Homework assignments",
      kind: "band",
      progress: NO_PROGRESS,
    },
    {
      id: "guidance-sessions-and-chat",
      name: "Guidance sessions and course chat",
      kind: "band",
      progress: NO_PROGRESS,
    },
  ],
  upcomingEvents: [
    {
      kind: "group",
      title: "L01",
      date: "Monday, 21 September, 08:15 » 10:00",
      targetId: "ev-cv-0921",
      href: targetHref("ev-cv-0921"),
    },
    {
      kind: "group",
      title: "H01",
      date: "Tuesday, 22 September, 14:15 » 16:00",
      targetId: "ev-cv-h01-0922",
      href: targetHref("ev-cv-h01-0922"),
    },
    {
      kind: "group",
      title: "H02",
      date: "Thursday, 24 September, 14:15 » 16:00",
      targetId: "ev-cv-h02-0924",
      href: targetHref("ev-cv-h02-0924"),
    },
    {
      kind: "assignment",
      title: "Homework 3 is due",
      date: "Friday, 25 September, 11:59",
      targetId: "ev-cv-hw3-0925",
      href: targetHref("ev-cv-hw3-0925"),
    },
    {
      kind: "group",
      title: "L01",
      date: "Monday, 28 September, 08:15 » 10:00",
      targetId: "ev-cv-0928",
      href: targetHref("ev-cv-0928"),
    },
    {
      kind: "assignment",
      title: "Homework 4 is due",
      date: "Friday, 2 October, 11:59",
      targetId: "ev-cv-hw4-1002",
      href: targetHref("ev-cv-hw4-1002"),
    },
  ],
};

/* ======================================================================= */
/* 40013 — ELEC-E9130 Adaptive Control and Decision Making                 */
/* ======================================================================= */

const adaptiveControl: Course = {
  id: "40013",
  title:
    "ELEC-E9130 - Adaptive Control and Decision Making D, Contact teaching, 2.9.2026-27.11.2026",
  department: "Department of Electrical Engineering and Automation",
  sections: [
    {
      id: "general",
      name: "General",
      kind: "general",
      progress: NO_PROGRESS,
      blocks: [
        {
          type: "paragraph",
          text:
            "The course covers the mathematical models and the algorithms that underpin sequential decision making in systems that evolve over time. The emphasis is on optimal control and adaptation, on learning a policy from interaction, and on choosing actions when the state of the world is only partly known.",
        },
        { type: "heading", level: 3, text: "Practical matters" },
        { type: "paragraph", text: "Lecturer: Petri Ahlgren." },
        {
          type: "paragraph",
          text:
            "Teaching assistants (TAs): Nina Salomaa (main TA), Aleksi Rautio, Daniel Weiss, Sofia Marchetti, Omar Haddad, Ravi Menon, Lotta Peltola, Ines Duarte, Jonas Kraft, Mira Oksanen, Tomas Novak",
        },
        {
          type: "paragraph",
          text:
            "Grading runs 0-5. The seven individual assignments carry 55%, the quizzes 15% and the exam 30%.",
        },
        {
          type: "paragraph",
          text:
            "Join the course chat early in the term: updates land there first, and it is where exercise questions get answered. Register with your Aalto account. Since the answers stay in the channel, read through it before asking something new.",
        },
        { type: "heading", level: 3, text: "Lectures" },
        {
          type: "paragraph",
          text:
            "Lecture arrangements for the term:",
        },
        {
          type: "list",
          items: [
            "Location: Hall C3",
            "Opening lecture: Wednesday 2.9.2026, 14:15 - 16:00",
            "Tuesdays 14:15-16:00 from week 37 onwards, through Periods I and II",
            "No lecture on Tuesday 13.10.2026",
            "Coming along in person gets you the discussion and the questions, but every lecture is recorded and stays available to watch later",
          ],
        },
        {
          type: "table",
          headers: ["Week", "Lecture", "Lecture_Date", "Reading"],
          rows: [
            ["W36", "L1 Course Overview", "Wed, 2.9", "no readings"],
            [
              "W37",
              "L2 Sequential decision models",
              "Tue, 8.9",
              "Course textbook, Chapters (Ch.) 1-1.4, 2.2-2.6, 3-3.5",
            ],
            [
              "W38",
              "L3 Learning in finite state spaces",
              "Tue, 15.9",
              "Course textbook, Ch. 4-4.5, 4.8, 5-5.3",
            ],
            [
              "W39",
              "L4 Approximate value representations",
              "Tue, 22.9",
              "Course textbook, Ch. 7-7.4, 8-8.2",
            ],
            [
              "W40",
              "L5 Direct policy search",
              "Tue, 29.9",
              "Course textbook, Ch. 11-11.3",
            ],
            [
              "W41",
              "L6 Actor-critic architectures",
              "Tue, 6.10",
              "Course textbook, Ch. 11.6, 11.9",
            ],
            ["W42", "No Lecture", "Tue, 13.10", ""],
            [
              "W43",
              "L7 Learning the system dynamics",
              "Tue, 20.10",
              "Course textbook, Ch. 6 - 6.3",
            ],
            [
              "W44",
              "L8 Planning with a learned model",
              "Tue, 27.10",
              "Course textbook, Ch. 6.4 - 6.7",
            ],
            [
              "W45",
              "L9 Balancing exploration and exploitation",
              "Tue, 3.11",
              [
                "1) Course textbook, Ch. 2.8, 6.9 - 6.11 and 2) Virtanen, H., Lange, P., Okafor, C., & Bergqvist, S. (2022). Posterior sampling for sequential decisions: a practical tutorial. Reviews in Machine Intelligence, 9(2), 1-84. ",
                {
                  text: "https://reviews.example.com/posterior-sampling.pdf",
                  href: "https://reviews.example.com/posterior-sampling.pdf",
                },
                " Section 2, 3, 5",
              ],
            ],
            [
              "W46",
              "L10 Guest Lecture: Ravi Menon: Safe exploration under constraints, Mira Oksanen: Hierarchical option discovery",
              "Tue, 10.11",
              "",
            ],
            [
              "W47",
              "L11 Decisions under partial observability",
              "Tue, 17.11",
              [
                "1) K. Obermeier, Partially observable models tutorial, ",
                {
                  text: "https://tutorials.example.com/partially-observable/",
                  href: "https://tutorials.example.com/partially-observable/",
                },
                ", steps from “A Quick Refresher on Decision Processes” until “Where Belief States Come From” and 2) Decision Making under Partial Observability in Robotics: A Review. ",
                {
                  text: "https://preprints.example.com/pdf/2211.40815",
                  href: "https://preprints.example.com/pdf/2211.40815",
                },
                " Sections II.B, III.A, III.D",
              ],
            ],
            ["W48", "No Lecture", "Tue, 24.11", ""],
          ],
        },
        { type: "heading", level: 3, text: "Quizzes" },
        {
          type: "paragraph",
          text:
            "Quizzes are solved alone, without help from anyone else. Nothing in them goes beyond the lecture and its assigned reading, and each one closes as the following lecture starts.",
        },
        {
          type: "table",
          headers: ["Quiz", "Release", "Deadline (always before the lecture)"],
          rows: [
            ["Quiz 1", "2.9", "8.9"],
            ["Quiz 2", "8.9", "15.9"],
            ["Quiz 3", "15.9", "22.9"],
            ["Quiz 4", "22.9", "29.9"],
            ["Quiz 5", "29.9", "6.10"],
            ["Quiz 6", "6.10", "20.10"],
            ["Quiz 7", "20.10", "3.11"],
            ["Quiz 8", "3.11", "17.11"],
          ],
        },
        { type: "heading", level: 3, text: "Exercises" },
        {
          type: "paragraph",
          text:
            "Seven assignments are compulsory, and both they and the quizzes count as individual work. Arguing about algorithms, implementation choices and course concepts with other students is part of learning and nobody discourages it; passing around answers, data or source code is where the line falls. Put briefly—trade intuitions, not solutions.",
        },
        {
          type: "list",
          items: [
            "Submit on time. The closing page of each assignment instruction lists the files your return has to contain, so check it before uploading — nothing arrives late, neither a whole submission nor a forgotten file.",
            "Several notebooks take a long while to finish running, so begin well before the deadline. Compute outages and queue backlogs are not grounds for an extension.",
            "The TAs read the course chat on weekdays and answer there. The channel is swept roughly once a day and there may well be a queue ahead of you, so ask early rather than the night before a deadline.",
            "Never paste your own solution code into a public channel",
            "Debugging help is given face to face in the exercise sessions, not over chat.",
            "Direct a question about an exercise only at the TAs listed for it in the table below",
            "Every deadline falls at 23:59 on the stated day.",
            "One exercise session per week; coming along is up to you.",
            "Location: Lab 4",
            "Time: 10.15-12.00",
            "No exercise session during week 42",
          ],
        },
        {
          type: "table",
          headers: [
            "Exercise",
            "Release Date",
            "Submission Date",
            "Exercise Session Date",
            "TAs",
          ],
          rows: [
            ["Exercise 1", "2.9", "14.9", "9.9", "Aleksi, Lotta"],
            ["Exercise 2", "7.9", "21.9", "16.9", "Daniel, Lotta"],
            ["Exercise 3", "14.9", "28.9", "23.9", "Sofia, Omar"],
            ["Exercise 4", "21.9", "5.10", "30.9", "Sofia, Omar"],
            ["Exercise 5", "28.9", "12.10", "7.10", "Ines, Jonas"],
            ["Exercise 6", "5.10", "26.10", "21.10", "Ines, Jonas"],
            ["Exercise 7", "19.10", "2.11", "28.10", "Aleksi, Mira"],
          ],
        },
        { type: "heading", level: 3, text: "Exam" },
        {
          type: "paragraph",
          text: "You cannot pass the course without passing the exam.",
        },
        {
          type: "list",
          items: [
            "Exam Passing grade: 45%",
            "Exam: Friday 27.11.2026, 9.00–12.00, Hall C3",
            "A single retake is arranged and its date follows later in the term.",
            {
              text: "Exam consists of two parts",
              items: [
                "Part A: brief written answers. Typical prompts are “state the optimality condition for a finite-horizon problem” or “explain what bootstrapping means in a value update”. One or two of them reach into later material such as planning with a learned model. Either describe the idea in your own words or give the expression behind it.",
                "Part B: two application problems. Each problem names one algorithm, sets the scene, and then asks a chain of questions about it. These may ask you to justify why the algorithm behaves as it does, to analyse a case where it fails, or to carry a small calculation through by hand.",
              ],
            },
            "Looking for practice questions? The end-of-chapter problems in the course textbook are the closest thing available, and they give a usable sense of the level for anyone who works best from concrete examples. The exam reuses none of them, and its scope is the quizzes, the lectures and the assignments rather than the book’s table of contents.",
            "You must be able to show a photo ID at the exam hall door; the exam instructions spell out what counts.",
            "No calculators and no notes of any kind may be brought in.",
          ],
        },
        {
          type: "activity",
          kind: "forum",
          name: "Announcements",
          activityId: "900121",
          meta: "Forum",
        },
      ],
    },
    {
      id: "lectures",
      name: "Lectures",
      kind: "band",
      progress: NO_PROGRESS,
      resourceCounts: ["Files: 4", "URLs: 3"],
    },
    {
      id: "assignments-and-quizzes",
      name: "Assignments & Quizzes",
      kind: "band",
      progress: NO_PROGRESS,
      resourceCounts: ["Text and media areas: 2", "Quizzes: 8"],
      activities: [
        { name: "Quiz 1", kind: "quiz", activityId: "900131" },
        { name: "Quiz 2", kind: "quiz", activityId: "900132" },
        { name: "Quiz 3", kind: "quiz", activityId: "900133" },
        { name: "Quiz 4", kind: "quiz", activityId: "900134" },
        { name: "Quiz 5", kind: "quiz", activityId: "900135" },
        { name: "Quiz 6", kind: "quiz", activityId: "900136" },
        { name: "Quiz 7", kind: "quiz", activityId: "900137" },
        { name: "Quiz 8", kind: "quiz", activityId: "900138" },
      ],
    },
    {
      id: "resources",
      name: "Resources",
      kind: "band",
      progress: NO_PROGRESS,
    },
  ],
  upcomingEvents: [
    {
      kind: "quiz",
      title: "Quiz 3 closes",
      date: "Tuesday, 22 September, 14:15",
      targetId: "900133",
      href: targetHref("900133"),
    },
    {
      kind: "group",
      title: "L01",
      date: "Tuesday, 22 September, 14:15 » 16:00",
      targetId: "ev-rl-0922",
      href: targetHref("ev-rl-0922"),
    },
    {
      kind: "quiz",
      title: "Quiz 4 opens",
      date: "Tuesday, 22 September, 16:00",
      targetId: "900134",
      href: targetHref("900134"),
    },
    {
      kind: "group",
      title: "H01",
      date: "Wednesday, 23 September, 10:15 » 12:00",
      targetId: "ev-rl-h01-0923",
      href: targetHref("ev-rl-h01-0923"),
    },
    {
      kind: "assignment",
      title: "Exercise 3 is due",
      date: "Monday, 28 September, 23:59",
      targetId: "ev-rl-ex3-0928",
      href: targetHref("ev-rl-ex3-0928"),
    },
    {
      kind: "quiz",
      title: "Quiz 4 closes",
      date: "Tuesday, 29 September, 14:15",
      targetId: "900134",
      href: targetHref("900134"),
    },
    {
      kind: "group",
      title: "L01",
      date: "Tuesday, 29 September, 14:15 » 16:00",
      targetId: "ev-rl-0929",
      href: targetHref("ev-rl-0929"),
    },
  ],
};

/* ======================================================================= */
/* 40014 — ELEC-E9740 Principles of Signal Estimation                      */
/* ======================================================================= */

const signalEstimation: Course = {
  id: "40014",
  title:
    "ELEC-E9740 - Principles of Signal Estimation D, Contact teaching, 7.9.2026-26.11.2026",
  department: "Department of Electrical Engineering and Automation",
  sections: [
    {
      id: "general",
      name: "General",
      kind: "general",
      progress: NO_PROGRESS,
      blocks: [
        {
          type: "paragraph",
          text:
            "Welcome to Principles of Signal Estimation, autumn 2026. Lectures run on Tuesdays at 12-14 in Hall B2, exercise sessions on Fridays at 12-14 in Lab 4. Teaching opens with the lecture of Tuesday 8.9.2026; the Friday of that same week, 11.9.2026, is given over to a recap of programming and matrix algebra, also in Lab 4.",
        },
        {
          type: "paragraph",
          text:
            "Office hours: message the course chat to agree a slot, in person or online.",
        },
        { type: "heading", level: 3, text: "Lectures and Exercises" },
        {
          type: "paragraph",
          text: "Main lecturer Prof. Antti Ranta",
        },
        { type: "heading", level: 3, text: "Homeworks and Exercises" },
        {
          type: "paragraph",
          text: "Co-lecturer: Elena Fiore",
        },
        { type: "heading", level: 3, text: "Project Work" },
        { type: "paragraph", text: "Nils Berg" },
        { type: "heading", level: 3, text: "Course chat" },
        {
          type: "paragraph",
          text: [
            "Discussion outside the sessions happens on the course chat server: ",
            {
              text: "https://coursechat.example.com/signal-estimation-2026",
              href: "https://coursechat.example.com/signal-estimation-2026",
            },
          ],
        },
        { type: "heading", level: 3, text: "Intended Learning Outcomes" },
        {
          type: "paragraph",
          text:
            "By the end of the course a participant should be able to:",
        },
        {
          type: "list",
          items: [
            "describe the building blocks of an estimation system and how they fit together,",
            "move from a physical description — differential equations, recursions, the behaviour of the sensors themselves — to a state space model in continuous or discrete time,",
            "recognise where a model stops being linear and explain what that costs an estimator",
            "assemble a recursive estimator for a given problem and argue why one formulation of it beats another.",
          ],
        },
        { type: "heading", level: 3, text: "Assessment Methods and Criteria" },
        {
          type: "paragraph",
          text:
            "Whether those outcomes have been reached is judged from two written mid-term exams, the homework rounds and the project work. Points accumulate across the components listed below, and the figures given are the maximum each one can yield:",
        },
        {
          type: "list",
          items: [
            "Exam 1: 25 points",
            "Exam 2: 25 points",
            "Homeworks: 24 points (8 rounds, 3 points each)",
            "Project work part 1: 16 points",
            "Project work part 2: 20 points",
          ],
        },
        {
          type: "paragraph",
          text:
            "That comes to 110 points in all, and the grade boundaries are:",
        },
        {
          type: "list",
          items: [
            "≥92pts ↔ grade 5",
            "≥79pts ↔ grade 4",
            "≥66pts ↔ grade 3",
            "≥55pts ↔ grade 2",
            "≥45pts ↔ grade 1",
          ],
        },
        {
          type: "paragraph",
          text:
            "One extra point comes from filling in the course feedback questionnaire, and if the timetable allows a bonus homework round worth up to 3 points is opened late in the term.",
        },
        {
          type: "paragraph",
          text:
            "Worked through with numbers: 18 from Exam 1, 17 from Exam 2, 19 across the homework rounds, then 12 and 14 from the two project parts, plus the feedback point — 18 + 17 + 19 + 12 + 14 + 1= 81 points, which is a grade 4.",
        },
        {
          type: "paragraph",
          text:
            "A retake covering the whole course is also arranged; its result substitutes for the 50 points of Exam 1 and Exam 2 together.",
        },
        { type: "heading", level: 3, text: "Study Material" },
        {
          type: "paragraph",
          text:
            "There is no set textbook. The Reading materials section collects the notes and handouts each lecture builds on, posted as the term goes along.",
        },
        { type: "heading", level: 3, text: "Prerequisites" },
        {
          type: "paragraph",
          text:
            "Linear algebra, probability and calculus are assumed. Earlier exposure to signals and systems, to estimation theory or to sensor hardware makes the term easier, but none of it is a formal requirement.",
        },
        {
          type: "paragraph",
          text:
            "Not sure whether your background is enough? Come along to the recap session.",
        },
        {
          type: "activity",
          kind: "forum",
          name: "Announcements",
          activityId: "900141",
          meta: "Forum",
        },
      ],
    },
    {
      id: "reading-materials",
      name: "Reading materials",
      kind: "band",
      progress: NO_PROGRESS,
    },
    {
      id: "schedule",
      name: "Schedule",
      kind: "band",
      progress: NO_PROGRESS,
      resourceCounts: ["Folders: 5", "Files: 3", "Assignments: 4"],
      activities: [
        { name: "Homework Return 1", kind: "assignment", activityId: "900151" },
        { name: "Homework Return 2", kind: "assignment", activityId: "900152" },
        { name: "Homework Return 3", kind: "assignment", activityId: "900153" },
        { name: "Homework Return 4", kind: "assignment", activityId: "900154" },
      ],
    },
    {
      id: "project-work",
      name: "Project work",
      kind: "band",
      progress: NO_PROGRESS,
      resourceCounts: ["Assignments: 2"],
      activities: [
        { name: "Project work part 1", kind: "assignment", activityId: "900161" },
        { name: "Project work part 2", kind: "assignment", activityId: "900162" },
      ],
    },
    {
      id: "old-lecture-videos",
      name: "Old lecture videos",
      kind: "band",
      progress: NO_PROGRESS,
      resourceCounts: ["Folder: 1"],
    },
  ],
  upcomingEvents: [
    {
      kind: "group",
      title: "L01",
      date: "Tuesday, 22 September, 12:15 » 14:00",
      targetId: "ev-sf-0922",
      href: targetHref("ev-sf-0922"),
    },
    {
      kind: "assignment",
      title: "Homework Return 2 is due",
      date: "Friday, 25 September, 12:00",
      targetId: "900152",
      href: targetHref("900152"),
    },
    {
      kind: "group",
      title: "H01",
      date: "Friday, 25 September, 12:15 » 14:00",
      targetId: "ev-sf-h01-0925",
      href: targetHref("ev-sf-h01-0925"),
    },
    {
      kind: "group",
      title: "L01",
      date: "Tuesday, 29 September, 12:15 » 14:00",
      targetId: "ev-sf-0929",
      href: targetHref("ev-sf-0929"),
    },
    {
      kind: "assignment",
      title: "Homework Return 3 is due",
      date: "Friday, 2 October, 12:00",
      targetId: "900153",
      href: targetHref("900153"),
    },
    {
      kind: "group",
      title: "L01",
      date: "Tuesday, 6 October, 12:15 » 14:00",
      targetId: "ev-sf-1006",
      href: targetHref("ev-sf-1006"),
    },
  ],
};

/* ---------------------------------------------------------------- index --- */

export const courses: Course[] = [
  patternDiscovery,
  visualComputing,
  adaptiveControl,
  signalEstimation,
];

export const courseIds: string[] = courses.map((course) => course.id);

export function getCourse(id: string): Course | undefined {
  return courses.find((course) => course.id === id);
}

/**
 * Children shown under a section in the left drawer: activities rendered
 * inline in the section body, then the section's own activity list.
 */
export function sectionChildren(section: CourseSection): CourseActivity[] {
  const inline = (section.blocks ?? [])
    .filter((block): block is ActivityBlock => block.type === "activity")
    .map((block) => ({
      name: block.name,
      kind: block.kind,
      activityId: block.activityId,
    }));

  return [...inline, ...(section.activities ?? [])];
}

/**
 * Trimmed course outline for the client-side index drawer — keeps the whole
 * course body out of the serialized client payload.
 */
export function buildCourseIndex(course: Course): CourseIndexEntry[] {
  return course.sections.map((section) => ({
    id: section.id,
    name: section.name,
    children: sectionChildren(section).map((child) => ({
      ...child,
      href: targetHref(child.activityId),
    })),
  }));
}
