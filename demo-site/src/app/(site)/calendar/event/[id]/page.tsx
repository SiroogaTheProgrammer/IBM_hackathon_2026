import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import SafeLink from "@/components/SafeLink";
import { eventIds, getEvent } from "@/data/events";

type EventPageProps = {
  params: Promise<{ id: string }>;
};

export function generateStaticParams() {
  return eventIds.map((id) => ({ id }));
}

export async function generateMetadata({
  params,
}: EventPageProps): Promise<Metadata> {
  const { id } = await params;
  const event = getEvent(id);

  // Moodle prefixes calendar titles with "Calendar: ", as it does "Course: ".
  return { title: event ? `Calendar: ${event.name} | MyCourses` : "Calendar" };
}

/**
 * `/calendar/event/<id>` — one lecture, exercise session or deadline from the
 * "Upcoming events" drawers. No course index here: the calendar is a
 * user-level page on the real site, so it wears the user banner.
 */
export default async function CalendarEventPage({ params }: EventPageProps) {
  const { id } = await params;
  const event = getEvent(id);

  if (!event) notFound();

  const courseHref = `/course/${event.courseId}`;

  return (
    <>
      <PageHeader variant="user" />

      <div className="mc-page-title pt-6">
        <h1 className="mc-h1">Calendar</h1>
      </div>

      <div className="mc-container-course pt-2 pb-10">
        <h2 className="mc-h1">{event.name}</h2>

        <div className="mc-activity-box">
          <strong>When:</strong> {event.when}
        </div>

        <dl className="mc-deflist">
          <dt>Event type</dt>
          <dd>Course</dd>

          <dt>Course</dt>
          <dd>
            <SafeLink className="mc-link" href={courseHref}>
              {event.courseTitle}
            </SafeLink>
          </dd>

          <dt>Description</dt>
          <dd>{event.description}</dd>
        </dl>

        <p className="mt-4 mb-0">
          <SafeLink className="mc-link" href={courseHref}>
            Go to course
          </SafeLink>
        </p>
      </div>
    </>
  );
}
