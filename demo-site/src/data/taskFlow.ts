/**
 * The fixed 5-task flow — the "passphrase" of the verification system.
 *
 * The whole design is text-dependent (see `description.md` §1 and §2.1): every
 * run, by every user, walks the *same* ordered list of sub-tasks, so a test run
 * is always compared against the enrollment run sub-task by sub-task. That
 * removes nuisance variance (target distance, widget type, intent) for free,
 * and it only works if this list is treated as frozen: changing a sub-task's
 * `id` or its `target` invalidates every enrollment captured before the change.
 *
 * A sub-task is defined by its *terminating interaction* with one specific DOM
 * element. Elements carry a `data-trace="<target>"` attribute; the run engine
 * (`@/lib/trace/engine`) matches a click or a keystroke against the current
 * sub-task's `target` and nothing else, so clicking ahead does not skip steps.
 *
 * Budget: 29 sub-tasks, ~2–3 minutes per run. Task 2 is a real quiz attempt —
 * two clicked answers, one typed one, and the submit/confirm pair — so it costs
 * more reading time than the navigation tasks but contributes the flow's only
 * modal and its only typed free-text answer. Task 3 opens two assignment pages
 * back to back, which gives the same travel twice for a cheap repeat measure.
 *
 * One layout constraint when editing this list: the Trace card is fixed to the
 * bottom-right corner, so nothing in the bottom-right of the viewport can be a
 * target — a participant physically cannot click through the card. That is why
 * task 5 goes to the notification bell rather than a course row's ⋮ menu, which
 * sits directly underneath it.
 */

/** How a sub-task ends. */
export type SubtaskKind =
  /** A click on the `data-trace` element. */
  | "click"
  /**
   * Typing into the `data-trace` text field. *What* gets typed is deliberately
   * not checked — a participant who fat-fingers the search term has still
   * performed the same pointing movement and the same keystrokes, which is all
   * the encoder sees, and gating on an exact string stranded them instead.
   *
   * It does take `MIN_TYPED_CHARS` characters rather than a bare focus, so the
   * sub-task still contains the reach *and* the start of the typing, the way
   * every recorded run so far does.
   *
   * The instruction still names the text, because the site reacts to it: typing
   * "quiz" is what leaves Quiz 3 as the only timeline row, so the *next*
   * sub-task's target is where it was in every other run.
   */
  | "type";

/**
 * How much has to be in a `type` field before its sub-task is done.
 *
 * Two is enough to guarantee the segment holds real keystrokes without
 * demanding a specific word: at one character a stray keypress would end the
 * sub-task, and at the full string a typo strands the participant.
 */
export const MIN_TYPED_CHARS = 2;

export type Subtask = {
  /**
   * `<task>.<subtask>` — the alignment key every score is indexed by. Stable
   * across runs and across users; never renumber it.
   */
  id: string;
  /** The line the card shows while this sub-task is current. */
  instruction: string;
  /** `data-trace` value of the element that terminates the sub-task. */
  target: string;
  kind: SubtaskKind;
  /**
   * Other elements that count as the same terminating interaction — two routes
   * to one outcome, where the site genuinely offers both. Recorded runs still
   * log which one was hit, in the CSV's `element` column.
   */
  alsoAccepts?: readonly string[];
  /**
   * Route the sub-task is performed on. Not used for matching — the card uses
   * it to tell a participant who wandered off where the step actually lives.
   */
  route: string;
};

export type Task = {
  /** `1`…`5`, the prefix of its sub-task ids. */
  id: string;
  title: string;
  /** One line of context, shown above the current instruction. */
  goal: string;
  subtasks: Subtask[];
};

/** Every run starts here, so the first movement is geometrically identical. */
export const FLOW_START_ROUTE = "/";

