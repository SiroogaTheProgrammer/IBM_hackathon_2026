"use client";

import Link from "next/link";
import { useState } from "react";
import { BlockCard } from "@/components/BlockDrawer";
import { ChevronLeft, ChevronRight } from "@/components/Icons";
import { recentCourses } from "@/data/dashboard";

/**
 * The "Recently accessed courses" block. The ‹ › controls page the carousel:
 * with three courses the track simply rotates, exactly what the live block
 * does once you reach either end of its list.
 */
export default function RecentCourses() {
  const [offset, setOffset] = useState(0);
  const total = recentCourses.length;

  const ordered = recentCourses.map(
    (_, index) => recentCourses[(index + offset) % total],
  );

  const step = (delta: number) => {
    setOffset((current) => (current + delta + total) % total);
  };

  return (
    <BlockCard
      title="Recently accessed courses"
      actions={
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="mc-kebab"
            aria-label="Previous courses"
            onClick={() => step(-1)}
          >
            <ChevronLeft />
          </button>
          <button
            type="button"
            className="mc-kebab"
            aria-label="Next courses"
            onClick={() => step(1)}
          >
            <ChevronRight />
          </button>
        </div>
      }
    >
      <div className="flex items-stretch gap-3 overflow-x-auto pb-1">
        {ordered.map((course) => (
          <Link
            key={course.id}
            href={course.href}
            className="flex min-w-[220px] flex-1 items-start gap-3 p-3"
            style={{
              border: "1px solid var(--mc-border)",
              borderRadius: "var(--mc-radius)",
            }}
          >
            <span className="mc-course-thumb" aria-hidden="true" />
            <span className="mc-link line-clamp-3 text-[14px] leading-[1.35]">
              {course.name}
            </span>
          </Link>
        ))}
      </div>
    </BlockCard>
  );
}
