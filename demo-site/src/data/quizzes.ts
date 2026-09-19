/**
 * Fake question banks for the `/mod/quiz/<id>` attempt flow.
 *
 * There is no backend and no real course material behind any of this: the
 * questions are invented, topically flavoured after each ELEC-E9130 quiz so an
 * attempt reads plausibly, and graded entirely on the client in
 * `@/components/activity/QuizBody`. Nothing here is a real exam question.
 *
 * The eight quizzes are module ids 900131 … 900138 (see `@/data/activities`);
 * each carries three one-mark questions across the three Moodle question types
 * this clone renders: multiple choice, true/false and short answer.
 */

export type QuizOption = {
  /** Stable within a question; also the stored answer value for multichoice. */
  id: string;
  text: string;
};

type QuizQuestionBase = {
  id: string;
  text: string;
  /** Marks the question is worth. Every question here is worth 1.00. */
  mark: number;
  /** Shown on the review page under the chosen answer. */
  feedback: string;
};

export type QuizQuestion =
  | (QuizQuestionBase & {
      type: "multichoice";
      options: QuizOption[];
      /** The correct option's id. */
      correct: string;
    })
  | (QuizQuestionBase & {
      type: "truefalse";
      correct: boolean;
    })
  | (QuizQuestionBase & {
      type: "shortanswer";
      /** Accepted answers, matched case-insensitively after trimming. */
      accept: string[];
    });