export const tasks: Task[] = [
  {
    id: "1",
    title: "Find this week's quiz",
    goal: "Narrow the dashboard timeline down to the quiz that closes next.",
    subtasks: [
      {
        id: "1.1",
        instruction: 'Open "Dashboard" in the top navigation',
        target: "nav.dashboard",
        kind: "click",
        route: "/",
      },
      {
        id: "1.2",
        instruction: 'Open the timeline\'s "Next 7 days" filter',
        target: "timeline.range",
        kind: "click",
        route: "/my",
      },
      {
        id: "1.3",
        instruction: 'Choose "Next 30 days"',
        target: "timeline.range.30",
        kind: "click",
        route: "/my",
      },
      {
        id: "1.4",
        instruction: 'Type "quiz" into the timeline search box',
        target: "timeline.search",
        kind: "type",
        route: "/my",
      },
      {
        id: "1.5",
        instruction: 'Open "Quiz 3" from the timeline — the title or the button',
        target: "timeline.item.900133",
        // The row offers two ways to the same page, and a participant picking
        // the wide button over the title is not off-script.
        alsoAccepts: ["timeline.action.900133"],
        kind: "click",
        route: "/my",
      },
    ],
  },
  {
    id: "2",
    title: "Sit Quiz 3",
    goal: "Three questions on Lyapunov stability, then submit the attempt.",
    subtasks: [
      {
        id: "2.1",
        instruction: 'Click "Attempt quiz"',
        target: "quiz.attempt",
        kind: "click",
        route: "/mod/quiz/900133",
      },
      {
        id: "2.2",
        instruction: "Question 1 — answer True",
        target: "quiz.answer.q1.true",
        kind: "click",
        route: "/mod/quiz/900133",
      },
      {
        id: "2.3",
        instruction: 'Question 2 — pick "A uniformly continuous signal…"',
        target: "quiz.answer.q2.a",
        kind: "click",
        route: "/mod/quiz/900133",
      },
      {
        id: "2.4",
        instruction: 'Question 3 — type "definite" in the answer box',
        target: "quiz.answer.q3",
        kind: "type",
        route: "/mod/quiz/900133",
      },
      {
        id: "2.5",
        instruction: 'Click "Finish attempt …"',
        target: "quiz.finish",
        kind: "click",
        route: "/mod/quiz/900133",
      },
      {
        id: "2.6",
        instruction: 'On the summary, click "Submit all and finish"',
        target: "quiz.submit",
        kind: "click",
        route: "/mod/quiz/900133",
      },
      {
        id: "2.7",
        instruction: "Confirm the submission in the dialog",
        target: "quiz.confirm.submit",
        kind: "click",
        route: "/mod/quiz/900133",
      },
    ],
  },
  {
    id: "3",
    title: "Check your homework deadlines",
    goal: "Two Signal Estimation returns: see which is overdue, start the next.",
    subtasks: [
      {
        id: "3.1",
        instruction: 'Open "My own courses" in the top navigation',
        target: "nav.my-courses",
        kind: "click",
        route: "/mod/quiz/900133",
      },
      {
        id: "3.2",
        instruction: 'Search the course list for "signal"',
        target: "courses.search",
        kind: "type",
        route: "/my/courses",
      },
      {
        id: "3.3",
        instruction: "Open ELEC-E9740 – Principles of Signal Estimation",
        target: "courses.row.40014",
        kind: "click",
        route: "/my/courses",
      },
      {
        id: "3.4",
        instruction: 'Open "Homework Return 1" from the course index',
        target: "index.child.900151",
        kind: "click",
        route: "/course/40014",
      },
      {
        id: "3.5",
        instruction: 'Now open "Homework Return 2" from the course index',
        target: "index.child.900152",
        kind: "click",
        route: "/mod/assign/900151",
      },
      {
        id: "3.6",
        instruction: 'Click "Add submission"',
        target: "assign.submit",
        kind: "click",
        route: "/mod/assign/900152",
      },
    ],
  },
  {
    id: "4",
    title: "Answer the extra-exam questionnaire",
    goal: "Regroup the timeline by course, then open the questionnaire.",
    subtasks: [
      {
        id: "4.1",
        instruction: 'Go back to "Dashboard"',
        target: "nav.dashboard",
        kind: "click",
        route: "/mod/assign/900152",
      },
      {
        id: "4.2",
        instruction: 'Open the timeline\'s "Sort by dates" filter',
        target: "timeline.sort",
        kind: "click",
        route: "/my",
      },
      {
        id: "4.3",
        instruction: 'Choose "Sort by courses"',
        target: "timeline.sort.courses",
        kind: "click",
        route: "/my",
      },
      {
        id: "4.4",
        instruction: 'Open "Indicate your interest… for the extra exam"',
        target: "timeline.item.900171",
        kind: "click",
        route: "/my",
      },
      {
        id: "4.5",
        instruction: 'Click "Answer the questions…"',
        target: "feedback.answer",
        kind: "click",
        route: "/mod/feedback/900171",
      },
    ],
  },
  {
    id: "5",
    title: "Clear your notifications",
    goal: "Widen the course filter, then empty the notification badge.",
    subtasks: [
      {
        id: "5.1",
        instruction: 'Open "My own courses" in the top navigation',
        target: "nav.my-courses",
        kind: "click",
        route: "/mod/feedback/900171",
      },
      {
        id: "5.2",
        instruction: 'Open the "In progress" course filter',
        target: "courses.filter",
        kind: "click",
        route: "/my/courses",
      },
      {
        id: "5.3",
        instruction: 'Choose "All (including removed from view)"',
        target: "courses.filter.all",
        kind: "click",
        route: "/my/courses",
      },
      {
        id: "5.4",
        instruction: "Open the notification bell in the top bar",
        target: "nav.notifications",
        kind: "click",
        route: "/my/courses",
      },
      {
        id: "5.5",
        instruction: 'Click the tick — "Mark all as read"',
        target: "notifications.mark-all-read",
        kind: "click",
        route: "/my/courses",
      },
      {
        id: "5.6",
        instruction: 'Return to the front page with "Home"',
        target: "nav.home",
        kind: "click",
        route: "/my/courses",
      },
    ],
  },
];

/* --------------------------------------------------------------- lookups --- */

/** Every sub-task, flattened into run order. */
export const flowSubtasks: Subtask[] = tasks.flatMap((task) => task.subtasks);

export const FLOW_LENGTH = flowSubtasks.length;

/** Index into `flowSubtasks` at which each task begins, in task order. */
export const taskOffsets: number[] = tasks.reduce<number[]>(
  (offsets, task, position) =>
    offsets.concat(
      position === 0
        ? 0
        : (offsets[position - 1] ?? 0) + (tasks[position - 1]?.subtasks.length ?? 0),
    ),
  [],
);

/** The task a sub-task index belongs to, plus its position inside that task. */
export function locate(index: number): {
  task: Task;
  taskNumber: number;
  subtask: Subtask;
  subtaskNumber: number;
} | null {
  let seen = 0;

  for (const [taskIndex, task] of tasks.entries()) {
    if (index < seen + task.subtasks.length) {
      const subtaskNumber = index - seen;
      const subtask = task.subtasks[subtaskNumber];
      if (!subtask) return null;
      return {
        task,
        taskNumber: taskIndex + 1,
        subtask,
        subtaskNumber: subtaskNumber + 1,
      };
    }
    seen += task.subtasks.length;
  }

  return null;
}
