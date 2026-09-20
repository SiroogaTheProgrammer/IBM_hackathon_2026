"use client";

import { useState } from "react";
import type { Activity } from "@/data/activities";
import { getQuizQuestions, type QuizQuestion } from "@/data/quizzes";

/**
 * `/mod/quiz/<id>` — the quiz view page and its whole attempt flow.
 *
 * Moodle drives this off a database of attempts; the clone has no backend, so
 * the four states a participant walks through — the intro page, the attempt,
 * the summary, and the graded review — are held in client state and graded
 * here against the fake banks in `@/data/quizzes`. The point is a page that
 * *behaves* like a real quiz (radios, a text answer, question flags, a
 * navigation block, a submit confirmation) so the recorded pointer and
 * keystroke traces look like a genuine attempt.
 */
type Phase = "intro" | "attempt" | "summary" | "review";
type Answers = Record<string, string>;
type Flags = Record<string, boolean>;

const ATTEMPT_ID = "question";

function isAnswered(answer: string | undefined): boolean {
  return answer !== undefined && answer.trim() !== "";
}

function isCorrect(question: QuizQuestion, answer: string | undefined): boolean {
  if (answer === undefined) return false;
  switch (question.type) {
    case "multichoice":
      return answer === question.correct;
    case "truefalse":
      return answer === String(question.correct);
    case "shortanswer": {
      const given = answer.trim().toLowerCase();
      return question.accept.some((ok) => ok.trim().toLowerCase() === given);
    }
  }
}

export type QuizBodyProps = {
  activity: Activity;
};

