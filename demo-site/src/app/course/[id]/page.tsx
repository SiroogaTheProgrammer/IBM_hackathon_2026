import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BlockDrawer, { BlockCard, EventRow } from "@/components/BlockDrawer";
import CourseIndexDrawer from "@/components/CourseIndexDrawer";
import PageHeader from "@/components/PageHeader";
import SectionBand, { SectionBody } from "@/components/SectionBand";
import { buildCourseIndex, courseIds, getCourse } from "@/data/courses";

type CoursePageProps = {
  params: Promise<{ id: string }>;
};

export function generateStaticParams() {
  return courseIds.map((id) => ({ id }));
}

export async function generateMetadata({
  params,
}: CoursePageProps): Promise<Metadata> {
  const { id } = await params;
  const course = getCourse(id);

  // Moodle prefixes course-page titles with "Course: " — match it exactly.
  return { title: course ? `Course: ${course.title} | MyCourses` : "Course" };
}

export default async function CoursePage({ params }: CoursePageProps) {
  const { id } = await params;
  const course = getCourse(id);

  if (!course) notFound();

  const index = buildCourseIndex(course);
  const general = course.sections.find(
    (section) => section.kind === "general",
  );
  const bands = course.sections.filter((section) => section.kind === "band");

  return (
    <div className="flex items-start">
      <CourseIndexDrawer courseId={course.id} sections={index} />

      <main className="min-w-0 flex-1">
        <PageHeader variant="course">
          <div className="mc-banner-plate">
            <h1 className="mc-banner-title">{course.title}</h1>
          </div>
        </PageHeader>

        <div className="mc-container-course pt-4 pb-10">
          <div className="mb-5 flex flex-wrap justify-end gap-2">
            <button type="button" className="mc-btn mc-btn-dark">
              Course feedback
            </button>
            <button type="button" className="mc-btn mc-btn-dark">
              Syllabus
            </button>
          </div>

          {general ? (
            <section
              id={general.id}
              aria-label={general.name}
              className="mc-prose scroll-mt-[60px] mb-8"
            >
              <SectionBody blocks={general.blocks ?? []} />
            </section>
          ) : null}

          {bands.map((section) => (
            <SectionBand key={section.id} section={section} />
          ))}
        </div>
      </main>

      <BlockDrawer
        ariaLabel="Course blocks"
        className="sticky top-[51px] max-h-[calc(100vh-51px)] overflow-y-auto"
      >
        <BlockCard title="Latest announcements">
          <p className="mc-muted mc-small">
            (No announcements have been posted yet.)
          </p>
        </BlockCard>

        <BlockCard title="Upcoming events">
          {course.upcomingEvents.map((event) => (
            <EventRow
              key={`${event.title}-${event.date}`}
              kind={event.kind}
              title={event.title}
              date={event.date}
              href={event.href}
            />
          ))}
        </BlockCard>
      </BlockDrawer>
    </div>
  );
}
