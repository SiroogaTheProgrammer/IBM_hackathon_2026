import Link from "next/link";
import type { ReactNode } from "react";
import { ActivityIcon, ArrowRight, ChartIcon } from "@/components/Icons";
import type { ActivityKind } from "@/components/Icons";
import SafeLink from "@/components/SafeLink";
import { targetHref } from "@/data/activities";
import type {
  ContentBlock,
  CourseSection,
  InlineSpan,
  ListEntry,
  RichText,
} from "@/data/courses";

/* ============================================================ rich text === */

function InlineRun({ span }: { span: string | InlineSpan }) {
  if (typeof span === "string") return <>{span}</>;

  let node: ReactNode = span.text;
  if (span.bold) node = <strong>{node}</strong>;
  if (span.italic) node = <em>{node}</em>;

  if (!span.href) return <>{node}</>;

  if (span.href.startsWith("/")) {
    return <Link href={span.href}>{node}</Link>;
  }

  return (
    <a href={span.href} target="_blank" rel="noopener noreferrer">
      {node}
    </a>
  );
}

/** Renders a string or a run list of styled/linked spans. */
export function Rich({ value }: { value: RichText }) {
  if (typeof value === "string") return <>{value}</>;

  return (
    <>
      {value.map((span, index) => (
        <InlineRun key={index} span={span} />
      ))}
    </>
  );
}

function isNestedEntry(
  entry: ListEntry,
): entry is { text: RichText; items: ListEntry[] } {
  return typeof entry === "object" && !Array.isArray(entry);
}

function ListEntries({ entries }: { entries: ListEntry[] }) {
  return (
    <>
      {entries.map((entry, index) => {
        if (!isNestedEntry(entry)) {
          return (
            <li key={index}>
              <Rich value={entry} />
            </li>
          );
        }

        return (
          <li key={index}>
            <Rich value={entry.text} />
            <ul className="mt-1">
              <ListEntries entries={entry.items} />
            </ul>
          </li>
        );
      })}
    </>
  );
}

/* ============================================================ activities === */

export type ActivityRowProps = {
  kind: ActivityKind;
  name: string;
  /** The `/mod/<type>/<id>` page this activity opens. */
  href: string;
  meta?: string;
};

/**
 * One activity line in a section body: yellow circle + blue activity name,
 * linking to the activity's own page — this is how the General section's
 * "Announcements" forum is reached.
 */
export function ActivityRow({ kind, name, href, meta }: ActivityRowProps) {
  return (
    <div className="mc-list-row">
      <span className="mc-activity-icon">
        <ActivityIcon kind={kind} />
      </span>
      <div className="min-w-0">
        <SafeLink className="mc-link" href={href}>
          {name}
        </SafeLink>
        {meta ? <div className="mc-small mc-muted">{meta}</div> : null}
      </div>
    </div>
  );
}

/* ================================================================ blocks === */

function Block({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case "heading": {
      const Tag = `h${block.level}` as "h2" | "h3" | "h4";
      return <Tag>{block.text}</Tag>;
    }

    case "paragraph":
      return (
        <p>
          <Rich value={block.text} />
        </p>
      );

    case "list":
      return block.ordered ? (
        <ol>
          <ListEntries entries={block.items} />
        </ol>
      ) : (
        <ul>
          <ListEntries entries={block.items} />
        </ul>
      );

    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="mc-table">
            {block.caption ? <caption>{block.caption}</caption> : null}
            <thead>
              <tr>
                {block.headers.map((header) => (
                  <th key={header} scope="col">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>
                      <Rich value={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "activity":
      return (
        <ActivityRow
          kind={block.kind}
          name={block.name}
          href={targetHref(block.activityId)}
          meta={block.meta}
        />
      );
  }
}

/** The authored body of the General section. */
export function SectionBody({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </>
  );
}

/* =========================================================== band card === */

export type SectionBandProps = {
  section: CourseSection;
};

/**
 * A collapsed course section as it appears on the main course page: a light
 * gray card with the circular section marker, the section title, a go-to
 * arrow and the progress / resource summary.
 */
export default function SectionBand({ section }: SectionBandProps) {
  const anchor = `#${section.id}`;

  return (
    <section
      id={section.id}
      className="mc-section-band scroll-mt-[60px]"
      aria-label={section.name}
    >
      <span className="mc-section-marker" aria-hidden="true" />

      <div className="mc-section-band-main flex flex-col justify-between self-stretch">
        <h2 className="mc-section-band-title">
          <a href={anchor} className="text-inherit no-underline hover:underline">
            {section.name}
          </a>
        </h2>

        <div className="mt-2 flex flex-col items-end gap-1 text-right">
          {section.resourceCounts?.length ? (
            <div className="mc-small mc-muted flex flex-wrap justify-end gap-x-4">
              {section.resourceCounts.map((count) => (
                <span key={count}>{count}</span>
              ))}
            </div>
          ) : null}
          <div className="mc-section-band-meta mt-0">
            <ChartIcon size={15} />
            <span>
              Progress: {section.progress.done} / {section.progress.total}
            </span>
          </div>
        </div>
      </div>

      <a
        href={anchor}
        className="mc-section-band-arrow"
        aria-label={`Go to ${section.name}`}
      >
        <ArrowRight />
      </a>
    </section>
  );
}
