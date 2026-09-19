/**
 * Static data for /my/courses ("My own courses").
 *
 * The four rows mirror the course-overview block of the live Aalto MyCourses
 * site; the courses themselves are invented. `lastAccessed` is synthetic — it
 * exists so the "Sort by last accessed" option has something to sort on; the
 * order mirrors the dashboard's "Recently accessed courses" carousel.
 */

/** Moodle's course classification, used by the filter pill. */
export type CourseStatus = "inprogress" | "future" | "past";

export type MyCourse = {
  id: number;
  /** Full course name, in the shape the live site renders. */
  name: string;
  department: string;
  status: CourseStatus;
  /** ISO timestamp driving "Sort by last accessed" (newest first). */
  lastAccessed: string;
};

export const myCourses: MyCourse[] = [
  {
    id: 40011,
    name: "CS-E9410 - Foundations of Pattern Discovery D, Contact teaching, 1.9.2026-8.12.2026",
    department: "Department of Computer Science",
    status: "inprogress",
    lastAccessed: "2026-09-15T14:08:00",
  },
  {
    id: 40012,
    name: "CS-E9620 - Visual Computing Systems D, Contact teaching, 3.9.2026-11.12.2026",
    department: "Department of Computer Science",
    status: "inprogress",
    lastAccessed: "2026-09-16T11:20:00",
  },
  {
    id: 40013,
    name: "ELEC-E9130 - Adaptive Control and Decision Making D, Contact teaching, 2.9.2026-27.11.2026",
    department: "Department of Electrical Engineering and Automation",
    status: "inprogress",
    lastAccessed: "2026-09-17T18:05:00",
  },
  {
    id: 40014,
    name: "ELEC-E9740 - Principles of Signal Estimation D, Contact teaching, 7.9.2026-26.11.2026",
    department: "Department of Electrical Engineering and Automation",
    status: "inprogress",
    lastAccessed: "2026-09-18T09:42:00",
  },
];

/* --------------------------------------------------------------- filters --- */

export type CourseFilterValue =
  | "all"
  | "inprogress"
  | "future"
  | "past"
  | "starred"
  | "removed";

export type CourseFilterOption = {
  value: CourseFilterValue;
  label: string;
};

export const courseFilters: CourseFilterOption[] = [
  { value: "all", label: "All (including removed from view)" },
  { value: "inprogress", label: "In progress" },
  { value: "future", label: "Future" },
  { value: "past", label: "Past" },
  { value: "starred", label: "Starred" },
  { value: "removed", label: "Removed from view" },
];

export type CourseSortValue = "name" | "lastaccessed";

export type CourseSortOption = {
  value: CourseSortValue;
  label: string;
};

export const courseSorts: CourseSortOption[] = [
  { value: "name", label: "Sort by course name" },
  { value: "lastaccessed", label: "Sort by last accessed" },
];