/** Module id → its three questions, in the order they are attempted. */
export const quizQuestions: Record<string, QuizQuestion[]> = {
  // Quiz 1 — Fundamentals of adaptive control
  "900131": [
    {
      id: "q1",
      type: "multichoice",
      mark: 1,
      text: "Which statement best describes an adaptive controller?",
      options: [
        { id: "a", text: "It uses a single fixed set of gains chosen offline." },
        {
          id: "b",
          text: "It adjusts its own parameters online as it observes the system.",
        },
        { id: "c", text: "It replaces the plant with a linear approximation." },
        { id: "d", text: "It requires the plant to be perfectly known in advance." },
      ],
      correct: "b",
      feedback:
        "Adaptive controllers update their parameters online from measured behaviour, unlike fixed-gain designs.",
    },
    {
      id: "q2",
      type: "truefalse",
      mark: 1,
      text: "Gain scheduling switches between precomputed controllers rather than estimating parameters online.",
      correct: true,
      feedback:
        "Correct — gain scheduling interpolates fixed, precomputed gains and is not adaptive in the estimation sense.",
    },
    {
      id: "q3",
      type: "shortanswer",
      mark: 1,
      text: "Unbounded growth of estimated parameters under a poorly designed adaptation law is known as parameter ______.",
      accept: ["drift", "windup"],
      feedback: "Accepted answers: parameter drift (also called parameter windup).",
    },
  ],

  // Quiz 2 — System identification
  "900132": [
    {
      id: "q1",
      type: "multichoice",
      mark: 1,
      text: "In recursive least squares, a forgetting factor λ slightly below 1 is chosen in order to:",
      options: [
        { id: "a", text: "Track slowly time-varying parameters." },
        { id: "b", text: "Guarantee the estimate never changes." },
        { id: "c", text: "Remove all measurement noise exactly." },
        { id: "d", text: "Make the covariance matrix singular." },
      ],
      correct: "a",
      feedback:
        "A forgetting factor discounts old data so the estimator keeps tracking as parameters change.",
    },
    {
      id: "q2",
      type: "shortanswer",
      mark: 1,
      text: "An input that is rich enough to identify every model parameter is said to be persistently ______.",
      accept: ["exciting", "excited", "excitation"],
      feedback: "Accepted answer: persistently exciting (persistence of excitation).",
    },
    {
      id: "q3",
      type: "truefalse",
      mark: 1,
      text: "Increasing the model order always improves prediction accuracy on unseen data.",
      correct: false,
      feedback:
        "False — too high an order overfits the training data and generalises worse.",
    },
  ],

  // Quiz 3 — Lyapunov stability
  "900133": [
    {
      id: "q1",
      type: "truefalse",
      mark: 1,
      text: "If V(x) is positive definite and its derivative along trajectories is negative definite, the equilibrium is asymptotically stable.",
      correct: true,
      feedback: "Correct — this is the standard Lyapunov asymptotic-stability theorem.",
    },
    {
      id: "q2",
      type: "multichoice",
      mark: 1,
      text: "Barbalat's lemma is typically invoked in adaptive control to conclude that:",
      options: [
        {
          id: "a",
          text: "A uniformly continuous signal with a convergent integral tends to zero.",
        },
        { id: "b", text: "Every bounded signal converges." },
        { id: "c", text: "The plant is controllable." },
        { id: "d", text: "The reference model is unstable." },
      ],
      correct: "a",
      feedback:
        "Barbalat's lemma lets you conclude a signal → 0 from boundedness of its integral plus uniform continuity.",
    },
    {
      id: "q3",
      type: "shortanswer",
      mark: 1,
      text: "A valid Lyapunov function candidate must be positive ______ around the equilibrium.",
      accept: ["definite"],
      feedback: "Accepted answer: positive definite.",
    },
  ],

  // Quiz 4 — Model reference adaptive control
  "900134": [
    {
      id: "q1",
      type: "multichoice",
      mark: 1,
      text: "The objective of Model Reference Adaptive Control (MRAC) is to make the plant output track:",
      options: [
        { id: "a", text: "A constant setpoint only." },
        { id: "b", text: "The output of a chosen reference model." },
        { id: "c", text: "The measurement noise." },
        { id: "d", text: "The controller's previous output." },
      ],
      correct: "b",
      feedback: "MRAC adapts the controller so the plant behaves like the reference model.",
    },
    {
      id: "q2",
      type: "truefalse",
      mark: 1,
      text: "The MIT rule updates controller parameters along the negative gradient of a squared-error cost.",
      correct: true,
      feedback: "Correct — the MIT rule is a gradient-descent adaptation law on the squared error.",
    },
    {
      id: "q3",
      type: "shortanswer",
      mark: 1,
      text: "In the acronym MRAC, the letter C stands for ______.",
      accept: ["control"],
      feedback: "Accepted answer: Model Reference Adaptive Control.",
    },
  ],

  // Quiz 5 — Self-tuning regulators
  "900135": [
    {
      id: "q1",
      type: "multichoice",
      mark: 1,
      text: "A self-tuning regulator combines online parameter estimation with:",
      options: [
        { id: "a", text: "A controller design step recomputed at each update." },
        { id: "b", text: "A permanently fixed controller." },
        { id: "c", text: "Manual retuning by an operator." },
        { id: "d", text: "Open-loop operation only." },
      ],
      correct: "a",
      feedback:
        "An STR re-solves the controller design each step using the latest estimates.",
    },
    {
      id: "q2",
      type: "shortanswer",
      mark: 1,
      text: "Treating estimated parameters as if they were the true values is called the ______ equivalence principle.",
      accept: ["certainty"],
      feedback: "Accepted answer: certainty equivalence.",
    },
    {
      id: "q3",
      type: "truefalse",
      mark: 1,
      text: "An indirect self-tuning regulator estimates the plant parameters first and then computes the controller from them.",
      correct: true,
      feedback: "Correct — 'indirect' means plant parameters are estimated, then mapped to the controller.",
    },
  ],

  // Quiz 6 — Markov decision processes
  "900136": [
    {
      id: "q1",
      type: "multichoice",
      mark: 1,
      text: "The Markov property states that the next state depends on:",
      options: [
        { id: "a", text: "The entire history of states and actions." },
        { id: "b", text: "Only the current state and the chosen action." },
        { id: "c", text: "The reward two steps ahead." },
        { id: "d", text: "Nothing — transitions are deterministic." },
      ],
      correct: "b",
      feedback:
        "Under the Markov property the future is independent of the past given the current state and action.",
    },
    {
      id: "q2",
      type: "shortanswer",
      mark: 1,
      text: "The factor γ ∈ [0,1) that weighs future reward against immediate reward is the ______ factor.",
      accept: ["discount", "discounting"],
      feedback: "Accepted answer: discount factor.",
    },
    {
      id: "q3",
      type: "truefalse",
      mark: 1,
      text: "A policy maps states to actions (or to distributions over actions).",
      correct: true,
      feedback: "Correct — that is exactly the definition of a policy in an MDP.",
    },
  ],

  // Quiz 7 — Dynamic programming and the Bellman equation
  "900137": [
    {
      id: "q1",
      type: "multichoice",
      mark: 1,
      text: "The Bellman optimality equation writes the optimal value of a state as:",
      options: [
        {
          id: "a",
          text: "The max over actions of expected immediate reward plus discounted next-state value.",
        },
        { id: "b", text: "The sum of all past rewards." },
        { id: "c", text: "A fixed constant for every state." },
        { id: "d", text: "The minimum reward ever received." },
      ],
      correct: "a",
      feedback:
        "The optimal value satisfies V*(s) = maxₐ E[r + γ V*(s')].",
    },
    {
      id: "q2",
      type: "truefalse",
      mark: 1,
      text: "For a discounted MDP with γ < 1, value iteration is guaranteed to converge.",
      correct: true,
      feedback: "Correct — the Bellman operator is a contraction when γ < 1, so value iteration converges.",
    },
    {
      id: "q3",
      type: "shortanswer",
      mark: 1,
      text: "Alternating a policy-evaluation step with a greedy policy-improvement step is called policy ______.",
      accept: ["iteration"],
      feedback: "Accepted answer: policy iteration.",
    },
  ],

  // Quiz 8 — Reinforcement learning basics
  "900138": [
    {
      id: "q1",
      type: "multichoice",
      mark: 1,
      text: "Q-learning is best described as:",
      options: [
        { id: "a", text: "An off-policy, model-free method that learns action values." },
        { id: "b", text: "A supervised classifier of states." },
        { id: "c", text: "A method that needs the exact transition model." },
        { id: "d", text: "An open-loop planning algorithm." },
      ],
      correct: "a",
      feedback:
        "Q-learning learns action-value estimates off-policy without a model of the environment.",
    },
    {
      id: "q2",
      type: "shortanswer",
      mark: 1,
      text: "Trading off trying new actions against using known-good ones is the ______–exploitation trade-off.",
      accept: ["exploration"],
      feedback: "Accepted answer: exploration–exploitation trade-off.",
    },
    {
      id: "q3",
      type: "truefalse",
      mark: 1,
      text: "In ε-greedy action selection, a larger ε means more exploration.",
      correct: true,
      feedback: "Correct — ε is the probability of choosing a random (exploratory) action.",
    },
  ],
};

/** A generic fallback so any quiz id is attemptable, even one not listed above. */
const fallbackQuestions: QuizQuestion[] = [
  {
    id: "q1",
    type: "multichoice",
    mark: 1,
    text: "A closed-loop control system uses which signal to compute its action?",
    options: [
      { id: "a", text: "The measured output fed back to the controller." },
      { id: "b", text: "Only the reference, ignoring the output." },
      { id: "c", text: "A random number." },
      { id: "d", text: "The controller's serial number." },
    ],
    correct: "a",
    feedback: "Closed-loop control acts on the error between reference and measured output.",
  },
  {
    id: "q2",
    type: "truefalse",
    mark: 1,
    text: "Negative feedback can reduce a system's sensitivity to disturbances.",
    correct: true,
    feedback: "Correct — that is one of the main reasons feedback is used.",
  },
  {
    id: "q3",
    type: "shortanswer",
    mark: 1,
    text: "The difference between the reference and the measured output is called the ______ signal.",
    accept: ["error"],
    feedback: "Accepted answer: error signal.",
  },
];

export function getQuizQuestions(id: string): QuizQuestion[] {
  return quizQuestions[id] ?? fallbackQuestions;
}
