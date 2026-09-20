"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown, ExternalLink } from "@/components/Icons";
import SafeLink from "@/components/SafeLink";
import { languages } from "@/data/site";
import {
  USER_COOKIE,
  USER_COOKIE_MAX_AGE,
  defaultUserId,
  type SiteUserId,
} from "@/data/users";

const AALTO_LOGO =
  "https://mycourses.aalto.fi/pluginfile.php/1/core_admin/logo/0x200/1789725245/aalto_logo_2.png";
const HAKA_LOGO =
  "https://mycourses.aalto.fi/theme/aalto_mycourses/pix/haka_login_vaaka_lg.jpg";

/**
 * The MyCourses login screen — a faithful copy of the live Aalto sign-in page,
 * with the one difference that matters for a study stimulus: there is no real
 * identity provider behind it. Every sign-in path (the big "Aalto login"
 * button, Haka, Shibboleth, and the local username/password form) resolves to
 * one of the two fictional users in `src/data/users.ts` and drops the `mc-user`
 * cookie the rest of the site reads. The password field accepts anything.
 *
 * Rendered by the `(auth)` group, so none of the signed-in chrome (navbar,
 * footer, biometrics widget) is present — exactly as the real login looks.
 */
export default function LoginView() {
  const router = useRouter();
  const [langOpen, setLangOpen] = useState(false);
  const [localOpen, setLocalOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  /**
   * Sign in as a fictional user: write the cookie the server layout reads,
   * then land on the dashboard. `refresh()` re-runs the server render so the
   * navbar avatar and footer sign-off show the right person immediately.
   */
  function enter(userId: SiteUserId): void {
    document.cookie = `${USER_COOKIE}=${userId}; path=/; max-age=${USER_COOKIE_MAX_AGE}; samesite=lax`;
    router.push("/my");
    router.refresh();
  }

  /** Any password is accepted; the username only picks which of the two users. */
  function submitLocal(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const who: SiteUserId =
      username.trim().toLowerCase() === "pekka" ? "pekka" : defaultUserId;
    enter(who);
  }

  return (
    <div className="mc-login">
      <div className="mc-login-top">
        <div className="mc-login-lang">
          <button
            type="button"
            className="mc-login-lang-btn"
            aria-haspopup="menu"
            aria-expanded={langOpen}
            onClick={() => setLangOpen((open) => !open)}
          >
            English (en)
            <ChevronDown size={14} />
          </button>
          {langOpen ? (
            <ul className="mc-login-lang-menu" role="menu">
              {languages.map((lang) => (
                <li key={lang.label} role="none">
                  <SafeLink
                    href={lang.href ?? "#"}
                    className="mc-login-lang-item"
                  >
                    {lang.label}
                  </SafeLink>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="mc-login-logo"
          src={AALTO_LOGO}
          alt="Aalto University"
          width={100}
          height={92}
        />
      </div>

      <div className="mc-login-band">
        <div className="mc-login-inner">
          <h1 className="mc-login-srtitle">Log in to MyCourses</h1>

          <div className="mc-login-grid">
            <div className="mc-login-options">
              <button
                type="button"
                className="mc-login-aalto"
                onClick={() => enter(defaultUserId)}
              >
                Aalto login
              </button>

              <SafeLink
                className="mc-login-info-link"
                href="https://it.aalto.fi/instructions/resetting-password-and-forgotten-password"
              >
                More information about Aalto Accounts and passwords
                <ExternalLink size={14} />
              </SafeLink>

              <p className="mc-login-openuni">
                For <strong>Aalto University Open University</strong> students
                <br />
                <SafeLink
                  className="mc-link"
                  href="https://www.aalto.fi/en/aalto-university-open-university/aalto-identity-and-it-account-student-information-systems-at-the"
                >
                  Aalto account and systems information.
                </SafeLink>
              </p>

              <button
                type="button"
                className="mc-login-haka"
                onClick={() => enter(defaultUserId)}
                aria-label="Haka login"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={HAKA_LOGO} alt="Haka login" width={225} height={67} />
              </button>

              <p className="mc-login-haka-note">
                If your organization is a member of{" "}
                <SafeLink
                  className="mc-link"
                  href="https://www.csc.fi/haka-kayttajatunnistusjarjestelma?inheritRedirect=true"
                >
                  HAKA federation
                </SafeLink>
                , you can use HAKA-login.
              </p>
            </div>

            <div className="mc-login-about">
              <h2 className="mc-h2">Tietoja palvelusta</h2>
              <p>
                Kirjautuaksesi palveluun tarvitset Aalto-yliopiston tunnuksen tai
                Haka-tunnuksen. Jos sinulla on kumpikin tunnus, käytä aina
                ensisijaisesti Aalto-yliopiston tunnusta.
              </p>

              <h2 className="mc-h2">Kirjautumisvaihtoehdot:</h2>
              <p>
                <strong>Aalto login:</strong> Aalto-yliopiston tunnuksen omaavat
                käyttäjät.
                <br />
                <strong>Haka login:</strong> muiden suomalaisten korkeakoulujen
                käyttäjät.
                <br />
                <strong>Kirjaudu vierailijana:</strong> rajoitettu näkymä
                joidenkin kurssien alueille.
              </p>
              <p>
                <strong>Kirjaudu-painike:</strong> paikallinen kirjautuminen.
                Ainoastaan hallinnon käyttämä kirjautumismenetelmä.
              </p>

              <h2 className="mc-h2">Info</h2>
              <p>
                When login to MyCourses service always use Aalto University login
                name and password if possible.
              </p>

              <h2 className="mc-h2">Log in options</h2>
              <p>
                <strong>Aalto login:</strong> for Aalto users
                <br />
                <strong>Haka login:</strong> all Finnish universities,
                polytechnics and research institutions.
                <br />
                <strong>Guest access:</strong> very limited view on some course
                spaces. To get student rights you always need to login.
              </p>
              <p>
                <strong>Login-button:</strong> local login used only by support.
              </p>
            </div>
          </div>

          <div className="mc-login-controls">
            <SafeLink className="mc-btn mc-btn-dark mc-login-pill" href="#">
              Cookies notice
            </SafeLink>
            <button
              type="button"
              className="mc-btn mc-btn-dark mc-login-pill"
              onClick={() => router.push("/")}
            >
              Use guest access
            </button>
          </div>

          <div className="mc-login-local">
            <button
              type="button"
              className="mc-login-toggle"
              aria-expanded={localOpen}
              onClick={() => setLocalOpen((open) => !open)}
            >
              Login
            </button>

            {localOpen ? (
              <form className="mc-login-form" onSubmit={submitLocal}>
                <label className="mc-login-srlabel" htmlFor="login-username">
                  Username
                </label>
                <input
                  id="login-username"
                  className="mc-input"
                  type="text"
                  placeholder="Username"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />

                <label className="mc-login-srlabel" htmlFor="login-password">
                  Password
                </label>
                <input
                  id="login-password"
                  className="mc-input"
                  type="password"
                  placeholder="Password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />

                <button type="submit" className="mc-login-submit">
                  Log in
                </button>

                <SafeLink className="mc-link mc-login-lost" href="#">
                  Lost password?
                </SafeLink>
              </form>
            ) : null}

            <h2 className="mc-h3 mc-login-shib-title">
              Log in using your account on:
            </h2>
            <button
              type="button"
              className="mc-link mc-login-shib"
              onClick={() => enter(defaultUserId)}
            >
              Shibboleth Login
            </button>
          </div>
        </div>
      </div>

      <div className="mc-login-footer" />
    </div>
  );
}
