import type { Activity } from "@/data/activities";

/** One row of the submission-status table. */
type StatusRow = {
  label: string;
  value: string;
  /** Moodle prints an overdue "Time remaining" in red. */
  danger?: boolean;
};

export type AssignBodyProps = {
  activity: Activity;
};

/**
 * `/mod/assign/<id>` — the submission page: the "Add submission" pill and the
 * four-row status table. Nothing is ever submitted in the clone, so the first
 * three rows are Moodle's own empty-state wording.
 */
export default function AssignBody({ activity }: AssignBodyProps) {
  const rows: StatusRow[] = [
    { label: "Submission status", value: "No submissions have been made yet" },
    { label: "Grading status", value: "Not graded" },
    {
      label: "Time remaining",
      value: activity.timeRemaining ?? "-",
      danger: activity.overdue,
    },
    { label: "Last modified", value: "-" },
  ];

  return (
    <>
      <button type="button" className="mc-btn mc-btn-dark">
        Add submission
      </button>

      <h3 className="mc-h2 mt-6">Submission status</h3>

      <div className="overflow-x-auto">
        <table className="mc-status-table">
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td className={row.danger ? "mc-text-danger" : undefined}>
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
