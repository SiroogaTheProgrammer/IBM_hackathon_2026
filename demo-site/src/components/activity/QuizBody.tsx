/**
 * `/mod/quiz/<id>` — the quiz view page. The open/close window is already in
 * the shell's dates box, so all that is left is the attempt pill and the two
 * grading lines Moodle prints under it.
 */
export default function QuizBody() {
  return (
    <>
      <button type="button" className="mc-btn mc-btn-dark">
        Attempt quiz
      </button>

      <p className="mt-4 mb-1">Attempts allowed: 2</p>
      <p className="m-0">Grading method: Highest grade</p>
    </>
  );
}
