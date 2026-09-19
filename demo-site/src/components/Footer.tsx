import { ExternalLink } from "@/components/Icons";
import SafeLink from "@/components/SafeLink";
import { footerColumns } from "@/data/site";
import type { SiteUser } from "@/data/users";

export type FooterProps = {
  /** Signed-in user, resolved from the `mc-user` cookie by the root layout. */
  user: SiteUser;
};

/**
 * Site footer: thin orange rule, a right-aligned support pill, three link
 * columns (Aalto logo block / Students + Teachers / About service) and the
 * signed-in user line.
 */
export default function Footer({ user }: FooterProps) {
  const [students, teachers, about] = footerColumns;

  return (
    <footer className="mc-footer">
      <div className="mc-container">
        <div className="mc-footer-top">
          <SafeLink className="mc-btn mc-btn-dark" href="#">
            MyCourses support for students
            <ExternalLink />
          </SafeLink>
        </div>

        <div className="mc-footer-cols">
          <div className="mc-footer-logo">
            <AaltoLogoBlock />
          </div>

          <div>
            <FooterGroup heading={students.heading} links={students.links} />
            <FooterGroup heading={teachers.heading} links={teachers.links} />
          </div>

          <div>
            <FooterGroup heading={about.heading} links={about.links} />
          </div>
        </div>

        <div className="mc-footer-meta">
          {user.fullName} (
          <SafeLink className="mc-link" href="#">
            Log out
          </SafeLink>
          )
        </div>
        <div className="mc-footer-meta" style={{ marginTop: 4 }}>
          ?
        </div>
      </div>
    </footer>
  );
}

function FooterGroup({
  heading,
  links,
}: {
  heading: string;
  links: { label: string; href?: string }[];
}) {
  return (
    <div className="mc-footer-group">
      <div className="mc-footer-heading">{heading}</div>
      {links.map((link) => (
        <SafeLink
          key={link.label}
          className="mc-footer-link"
          href={link.href ?? "#"}
        >
          {link.label}
        </SafeLink>
      ))}
    </div>
  );
}

/**
 * The real Aalto "A!" wordmark from the live site (rendered 150x138 there).
 * A background colour is not needed — the PNG is transparent — but the alt
 * text carries the three-language name if the image fails to load.
 */
function AaltoLogoBlock() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="https://mycourses.aalto.fi/pluginfile.php/1/core_admin/logo/0x200/1702970326/aalto_logo_2.png"
      alt="Aalto-yliopisto, Aalto-universitetet, Aalto University"
      width={150}
      height={138}
      style={{ maxWidth: "100%", height: "auto" }}
    />
  );
}
