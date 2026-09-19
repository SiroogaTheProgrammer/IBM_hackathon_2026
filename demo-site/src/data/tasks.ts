/**
 * The scripted task sequence the demo participant works through.
 *
 * Without it both halves of a session are unstructured clicking: the model
 * warms up on whatever the participant happened to do, and the monitored pass
 * afterwards looks nothing like it, so the risk score moves for reasons that
 * have nothing to do with *who* is at the keyboard. Running a fixed script
 * twice — once while the model trains, once while it scores — keeps the two
 * passes comparable, so a risk spike means the person changed, not the task.
 *
 * Every id below points at a real route in this clone: see `@/data/courses`
 * for the course ids and `@/data/activities` for the module ids.
 */

/** How `TaskPanel` decides a task is finished. */
export type TaskCheck =
  /** The participant reached this exact pathname, by any route. */
  | { kind: "visit"; path: string }
  /** The participant submitted this quiz attempt (any grade). */
  | { kind: "quiz"; activityId: string };

export type Task = {
  id: string;
  /** The instruction, one line, imperative. */
  label: string;
  /** Where to find it — a trail, not a link: the navigating is the point. */
  where: string;
  check: TaskCheck;
};

export type TaskPhase = "training" | "testing";

export type TaskRun = {
  title: string;
  /** One line under the title explaining what this pass is for. */
  blurb: string;
  tasks: Task[];
};

/**
 * Pass 1, scored by nobody: these are the windows the mouse model enrols on,
 * so the script covers the same ground the test pass will — a course list, a
 * course page, a typed quiz answer, an activity page and a profile page.
 */
const trainingRun: TaskRun = {
  title: "Training",
  blurb: "The model is learning your behaviour. Work through these in order.",
  tasks: [
    {
      id: "train-1",
      label: "Open My own courses",
      where: "Navigation bar → My own courses",
      check: { kind: "visit", path: "/my/courses" },
    },
    {
      id: "train-2",
      label: "Open ELEC-E9130 Adaptive Control and Decision Making",
      where: "My own courses → course list",
      check: { kind: "visit", path: "/course/40013" },
    },
    {
      id: "train-3",
      label: "Attempt Quiz 3: answer all three questions and submit",
      where: "ELEC-E9130 → course index (left) → Assignments & Quizzes",
      check: { kind: "quiz", activityId: "900133" },
    },
    {
      id: "train-4",
      label: "Open Homework Return 2 and check the time remaining",
      where: "Dashboard → Upcoming events → \"Homework Return 2 is due\"",
      check: { kind: "visit", path: "/mod/assign/900152" },
    },
    {
      id: "train-5",
      label: "Open your own public profile",
      where: "Navigation bar → avatar → Profile",
      check: { kind: "visit", path: "/user/profile" },
    },
  ],
};

/**
 * Pass 2, the one the risk score is read off. Same shapes as the training
 * pass — list, course, activity, typed quiz answer — on different pages, so a
 * participant cannot coast on muscle memory from the first run and an
 * impostor taking over mid-run has the same work to do.
 */
const testingRun: TaskRun = {
  title: "Testing",
  blurb: "The model is scoring you now. Same kind of work, different pages.",
  tasks: [
    {
      id: "test-1",
      label: "Open the Dashboard and read through the Timeline",
      where: "Navigation bar → Dashboard",
      check: { kind: "visit", path: "/my" },
    },
    {
      id: "test-2",
      // Three L01 rows fall on 22 September and the block shows no course
      // name, so the time is what makes this one findable.
      label: "Open the L01 lecture on Tuesday 22 September, 12:15",
      where: "Dashboard → Upcoming events (ELEC-E9740)",
      check: { kind: "visit", path: "/calendar/event/ev-sf-0922" },
    },
    {
      id: "test-3",
      label: "Open CS-E9410 Foundations of Pattern Discovery",
      where: "Navigation bar → My own courses",
      check: { kind: "visit", path: "/course/40011" },
    },
    {
      id: "test-4",
      label: "Attempt Quiz 5: answer all three questions and submit",
      where: "ELEC-E9130 → course index (left) → Assignments & Quizzes",
      check: { kind: "quiz", activityId: "900135" },
    },
    {
      id: "test-5",
      label: "Open the Announcements forum of CS-E9620 Visual Computing Systems",
      where: "CS-E9620 → course index (left) → General",
      check: { kind: "visit", path: "/mod/forum/900111" },
    },
  ],
};

export const taskRuns: Record<TaskPhase, TaskRun> = {
  training: trainingRun,
  testing: testingRun,
};
