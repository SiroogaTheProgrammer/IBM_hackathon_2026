import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ActivityShell from "@/components/ActivityShell";
import AssignBody from "@/components/activity/AssignBody";
import FeedbackBody from "@/components/activity/FeedbackBody";
import ForumBody from "@/components/activity/ForumBody";
import QuizBody from "@/components/activity/QuizBody";
import { activityParams, getActivity } from "@/data/activities";
import type { Activity } from "@/data/activities";

type ActivityPageProps = {
  params: Promise<{ type: string; id: string }>;
};

/**
 * The module id alone identifies an activity, so `/mod/quiz/900101` (a forum
 * id under the quiz type) has to 404 the same way Moodle's own router would.
 */
function resolveActivity(type: string, id: string): Activity | undefined {
  const activity = getActivity(id);
  return activity && activity.type === type ? activity : undefined;
}

/** "CS-E9410 - Foundations of Pattern Discovery D, …" → "CS-E9410". */
function courseCode(courseTitle: string): string {
  const [code] = courseTitle.split(" - ");
  return code ?? courseTitle;
}

export function generateStaticParams() {
  return activityParams;
}

export async function generateMetadata({
  params,
}: ActivityPageProps): Promise<Metadata> {
  const { type, id } = await params;
  const activity = resolveActivity(type, id);

  if (!activity) return { title: "Activity" };

  return {
    title: `${courseCode(activity.courseTitle)}: ${activity.name} | MyCourses`,
  };
}

/** The type-specific body, rendered inside the shared activity shell. */
function ActivityBody({ activity }: { activity: Activity }) {
  switch (activity.type) {
    case "assign":
      return <AssignBody activity={activity} />;
    case "quiz":
      return <QuizBody />;
    case "feedback":
      return <FeedbackBody />;
    case "forum":
      return <ForumBody />;
  }
}

/**
 * `/mod/<type>/<id>` — one route for all four Moodle activity types. The
 * shell, the banner breadcrumb and the dates box are shared; only the body
 * below the dates box differs.
 */
export default async function ActivityPage({ params }: ActivityPageProps) {
  const { type, id } = await params;
  const activity = resolveActivity(type, id);

  if (!activity) notFound();

  return (
    <ActivityShell activity={activity}>
      <ActivityBody activity={activity} />
    </ActivityShell>
  );
}
