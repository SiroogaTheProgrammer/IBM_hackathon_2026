import type { ReactNode } from "react";
import CourseIndexDrawer from "@/components/CourseIndexDrawer";
import PageHeader from "@/components/PageHeader";
import SafeLink from "@/components/SafeLink";
import type { Activity } from "@/data/activities";
import { buildCourseIndex, getCourse } from "@/data/courses";

/** One breadcrumb segment; `href` is absent when the target is not cloned. */
type Crumb = {
  label: string;
  href?: string;
};

export type ActivityShellProps = {
  activity: Activity;
  /**
   * The body: the primary dark pill first, then the type-specific content.
   * The pill lives with the body because its label is per type and the forum
   * page has none at all.
   */
  children: ReactNode;
};

/**
 * The frame every `/mod/<type>/<id>` page shares — the course page's shell
 * minus the right block drawer: left course index with this activity current,
 * the course banner plate with a breadcrumb under the title, the two dark
 * pills, the 30px activity heading and the gray dates box.
 *
 * An activity whose course is outside the cloned route set (CS-E9880) has no
 * index to show, so it renders drawerless and its breadcrumb is plain text.
 */
export default function ActivityShell({
  activity,
  children,
}: ActivityShellProps) {
  const course = activity.courseId ? getCourse(activity.courseId) : undefined;
  const sections = course ? buildCourseIndex(course) : null;

  const crumbs: Crumb[] = [
    {
      label: "Main course page",
      href: course ? `/course/${course.id}` : undefined,
    },
    {
      label: activity.sectionName,
      href:
        course && activity.sectionId
          ? `/course/${course.id}#${activity.sectionId}`
          : undefined,
    },
    { label: activity.name },
  ];

  return (
    <div className="flex items-start">
      {course && sections ? (
        <CourseIndexDrawer
          courseId={course.id}
          sections={sections}
          activeActivityId={activity.id}
        />
      ) : null}

      <main className="min-w-0 flex-1">
        <PageHeader variant="course">
          <div className="mc-banner-plate">
            <h1 className="mc-banner-title">{activity.courseTitle}</h1>
            <nav className="mc-crumbs" aria-label="Breadcrumb">
              {crumbs.map((crumb, position) => (
                <span key={position}>
                  {position > 0 ? (
                    <span className="mc-crumb-sep"> / </span>
                  ) : null}
                  {crumb.href ? (
                    <SafeLink className="mc-link" href={crumb.href}>
                      {crumb.label}
                    </SafeLink>
                  ) : (
                    <span>{crumb.label}</span>
                  )}
                </span>
              ))}
            </nav>
          </div>
        </PageHeader>

        <div className="mc-container-activity pt-4 pb-10">
          <div className="mb-5 flex flex-wrap justify-end gap-2">
            <button type="button" className="mc-btn mc-btn-dark">
              Course feedback
            </button>
            <button type="button" className="mc-btn mc-btn-dark">
              Syllabus
            </button>
          </div>

          {/* 30px / 500 — the same face as `.mc-h1`, on an h2. */}
          <h2 className="mc-h1">{activity.name}</h2>

          {activity.dates.length > 0 ? (
            <div className="mc-activity-box">
              {activity.dates.map((date) => (
                <div key={date.label}>
                  <strong>{date.label}:</strong> {date.value}
                </div>
              ))}
            </div>
          ) : null}

          {children}
        </div>
      </main>
    </div>
  );
}
