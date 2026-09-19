/**
 * `/mod/feedback/<id>` — the questionnaire page. Generic by design: the clone
 * never shows the questions, only the pill that would open them and Moodle's
 * visibility note.
 */
export default function FeedbackBody() {
  return (
    <>
      <button type="button" className="mc-btn mc-btn-dark">
        Answer the questions...
      </button>

      <p className="mc-muted mt-4 mb-0">
        Your answers are visible to the teachers of this course.
      </p>
    </>
  );
}
