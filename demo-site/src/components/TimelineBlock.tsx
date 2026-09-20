"use client";

import { useMemo, useState } from "react";
import { BlockCard } from "@/components/BlockDrawer";
import Dropdown from "@/components/Dropdown";
import type { DropdownItem } from "@/components/Dropdown";
import { ActivityIcon, activityLabels } from "@/components/Icons";
import SafeLink from "@/components/SafeLink";
import { targetHref } from "@/data/activities";
import {
  timelineItems,
  timelineRanges,
  timelineSorts,
} from "@/data/dashboard";
import type {
  TimelineItem,
  TimelineRange,
  TimelineSort,
} from "@/data/dashboard";

type TimelineGroup = {
  heading: string;
  items: TimelineItem[];
};

/**
 * The Dashboard "Timeline" block: a range pill, a sort pill, a search box and
 * the date-grouped list of activities that require action. The filters are
 * real — they narrow and regroup the static list from `@/data/dashboard`.
 */
export default function TimelineBlock() {
  const [range, setRange] = useState<TimelineRange>(() => {
    const [first] = timelineRanges;
    return first ?? { label: "All", days: Number.POSITIVE_INFINITY };
  });
  const [sort, setSort] = useState<TimelineSort>("Sort by dates");
  const [query, setQuery] = useState("");

  const rangeItems: DropdownItem[] = timelineRanges.map((option) => ({
    label: option.label,
    traceId: `timeline.range.${option.days}`,
    onSelect: () => setRange(option),
  }));

  const sortItems: DropdownItem[] = timelineSorts.map((option) => ({
    label: option,
    traceId: `timeline.sort.${option === "Sort by dates" ? "dates" : "courses"}`,
    onSelect: () => setSort(option),
  }));

  const groups = useMemo<TimelineGroup[]>(() => {
    const needle = query.trim().toLowerCase();

    const visible = timelineItems.filter((item) => {
      if (item.offsetDays > range.days) return false;
      if (!needle) return true;
      return (
        item.title.toLowerCase().includes(needle) ||
        activityLabels[item.kind].toLowerCase().includes(needle) ||
        item.courseName.toLowerCase().includes(needle)
      );
    });

    const byCourse = sort === "Sort by courses";
    const order: string[] = [];
    const buckets = new Map<string, TimelineItem[]>();

    for (const item of visible) {
      const key = byCourse ? item.courseName : item.dateLabel;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(item);
      } else {
        buckets.set(key, [item]);
        order.push(key);
      }
    }

    if (byCourse) order.sort((a, b) => a.localeCompare(b));

    return order.map((heading) => ({
      heading,
      items: buckets.get(heading) ?? [],
    }));
  }, [query, range.days, sort]);

  return (
    <BlockCard title="Timeline">
      <div className="flex flex-wrap items-center gap-2">
        <Dropdown
          variant="pill"
          label={range.label}
          items={rangeItems}
          ariaLabel="Filter timeline by date range"
          traceId="timeline.range"
        />
        <Dropdown
          variant="pill"
          label={sort}
          items={sortItems}
          ariaLabel="Sort timeline"
          traceId="timeline.sort"
        />
        <div className="min-w-[220px] flex-1">
          <label className="mc-sr-only" htmlFor="timeline-search">
            Search by activity type or name
          </label>
          <input
            id="timeline-search"
            type="text"
            className="mc-input mc-input-pill"
            placeholder="Search by activity type or name"
            data-trace="timeline.search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="mc-muted mt-4 mb-0">
          No activities require action
          {query.trim() ? " for that search." : "."}
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.heading} className="mt-4">
            <h3 className="m-0 text-[15px] font-semibold">{group.heading}</h3>
            <hr className="mc-rule mt-1" />
            {group.items.map((item) => (
              <TimelineRow key={item.id} item={item} />
            ))}
          </div>
        ))
      )}
    </BlockCard>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  // The bold title opens the activity, like the action button already does;
  // only the gray sub-line still names the course.
  const activityHref = targetHref(item.activityId);

  return (
    <div className="mc-event">
      <span className="mc-small mc-muted w-[42px] shrink-0 pt-[6px]">
        {item.time}
      </span>
      <span className="mc-activity-icon mc-activity-icon--sm">
        <ActivityIcon kind={item.kind} size={16} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <SafeLink
            className="mc-link font-medium"
            href={activityHref}
            traceId={`timeline.item.${item.activityId}`}
          >
            {item.title}
          </SafeLink>
          {item.overdue ? <span className="mc-badge-danger">Overdue</span> : null}
        </div>
        <div className="mc-small mc-muted">
          {item.actionText} &middot;{" "}
          <SafeLink className="mc-link" href={item.courseHref}>
            {item.courseName}
          </SafeLink>
        </div>
      </div>

      <div className="shrink-0 self-center">
        <SafeLink
          className="mc-btn mc-btn-outline mc-btn-sm"
          href={item.buttonHref}
        >
          {item.buttonLabel}
        </SafeLink>
      </div>
    </div>
  );
}

