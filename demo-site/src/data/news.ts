/**
 * Front page news blocks.
 *
 * These are the two RSS-style blocks the live MyCourses front page renders
 * side by side ("News" and "For Students"), each grouped by feed, and each
 * feed repeated in Finnish, Swedish and English as the real front page does.
 *
 * Every headline here is INVENTED. The real front page carries actual Aalto
 * press headlines, some of which name identifiable people; this clone is a
 * study stimulus in a public repo, so it ships plausible filler of the same
 * shape and length instead. Do not paste real headlines back in.
 *
 * The articles behind them do not exist, so every target is "#" — the same
 * convention the rest of the clone uses so a click never navigates a study
 * participant off the site.
 */

export type NewsItem = {
  title: string;
  href: string;
};

/** One feed inside a block, e.g. "Aalto uutiset". */
export type NewsGroup = {
  heading: string;
  items: NewsItem[];
};

export type NewsBlock = {
  id: string;
  title: string;
  groups: NewsGroup[];
};

export const newsBlocks: NewsBlock[] = [
  {
    id: "news",
    title: "News",
    groups: [
      {
        heading: "Aalto uutiset",
        items: [
          {
            title:
              "Keramiikkapajan opiskelijatyöt esillä pohjoismaisessa muotoilukatselmuksessa Malmössä",
            href: "#",
          },
          {
            title:
              "Avoimen yliopiston kevätlukukauden ilmoittautuminen aukeaa 13.10.",
            href: "#",
          },
          {
            title:
              "Kampuksen uusi mittauslaboratorio otettiin käyttöön syyskuun alussa",
            href: "#",
          },
        ],
      },
      {
        heading: "Aalto nyheter",
        items: [
          {
            title:
              "Höstens motionskampanj startar – prova en ny gren varje vecka",
            href: "#",
          },
          {
            title:
              "Panelsamtal: hur förändrar automatiseringen av beräkningar det sätt vi undervisar grundkurser i teknik",
            href: "#",
          },
          {
            title: "Forskargruppen bygger en tystare vindtunnel för campus",
            href: "#",
          },
        ],
      },
      {
        heading: "Aalto news",
        items: [
          {
            title:
              "Student ceramics collective shows its autumn work at a Nordic design review",
            href: "#",
          },
          {
            title:
              "Joint programme in service design places fourth in a European teaching survey",
            href: "#",
          },
          {
            title:
              "A donated instrument collection gives the acoustics lab a second recording room",
            href: "#",
          },
        ],
      },
    ],
  },
  {
    id: "for-students",
    title: "For Students",
    groups: [
      {
        heading: "Opiskelijan opas, uutiset",
        items: [
          {
            title:
              "Kansainvälinen opiskelija: hae syksyn uraohjausohjelmaan 5.10.-19.10.",
            href: "#",
          },
          {
            title: "Muistathan turvallisemman tilan periaatteet opiskelussa",
            href: "#",
          },
          {
            title:
              "Opiskelijakeskuksen ovet auki arkisin klo 16.00 asti – iltaisin sisään kulkutunnisteella",
            href: "#",
          },
        ],
      },
      {
        heading: "Studentguide, nyheter",
        items: [
          {
            title: "Utbyte i Norden? Ansökan öppnar i oktober",
            href: "#",
          },
          {
            title:
              "Studenterna besökte ett vattenkraftverk under höstens fältvecka",
            href: "#",
          },
          {
            title:
              "Studentcentrets dörrar öppna vardagar till kl. 16.00 – kvällstid med passerkort",
            href: "#",
          },
        ],
      },
      {
        heading: "Student Guide, news",
        items: [
          {
            title: "Exchange in the Nordics? Applications open in October",
            href: "#",
          },
          {
            title:
              "Apply to the autumn career mentoring programme 5th October - 19th October",
            href: "#",
          },
          {
            title:
              "Students visited a hydropower plant during the autumn field week",
            href: "#",
          },
        ],
      },
    ],
  },
];
