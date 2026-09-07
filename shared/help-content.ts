export interface HelpArticle {
  id: string;
  title: string;
  summary: string;
  keywords: string[];
  body: string;
}

/**
 * The reviewed, app-only help source used by both the searchable guide and
 * the grounded assistant. Keep this list concise and update the version when
 * a workflow meaningfully changes.
 */
export const HELP_CONTENT_VERSION = 1;

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "dashboard",
    title: "Start on the Dashboard",
    summary: "Create, find, organize, and manage counting sessions.",
    keywords: ["dashboard", "session", "folder", "search", "sort"],
    body: "Create a session with the plus button. Search by name or location, sort by date, name, reels, or footage, and organize sessions in folders.",
  },
  {
    id: "full-mode",
    title: "Count reels in Full Mode",
    summary: "Annotate photos, place pins, enter reel details, and review results.",
    keywords: ["photo", "pin", "entry", "reel", "flagged", "review", "export"],
    body: "Upload a photo, place pins over reels, and save the matching catalog and footage details. Use Flagged and Review to resolve issues, then export PDF or Excel results.",
  },
  {
    id: "mobile-flow",
    title: "Capture with Mobile Flow",
    summary: "Take warehouse photos quickly from a phone.",
    keywords: ["mobile", "phone", "capture", "camera", "offline", "upload"],
    body: "Set the aisle and section, capture or choose a photo, and continue to the next section. Uploads can queue while offline and sync when the connection returns.",
  },
  {
    id: "collaboration",
    title: "Collaborate safely",
    summary: "Share sessions with editors and viewers.",
    keywords: ["team", "share", "editor", "viewer", "collaboration"],
    body: "Owners can invite collaborators and choose Editor or Viewer access. Editors can make changes; Viewers can only view the session.",
  },
  {
    id: "settings",
    title: "Use Settings",
    summary: "Manage profile, preferences, catalog entries, and support.",
    keywords: ["settings", "theme", "accessibility", "feedback", "help"],
    body: "Settings includes display and accessibility preferences, wire catalog entries, storage information, feedback, and a way to replay the welcome guide.",
  },
];

export const HELP_SOURCE_TEXT = HELP_ARTICLES
  .map((article) => `## ${article.title}\n${article.body}`)
  .join("\n\n");