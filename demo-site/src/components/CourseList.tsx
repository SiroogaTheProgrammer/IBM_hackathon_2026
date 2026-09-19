"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import Dropdown from "@/components/Dropdown";
import type { DropdownItem } from "@/components/Dropdown";
import { Close, Kebab, Star } from "@/components/Icons";
import { routes } from "@/data/site";
import { courseFilters, courseSorts } from "@/data/myCourses";
import type {
  CourseFilterValue,
  CourseSortValue,
  MyCourse,
} from "@/data/myCourses";

export type CourseListProps = {
  courses: MyCourse[];
};

/**
 * The course-overview block of /my/courses: filter pill, live search, sort
 * pill and the list rows with their per-course kebab menu. Starring and
 * "remove from view" are local-only state, but they really do drive the
 * filter — nothing here talks to a backend.
 */
export default function CourseList({ courses }: CourseListProps) {
  const [filter, setFilter] = useState<CourseFilterValue>("inprogress");
  const [sort, setSort] = useState<CourseSortValue>("name");
  const [search, setSearch] = useState("");
  const [starred, setStarred] = useState<number[]>([]);
  const [removed, setRemoved] = useState<number[]>([]);

  const filterLabel =
    courseFilters.find((option) => option.value === filter)?.label ??
    "In progress";
  const sortLabel =
    courseSorts.find((option) => option.value === sort)?.label ??
    "Sort by course name";

  const query = search.trim().toLowerCase();

  const visible = useMemo(() => {
    const matched = courses.filter((course) => {
      const isRemoved = removed.includes(course.id);

      if (filter === "removed") {
        if (!isRemoved) return false;
      } else if (filter === "starred") {
        if (isRemoved || !starred.includes(course.id)) return false;
      } else if (filter !== "all") {
        if (isRemoved || course.status !== filter) return false;
      }

      if (query.length === 0) return true;
      return `${course.name} ${course.department}`
        .toLowerCase()
        .includes(query);
    });

    return matched.sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : Date.parse(b.lastAccessed) - Date.parse(a.lastAccessed),
    );
  }, [courses, filter, query, removed, sort, starred]);

  const toggleId = (
    setIds: Dispatch<SetStateAction<number[]>>,
    id: number,
  ) => {
    setIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 py-3">
        <Dropdown
          variant="pill"
          label={filterLabel}
          items={courseFilters.map<DropdownItem>((option) => ({
            label: option.label,
            onSelect: () => setFilter(option.value),
          }))}
        />

        <div className="relative min-w-[170px] flex-1">
          <input
            type="text"
            className="mc-input mc-input-pill"
            style={{ paddingLeft: "16px", paddingRight: "34px" }}
            placeholder="Search"
            aria-label="Search courses"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search.length > 0 ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearch("")}
              style={{
                position: "absolute",
                right: "6px",
                top: "50%",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "24px",
                height: "24px",
                transform: "translateY(-50%)",
                color: "var(--mc-muted)",
                background: "none",
                border: 0,
                borderRadius: "50%",
                cursor: "pointer",
              }}
            >
              <Close size={16} />
            </button>
          ) : null}
        </div>

        <Dropdown
          variant="pill"
          align="right"
          label={sortLabel}
          items={courseSorts.map<DropdownItem>((option) => ({
            label: option.label,
            onSelect: () => setSort(option.value),
          }))}
        />
      </div>

      {visible.length === 0 ? (
        <p className="mc-muted" style={{ padding: "24px 0" }}>
          No courses
        </p>
      ) : (
        <div>
          {visible.map((course) => {
            const isStarred = starred.includes(course.id);
            const isRemoved = removed.includes(course.id);

            return (
              <div className="mc-list-row" key={course.id}>
                <Link
                  href={routes.course(course.id)}
                  className="mc-course-tile"
                  tabIndex={-1}
                  aria-hidden="true"
                />

                <div className="min-w-0 flex-1">
                  <Link href={routes.course(course.id)} className="mc-link">
                    {course.name}
                  </Link>
                  {isStarred ? (
                    <span
                      style={{
                        display: "inline-flex",
                        verticalAlign: "-2px",
                        marginLeft: "6px",
                        color: "var(--mc-muted)",
                      }}
                    >
                      <Star size={14} title="Starred" />
                    </span>
                  ) : null}
                  <div className="mc-small mc-muted">{course.department}</div>
                </div>

                <Dropdown
                  variant="pill"
                  className="mc-kebab"
                  align="right"
                  hideChevron
                  ariaLabel={`Actions for ${course.name}`}
                  label={<Kebab size={18} className="shrink-0" />}
                  items={[
                    {
                      label: isStarred
                        ? "Unstar this course"
                        : "Star this course",
                      onSelect: () => toggleId(setStarred, course.id),
                    },
                    {
                      label: isRemoved
                        ? "Restore to view"
                        : "Remove from view",
                      onSelect: () => toggleId(setRemoved, course.id),
                    },
                  ]}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
