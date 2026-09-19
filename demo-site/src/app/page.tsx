import HomeTabs from "@/components/HomeTabs";
import type { HomeTab } from "@/components/HomeTabs";
import PageHeader from "@/components/PageHeader";
import SafeLink from "@/components/SafeLink";
import { newsBlocks, type NewsBlock } from "@/data/news";

/**
 * `/` — the MyCourses front page: the 350px frontpage banner, the "MyCourses"
 * heading, the Home | Course feedback tab strip and the two news blocks.
 *
 * Only the tab strip is interactive, so it is the only client component here;
 * the news markup is rendered on the server and passed to it as a panel.
 */

function NewsBlockCard({ block }: { block: NewsBlock }) {
  return (
    <section className="mc-card mc-card--plain" aria-labelledby={`block-${block.id}`}>
      <div className="mc-card-header">
        <h2 className="mc-card-title" id={`block-${block.id}`}>
          {block.title}
        </h2>
      </div>
      <div className="mc-card-body">
        {block.groups.map((group, groupIndex) => (
          <div key={group.heading} className={groupIndex > 0 ? "mt-4" : ""}>
            <h3 className="m-0 text-[15px] font-bold leading-normal">
              {group.heading}
            </h3>
            <ul className="m-0 list-none p-0">
              {group.items.map((item, itemIndex) => (
                <li
                  key={item.title}
                  className={
                    itemIndex > 0 ? "border-t border-mc-border" : "border-0"
                  }
                >
                  <SafeLink href={item.href} className="mc-link-plain block py-[7px]">
                    {item.title}
                  </SafeLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

const tabs: HomeTab[] = [
  {
    id: "home",
    label: "Home",
    panel: (
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {newsBlocks.map((block) => (
          <NewsBlockCard key={block.id} block={block} />
        ))}
      </div>
    ),
  },
  {
    id: "course-feedback",
    label: "Course feedback",
    panel: (
      <div className="mc-muted" id="block-course-feedback">
        {/*
         * On the live site this tab is a link out to the course-feedback
         * dashboard rather than an in-page panel, so there is no ground-truth
         * copy to clone here; the strip stays clickable for the study.
         */}
      </div>
    ),
  },
];

export default function HomePage() {
  return (
    <>
      <PageHeader variant="home" />

      <div className="mc-page-title pt-5">
        <h1 className="mc-h1">MyCourses</h1>
      </div>
      <HomeTabs
        tabs={tabs}
        ariaLabel="Front page"
        tabsClassName="mc-tabs-full"
        panelClassName="mc-container-home pt-5 pb-10"
      />
    </>
  );
}
