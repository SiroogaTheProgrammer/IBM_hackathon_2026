import type { Metadata } from "next";
import BlockDrawer, { BlockCard, EventRow } from "@/components/BlockDrawer";
import PageHeader from "@/components/PageHeader";
import RecentCourses from "@/components/RecentCourses";
import TimelineBlock from "@/components/TimelineBlock";
import { upcomingEvents } from "@/data/dashboard";

export const metadata: Metadata = {
  title: "Dashboard | MyCourses",
};

/**
 * `/my` — the Moodle Dashboard: 200px user banner, the Timeline and
 * "Recently accessed courses" blocks in the main column, and the 315px
 * right-hand block drawer holding "Upcoming events".
 */
export default function DashboardPage() {
  return (
    <>
      <PageHeader variant="user" />

      <div className="flex w-full items-start">
        <main className="min-w-0 flex-1">
          <div className="mc-page-title pt-6">
            <h1 className="mc-h1">Dashboard</h1>
          </div>
          <div className="mc-container-wide pt-2 pb-8">
            <TimelineBlock />
            <RecentCourses />
          </div>
        </main>

        <BlockDrawer ariaLabel="Block drawer">
          <BlockCard title="Upcoming events">
            {upcomingEvents.map((event) => (
              <EventRow
                key={event.id}
                kind={event.kind}
                title={event.title}
                date={event.date}
                href={event.href}
              />
            ))}
          </BlockCard>
        </BlockDrawer>
      </div>
    </>
  );
}
