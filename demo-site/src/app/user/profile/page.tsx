import type { Metadata } from "next";
import type { ReactNode } from "react";
import Avatar from "@/components/Avatar";
import PageHeader from "@/components/PageHeader";
import SafeLink from "@/components/SafeLink";
import { Message } from "@/components/Icons";
import { getCurrentUser } from "@/data/currentUser";
import {
  badges,
  badgesIntro,
  courseProfiles,
  courseProfilesHeading,
  getUserDetails,
  lastAccess,
  miscellaneousLinks,
  mobileApp,
  privacyLinks,
  reportLinks,
} from "@/data/profile";
import type { ProfileLink } from "@/data/profile";

/** The tab title names the signed-in user, so it follows the switcher too. */
export async function generateMetadata(): Promise<Metadata> {
  const user = await getCurrentUser();

  return { title: `${user.fullName}: Public profile | MyCourses` };
}

/* ------------------------------------------------------------- fragments */

function ProfileCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mc-card">
      <div className="mc-card-header">
        <h2 className="mc-card-title">{title}</h2>
        {action}
      </div>
      <div className="mc-card-body">{children}</div>
    </section>
  );
}

/** A plain list of blue links — the shape every Moodle profile node uses. */
function LinkList({ links }: { links: ProfileLink[] }) {
  return (
    <ul>
      {links.map((link) => (
        <li key={link.id} className="py-[2px]">
          <SafeLink className="mc-link" href={link.href}>
            {link.label}
          </SafeLink>
        </li>
      ))}
    </ul>
  );
}

/**
 * Placeholder badge medallion. The real site serves a PNG per badge; a local
 * inline SVG keeps the page self-contained and fetches nothing personal.
 */
function BadgeMedallion() {
  return (
    <svg
      width="100"
      height="100"
      viewBox="0 0 100 100"
      role="img"
      aria-label="Badge"
      focusable="false"
    >
      <circle
        cx="50"
        cy="50"
        r="46"
        fill="var(--mc-tile-yellow)"
        stroke="var(--mc-dark)"
        strokeWidth="2"
      />
      <circle
        cx="50"
        cy="50"
        r="34"
        fill="none"
        stroke="var(--mc-dark)"
        strokeWidth="1.5"
        opacity="0.45"
      />
      <path
        d="M50 34 L54 44.5 L65.22 45.06 L56.47 52.1 L59.4 62.94 L50 56.8 L40.6 62.94 L43.53 52.1 L34.78 45.06 L46 44.5 Z"
        fill="var(--mc-dark)"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ page */

export default async function ProfilePage() {
  const user = await getCurrentUser();
  const userDetails = getUserDetails(user);

  return (
    <>
      <PageHeader variant="user">
        {/* dark pill overlapping the banner's bottom-left edge */}
        <div
          className="mc-container-fluid absolute inset-x-0"
          style={{ bottom: "-18px" }}
        >
          <button type="button" className="mc-btn mc-btn-dark mc-btn-sm">
            Reset page to default
          </button>
        </div>
      </PageHeader>

      <div className="mc-container-fluid pt-10 pb-6">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar size="lg" user={user} alt="" />
          <div>
            <h1 className="mc-h1">{user.fullName}</h1>
            <SafeLink className="mc-link inline-flex items-center gap-1.5" href="#">
              <Message size={16} />
              Message
            </SafeLink>
          </div>
        </div>

        <div className="mt-6 grid items-start gap-x-6 md:grid-cols-2">
          <div>
            <ProfileCard
              title="User details"
              action={
                <SafeLink className="mc-link mc-small" href="#">
                  Edit profile
                </SafeLink>
              }
            >
              <dl>
                {userDetails.map((detail, index) => (
                  <div key={detail.label} className={index > 0 ? "mt-3" : ""}>
                    <dt className="font-semibold">{detail.label}</dt>
                    <dd>
                      {detail.href ? (
                        <SafeLink className="mc-link" href={detail.href}>
                          {detail.value}
                        </SafeLink>
                      ) : (
                        detail.value
                      )}
                      {detail.note ? <span> {detail.note}</span> : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </ProfileCard>

            <ProfileCard title="Badges">
              <p>{badgesIntro}</p>
              {badges.map((badge) => (
                <figure
                  key={badge.id}
                  className="mt-4 flex flex-col items-center gap-2 text-center"
                >
                  <BadgeMedallion />
                  <figcaption>
                    <SafeLink className="mc-link" href={badge.href}>
                      {badge.label}
                    </SafeLink>
                  </figcaption>
                </figure>
              ))}
            </ProfileCard>

            <ProfileCard title="Privacy and policies">
              <LinkList links={privacyLinks} />
            </ProfileCard>
          </div>

          <div>
            <ProfileCard title="Course details">
              <p className="font-semibold">{courseProfilesHeading}</p>
              <div className="mt-1">
                <LinkList links={courseProfiles} />
              </div>
              <p className="mt-3 text-right">
                <SafeLink className="mc-link" href="#">
                  View more
                </SafeLink>
              </p>
            </ProfileCard>

            <ProfileCard title="Miscellaneous">
              <LinkList links={miscellaneousLinks} />
            </ProfileCard>

            <ProfileCard title="Reports">
              <LinkList links={reportLinks} />
            </ProfileCard>

            <ProfileCard title="Mobile app">
              <p className="font-semibold">{mobileApp.heading}</p>
              <p className="mt-1">{mobileApp.body}</p>
              <p className="mt-3">
                <button type="button" className="mc-btn mc-btn-dark mc-btn-sm">
                  {mobileApp.buttonLabel}
                </button>
              </p>
              <p className="mt-4 font-semibold">{lastAccess.heading}</p>
              <p>{lastAccess.value}</p>
            </ProfileCard>
          </div>
        </div>
      </div>
    </>
  );
}
