import { Search } from "@/components/Icons";

/**
 * `/mod/forum/<id>` — the Announcements forum. Every cloned course has one
 * and all four are empty, so the page is the intro line, Moodle's search row
 * and the blue "nothing posted" notice.
 */
export default function ForumBody() {
  return (
    <>
      <div className="mc-activity-box">General news and announcements</div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="mc-help-circle"
          aria-label="Help with Search forums"
        >
          ?
        </button>

        {/* `.mc-input` is width:100%, so the wrapper is what sizes it. */}
        <div className="w-[260px]">
          <label className="mc-sr-only" htmlFor="forum-search">
            Search forums
          </label>
          <input
            id="forum-search"
            type="text"
            className="mc-input"
            placeholder="Search forums"
          />
        </div>

        <button
          type="button"
          className="mc-btn mc-btn-outline"
          aria-label="Search forums"
        >
          <Search size={16} />
        </button>
      </div>

      <div className="mc-activity-notice">
        (No announcements have been posted yet.)
      </div>
    </>
  );
}