export default function QuizBody({ activity }: QuizBodyProps) {
  const questions = getQuizQuestions(activity.id);
  const totalMark = questions.reduce((sum, q) => sum + q.mark, 0);

  const [phase, setPhase] = useState<Phase>("intro");
  const [answers, setAnswers] = useState<Answers>({});
  const [flags, setFlags] = useState<Flags>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  function startAttempt(): void {
    setAnswers({});
    setFlags({});
    setConfirmOpen(false);
    setPhase("attempt");
  }

  function setAnswer(questionId: string, value: string): void {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  }

  function toggleFlag(questionId: string): void {
    setFlags((current) => ({ ...current, [questionId]: !current[questionId] }));
  }

  function jumpTo(questionId: string): void {
    document
      .getElementById(`${ATTEMPT_ID}-${questionId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (phase === "intro") {
    return (
      <>
        <button
          type="button"
          className="mc-btn mc-btn-dark"
          data-trace="quiz.attempt"
          onClick={startAttempt}
        >
          Attempt quiz
        </button>

        <p className="mt-4 mb-1">Attempts allowed: 2</p>
        <p className="m-0">Grading method: Highest grade</p>
      </>
    );
  }

  if (phase === "summary") {
    return (
      <>
        <h3 className="mc-h2">Summary of attempt</h3>

        <div className="overflow-x-auto">
          <table className="mc-status-table mc-quiz-summary">
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {questions.map((question, index) => (
                <tr key={question.id}>
                  <td>{index + 1}</td>
                  <td>
                    {isAnswered(answers[question.id])
                      ? "Answer saved"
                      : "Not yet answered"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            className="mc-btn mc-btn-outline"
            data-trace="quiz.return"
            onClick={() => setPhase("attempt")}
          >
            Return to attempt
          </button>
          <button
            type="button"
            className="mc-btn mc-btn-dark"
            data-trace="quiz.submit"
            onClick={() => setConfirmOpen(true)}
          >
            Submit all and finish
          </button>
        </div>

        {confirmOpen ? (
          <ConfirmSubmit
            onCancel={() => setConfirmOpen(false)}
            onConfirm={() => {
              setConfirmOpen(false);
              setPhase("review");
            }}
          />
        ) : null}
      </>
    );
  }

  if (phase === "review") {
    const score = questions.reduce(
      (sum, q) => sum + (isCorrect(q, answers[q.id]) ? q.mark : 0),
      0,
    );
    const percent = totalMark > 0 ? Math.round((score / totalMark) * 100) : 0;

    return (
      <>
        <div className="mc-activity-box mc-quiz-result">
          <div>
            <strong>State:</strong> Finished
          </div>
          <div>
            <strong>Grade:</strong> {score.toFixed(2)} out of{" "}
            {totalMark.toFixed(2)} ({percent}%)
          </div>
        </div>

        {questions.map((question, index) => (
          <QuestionBox
            key={question.id}
            question={question}
            index={index}
            mode="review"
            answer={answers[question.id]}
            flagged={!!flags[question.id]}
            onAnswer={setAnswer}
            onToggleFlag={toggleFlag}
          />
        ))}

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            className="mc-btn mc-btn-dark"
            data-trace="quiz.finish-review"
            onClick={() => setPhase("intro")}
          >
            Finish review
          </button>
          <button
            type="button"
            className="mc-btn mc-btn-outline"
            data-trace="quiz.reattempt"
            onClick={startAttempt}
          >
            Re-attempt quiz
          </button>
        </div>
      </>
    );
  }

  // phase === "attempt"
  return (
    <div className="mc-quiz-layout">
      <div className="mc-quiz-main">
        {questions.map((question, index) => (
          <QuestionBox
            key={question.id}
            question={question}
            index={index}
            mode="attempt"
            answer={answers[question.id]}
            flagged={!!flags[question.id]}
            onAnswer={setAnswer}
            onToggleFlag={toggleFlag}
          />
        ))}

        <button
          type="button"
          className="mc-btn mc-btn-dark"
          data-trace="quiz.finish"
          onClick={() => setPhase("summary")}
        >
          Finish attempt ...
        </button>
      </div>

      <aside className="mc-quiz-nav" aria-label="Quiz navigation">
        <h3 className="mc-quiz-nav-title">Quiz navigation</h3>
        <div className="mc-quiz-nav-grid">
          {questions.map((question, index) => {
            const answered = isAnswered(answers[question.id]);
            const flagged = !!flags[question.id];
            return (
              <button
                key={question.id}
                type="button"
                className={
                  "mc-quiz-nav-btn" +
                  (answered ? " is-answered" : "") +
                  (flagged ? " is-flagged" : "")
                }
                aria-label={`Question ${index + 1}${
                  answered ? ", answer saved" : ", not yet answered"
                }`}
                data-trace={`quiz.nav.${question.id}`}
                onClick={() => jumpTo(question.id)}
              >
                {index + 1}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="mc-link mc-quiz-nav-finish"
          data-trace="quiz.finish-aside"
          onClick={() => setPhase("summary")}
        >
          Finish attempt ...
        </button>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------ question --- */

type QuestionBoxProps = {
  question: QuizQuestion;
  index: number;
  mode: "attempt" | "review";
  answer: string | undefined;
  flagged: boolean;
  onAnswer: (questionId: string, value: string) => void;
  onToggleFlag: (questionId: string) => void;
};

function QuestionBox({
  question,
  index,
  mode,
  answer,
  flagged,
  onAnswer,
  onToggleFlag,
}: QuestionBoxProps) {
  const review = mode === "review";
  const correct = isCorrect(question, answer);
  const gained = correct ? question.mark : 0;

  const statusLabel = review
    ? correct
      ? "Correct"
      : "Incorrect"
    : isAnswered(answer)
      ? "Answer saved"
      : "Not yet answered";

  return (
    <div id={`${ATTEMPT_ID}-${question.id}`} className="mc-que">
      <div className="mc-que-info">
        <div className="mc-que-num">
          Question <strong>{index + 1}</strong>
        </div>
        <div className="mc-que-meta">
          {!review ? (
            <button
              type="button"
              className={"mc-que-flag" + (flagged ? " is-flagged" : "")}
              aria-pressed={flagged}
              data-trace={`quiz.flag.${question.id}`}
              onClick={() => onToggleFlag(question.id)}
            >
              <FlagGlyph />
              {flagged ? "Remove flag" : "Flag question"}
            </button>
          ) : null}
          <span className="mc-que-mark">
            {review
              ? `Mark ${gained.toFixed(2)} out of ${question.mark.toFixed(2)}`
              : `Marked out of ${question.mark.toFixed(2)}`}
          </span>
          <span
            className={
              "mc-que-status" +
              (review ? (correct ? " is-correct" : " is-incorrect") : "")
            }
          >
            {statusLabel}
          </span>
        </div>
      </div>

      <div className="mc-que-content">
        <p className="mc-qtext">{question.text}</p>
        <AnswerArea
          question={question}
          review={review}
          answer={answer}
          onAnswer={onAnswer}
        />
        {review ? (
          <p className="mc-que-feedback">{question.feedback}</p>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- answers --- */

type AnswerAreaProps = {
  question: QuizQuestion;
  review: boolean;
  answer: string | undefined;
  onAnswer: (questionId: string, value: string) => void;
};

function AnswerArea({ question, review, answer, onAnswer }: AnswerAreaProps) {
  const name = `${ATTEMPT_ID}-${question.id}`;

  if (question.type === "shortanswer") {
    return (
      <label className="mc-answer-short">
        <span>Answer:</span>
        <input
          type="text"
          className="mc-input mc-answer-input"
          value={answer ?? ""}
          disabled={review}
          autoComplete="off"
          data-trace={`quiz.answer.${question.id}`}
          onChange={(event) => onAnswer(question.id, event.target.value)}
        />
      </label>
    );
  }

  const options =
    question.type === "multichoice"
      ? question.options
      : [
          { id: "true", text: "True" },
          { id: "false", text: "False" },
        ];
  const correctValue =
    question.type === "multichoice" ? question.correct : String(question.correct);

  return (
    <div className="mc-answer" role="radiogroup" aria-label="Answer options">
      {options.map((option) => {
        const selected = answer === option.id;
        const markClass = review
          ? option.id === correctValue
            ? " is-correct"
            : selected
              ? " is-incorrect"
              : ""
          : "";
        return (
          <label
            key={option.id}
            className={"mc-answer-option" + markClass}
            /*
             * The anchor sits on the label, not the radio: the whole row is
             * what a participant aims at, and a click on the text never
             * reaches the input in the DOM tree.
             */
            data-trace={`quiz.answer.${question.id}.${option.id}`}
          >
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={selected}
              disabled={review}
              onChange={() => onAnswer(question.id, option.id)}
            />
            <span>{option.text}</span>
          </label>
        );
      })}
    </div>
  );
}

/** Moodle's small outline flag next to "Flag question". */
function FlagGlyph() {
  return (
    <svg
      className="mc-que-flag-glyph"
      width="12"
      height="13"
      viewBox="0 0 12 13"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M1 1v11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        className="mc-que-flag-banner"
        d="M1.8 1.4h8.4l-1.8 2.6 1.8 2.6H1.8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---------------------------------------------------------------- modal --- */

function ConfirmSubmit({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="mc-modal-backdrop"
      role="presentation"
      onClick={onCancel}
    >
      <div
        className="mc-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quiz-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="quiz-confirm-title" className="mc-modal-title">
          Confirmation
        </h3>
        <p className="mc-modal-body">
          Once you submit, you will no longer be able to change your answers for
          this attempt.
        </p>
        <div className="mc-modal-actions">
          <button
            type="button"
            className="mc-btn mc-btn-outline"
            data-trace="quiz.confirm.cancel"
            onClick={onCancel}
          >
            Return to attempt
          </button>
          <button
            type="button"
            className="mc-btn mc-btn-dark"
            data-trace="quiz.confirm.submit"
            onClick={onConfirm}
          >
            Submit all and finish
          </button>
        </div>
      </div>
    </div>
  );
}
