export { sessions, users } from "./models/auth";
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  serial,
  integer,
  real,
  timestamp,
  boolean,
  uniqueIndex,
  index,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Table relationships overview ────────────────────────────────────────────
//
// folders
//   └─ countingSessions (folderId → folders.id, SET NULL on delete)
//        ├─ sessionCollaborators (sessionId → countingSessions.id, CASCADE)
//        ├─ sessionInviteLinks   (sessionId → countingSessions.id, CASCADE)
//        ├─ activityLogs         (sessionId → countingSessions.id, CASCADE)
//        ├─ comments             (sessionId → countingSessions.id, CASCADE)
//        ├─ scanResults          (sessionId → countingSessions.id, CASCADE)
//        ├─ dismissedDuplicates  (sessionId → countingSessions.id, CASCADE)
//        ├─ reviewResponses      (sessionId → countingSessions.id, CASCADE)
//        └─ photos (sessionId → countingSessions.id, CASCADE)
//             ├─ photos.parentPhotoId → photos.id (SET NULL) — detail-shot link (see below)
//             ├─ pins  (photoId → photos.id, CASCADE)
//             │    └─ pins.entryId → entries.id (SET NULL) — pin committed once entry saved
//             └─ entries (photoId → photos.id, SET NULL)
//
// Detail-shot pattern: a "detail shot" is a close-up photo taken to clarify a
// specific reel on a wider overview photo. photos.isDetailShot = true on the
// close-up; photos.parentPhotoId points back to the overview photo it belongs
// to; photos.linkedPinLabel names the pin on the overview that this detail
// shot resolves. When an entry is saved for a detail shot, storage
// automatically finds the matching pin on the parent photo and sets its
// entryId (resolveParentPinForDetailShot), completing the pin-entry link.
//
// ─────────────────────────────────────────────────────────────────────────────

export const folders = pgTable("folders", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  parentFolderId: integer("parent_folder_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("folders_user_id_idx").on(table.userId),
]);

// status: "active" | "completed" — toggled by the user; drives badge display
//   and stats bucketing. Enforced by a DB CHECK constraint.
// isLocked: prevents entry edits when true; the owner can still unlock.
// deletedAt: soft-delete timestamp. NULL = live session; non-NULL = in trash.
//   Sessions with deletedAt older than the configured retention window are
//   permanently purged by a scheduled job (getExpiredTrashSessions).
// lastPhotoIndex: monotonically increasing counter used to generate sequential
//   "Photo #N" labels; incremented on each photo upload, never decremented.
export const countingSessions = pgTable("counting_sessions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  folderId: integer("folder_id").references(() => folders.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  location: text("location"),
  description: text("description"),
  status: text("status").notNull().default("active"),
  isLocked: boolean("is_locked").default(false).notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  lastUpdatedAt: timestamp("last_updated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  lastPhotoIndex: integer("last_photo_index").default(0),
  deletedAt: timestamp("deleted_at"),
  // reviewCohort: JSON-encoded sorted array of { userId, username } objects.
  // Set once (server-side) when the first review response is submitted for this
  // session. All clients read this value so every reviewer computes identical
  // entry→reviewer mappings regardless of join timing.
  reviewCohort: text("review_cohort"),
}, (table) => [
  index("counting_sessions_user_id_idx").on(table.userId),
  check("counting_sessions_status_check", sql`${table.status} IN ('active', 'completed')`),
]);

// isDetailShot / parentPhotoId / linkedPinLabel:
//   These three fields together implement the detail-shot feature. See the
//   table relationships overview at the top of this file for the full pattern.
//   parentPhotoId is a self-referential FK (SET NULL on delete) so removing the
//   overview photo demotes the detail shot to a standalone photo rather than
//   cascading a delete.
// pinScale: user-controlled zoom factor for the pin overlay canvas (default 1×).
// rotation: degrees clockwise applied in the UI (0, 90, 180, 270).
export const photos = pgTable("photos", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => countingSessions.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  uploadedBy: text("uploaded_by"),
  objectStorageKey: text("object_storage_key").notNull(),
  originalFilename: text("original_filename"),
  mimeType: text("mime_type"),
  width: integer("width"),
  height: integer("height"),
  exifTimestamp: timestamp("exif_timestamp"),
  exifGps: text("exif_gps"),
  rotation: integer("rotation").default(0),
  aisle: text("aisle"),
  section: text("section"),
  notes: text("notes"),
  isDetailShot: boolean("is_detail_shot").default(false),
  parentPhotoId: integer("parent_photo_id"),
  linkReason: text("link_reason"),
  linkedPinLabel: text("linked_pin_label"),
  pinScale: real("pin_scale").default(1),
  fileSize: integer("file_size"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("photos_session_id_idx").on(table.sessionId),
  index("photos_parent_photo_id_idx").on(table.parentPhotoId),
  index("photos_object_storage_key_idx").on(table.objectStorageKey),
  foreignKey({ columns: [table.parentPhotoId], foreignColumns: [table.id] }).onDelete("set null"),
]);

export const entries = pgTable("entries", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => countingSessions.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  photoId: integer("photo_id").references(() => photos.id, { onDelete: "set null" }),
  aisle: text("aisle").notNull(),
  section: text("section").notNull(),
  position: text("position"),
  palletId: text("pallet_id"),
  reelTag: text("reel_tag"),
  wireType: text("wire_type"),
  gauge: text("gauge"),
  footage: integer("footage"),
  reelCount: integer("reel_count").default(1),
  color: text("color"),
  manufacturer: text("manufacturer"),
  notes: text("notes"),
  conductors: text("conductors"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("entries_session_id_idx").on(table.sessionId),
  index("entries_photo_id_idx").on(table.photoId),
]);

// Pins are positioned markers overlaid on a photo (xPercent/yPercent are 0–100
// relative to the image dimensions). A pin starts "uncommitted" (entryId IS
// NULL) and becomes committed once the user saves an inventory entry for it.
// Uncommitted pins appear in the "incomplete pins" count and alert badge.
// flagged / flagReason: a reviewer can flag a pin for follow-up; flagged pins
//   with no entryId are surfaced in the data-quality stats dashboard.
export const pins = pgTable("pins", {
  id: serial("id").primaryKey(),
  photoId: integer("photo_id").notNull().references(() => photos.id, { onDelete: "cascade" }),
  entryId: integer("entry_id").references(() => entries.id, { onDelete: "set null" }),
  xPercent: real("x_percent").notNull(),
  yPercent: real("y_percent").notNull(),
  label: text("label"),
  reelCount: integer("reel_count").default(1),
  wireDetails: text("wire_details"),
  vendorCode: text("vendor_code"),
  footage: integer("footage"),
  flagged: boolean("flagged").default(false),
  flagReason: text("flag_reason"),
  draftClientId: text("draft_client_id"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("pins_photo_id_idx").on(table.photoId),
  index("pins_entry_id_idx").on(table.entryId),
  index("pins_label_idx").on(table.label),
  // Prevents duplicate labels on the same photo. NULL labels (draft pins) are
  // considered distinct in PostgreSQL unique indexes so multiple draft pins per
  // photo are still allowed.
  uniqueIndex("pins_photo_label_unique").on(table.photoId, table.label),
  // Stable per-row upsert key for draft pins. PostgreSQL unique indexes treat
  // NULLs as distinct, so rows with draftClientId=NULL are never constrained.
  uniqueIndex("pins_photo_draft_client_id_unique").on(table.photoId, table.draftClientId),
]);


export const sessionCollaborators = pgTable("session_collaborators", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => countingSessions.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  username: text("username"),
  role: text("role").notNull().default("editor"),
  addedAt: timestamp("added_at").defaultNow().notNull(),
}, (table) => [
  index("session_collaborators_session_id_idx").on(table.sessionId),
  check("session_collaborators_role_check", sql`${table.role} IN ('owner', 'editor', 'viewer')`),
]);

export const sessionInviteLinks = pgTable("session_invite_links", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => countingSessions.id, { onDelete: "cascade" }),
  token: varchar("token").notNull().unique(),
  createdBy: varchar("created_by").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  usedCount: integer("used_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
}, (table) => [
  index("session_invite_links_session_id_idx").on(table.sessionId),
]);

export const userSettings = pgTable("user_settings", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().unique(),
  encodingEnabled: boolean("encoding_enabled").notNull().default(false),
  encryptionKey: text("encryption_key"),
  encryptionSalt: text("encryption_salt"),
  defaultExportFormat: varchar("default_export_format", { length: 10 }).notNull().default("pdf"),
  companyName: text("company_name"),
  companyLogoKey: text("company_logo_key"),
  exportFooterText: text("export_footer_text"),
  photoQuality: integer("photo_quality").notNull().default(85),
  useReceivingQuality: boolean("use_receiving_quality").notNull().default(true),
  receivingPhotoQuality: integer("receiving_photo_quality").notNull().default(40),
  useOnFloorQuality: boolean("use_on_floor_quality").notNull().default(true),
  onFloorPhotoQuality: integer("on_floor_photo_quality").notNull().default(40),
  defaultAislePrefix: text("default_aisle_prefix"),
  sectionAdvanceStep: integer("section_advance_step").notNull().default(1),
  defaultUnit: varchar("default_unit", { length: 10 }).notNull().default("feet"),
  defaultTheme: varchar("default_theme", { length: 10 }).notNull().default("system"),
  thumbnailSize: varchar("thumbnail_size", { length: 10 }).notNull().default("medium"),
  largerTouchTargets: boolean("larger_touch_targets").notNull().default(false),
  textSize: varchar("text_size", { length: 20 }).notNull().default("default"),
  timezone: varchar("timezone", { length: 50 }).notNull().default("America/Chicago"),
  customVendorCodes: text("custom_vendor_codes").array().notNull().default(sql`'{}'::text[]`),
  testerPassword: text("tester_password"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("user_settings_user_id_idx").on(table.userId),
]);

export const activityLogs = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => countingSessions.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  username: text("username"),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  details: text("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("activity_logs_session_id_idx").on(table.sessionId),
  index("activity_logs_user_id_idx").on(table.userId),
]);

export const comments = pgTable("comments", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => countingSessions.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  username: text("username"),
  entryId: integer("entry_id").references(() => entries.id, { onDelete: "cascade" }),
  photoId: integer("photo_id").references(() => photos.id, { onDelete: "cascade" }),
  parentCommentId: integer("parent_comment_id"),
  text: text("text").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("comments_session_id_idx").on(table.sessionId),
  index("comments_entry_id_idx").on(table.entryId),
  index("comments_photo_id_idx").on(table.photoId),
  foreignKey({ columns: [table.parentCommentId], foreignColumns: [table.id] }).onDelete("cascade"),
]);

export const insertFolderSchema = createInsertSchema(folders).omit({
  id: true,
  createdAt: true,
  deletedAt: true,
});

export const insertSessionSchema = createInsertSchema(countingSessions).omit({
  id: true,
  startedAt: true,
  lastUpdatedAt: true,
  completedAt: true,
  deletedAt: true,
});

export const insertPhotoSchema = createInsertSchema(photos).omit({
  id: true,
  createdAt: true,
});

export const insertEntrySchema = createInsertSchema(entries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPinSchema = createInsertSchema(pins).omit({
  id: true,
  updatedAt: true,
});


export const insertCollaboratorSchema = createInsertSchema(sessionCollaborators).omit({
  id: true,
  addedAt: true,
});

export const insertInviteLinkSchema = createInsertSchema(sessionInviteLinks).omit({
  id: true,
  createdAt: true,
});

export type InsertFolder = z.infer<typeof insertFolderSchema>;
export type Folder = typeof folders.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof countingSessions.$inferSelect;
export type InsertPhoto = z.infer<typeof insertPhotoSchema>;
export type Photo = typeof photos.$inferSelect;
export type InsertEntry = z.infer<typeof insertEntrySchema>;
export type Entry = typeof entries.$inferSelect;
export type InsertPin = z.infer<typeof insertPinSchema>;
export type Pin = typeof pins.$inferSelect;

export type InsertCollaborator = z.infer<typeof insertCollaboratorSchema>;
export type Collaborator = typeof sessionCollaborators.$inferSelect;
export type InsertInviteLink = z.infer<typeof insertInviteLinkSchema>;
export type InviteLink = typeof sessionInviteLinks.$inferSelect;

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({
  id: true,
  createdAt: true,
});

export const insertCommentSchema = createInsertSchema(comments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type UserSettings = typeof userSettings.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertComment = z.infer<typeof insertCommentSchema>;
export type Comment = typeof comments.$inferSelect;

export const feedback = pgTable("feedback", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  topic: text("topic").notNull(),
  message: text("message").notNull(),
  page: text("page"),
  status: text("status").notNull().default("PENDING"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  check("feedback_status_check", sql`${table.status} IN ('PENDING', 'REVIEWED', 'RESOLVED')`),
]);

export const insertFeedbackSchema = createInsertSchema(feedback).omit({
  id: true,
  createdAt: true,
  status: true,
});

export type Feedback = typeof feedback.$inferSelect;
export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;

export const scanResults = pgTable("scan_results", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => countingSessions.id, { onDelete: "cascade" }),
  photoId: integer("photo_id").notNull().references(() => photos.id, { onDelete: "cascade" }),
  pinId: integer("pin_id").notNull().unique().references(() => pins.id, { onDelete: "cascade" }),
  pinLabel: text("pin_label"),
  rawText: text("raw_text"),
  readable: boolean("readable").default(false),
  scannedBy: varchar("scanned_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("scan_results_session_id_idx").on(table.sessionId),
  index("scan_results_photo_id_idx").on(table.photoId),
]);

export const insertScanResultSchema = createInsertSchema(scanResults).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ScanResult = typeof scanResults.$inferSelect;
export type InsertScanResult = z.infer<typeof insertScanResultSchema>;

export const dismissedDuplicates = pgTable("dismissed_duplicates", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => countingSessions.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  dismissedAt: timestamp("dismissed_at").defaultNow().notNull(),
}, (table) => [
  index("dismissed_duplicates_session_id_idx").on(table.sessionId),
  index("dismissed_duplicates_key_idx").on(table.key),
  index("dismissed_duplicates_session_key_idx").on(table.sessionId, table.key),
]);

export type DismissedDuplicate = typeof dismissedDuplicates.$inferSelect;

export const userWireCatalogs = pgTable("user_wire_categories", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  catalog: text("catalog").notNull(),
  vendor: text("vendor").notNull(),
  reelLength: integer("reel_length").notNull(),
  description: text("description"),
  color: text("color"),
  jacketType: text("jacket_type"),
  conductors: text("conductors"),
  groundSize: text("ground_size"),
  wireType: text("wire_type"),
}, (table) => [
  index("user_wire_categories_user_id_idx").on(table.userId),
]);

export const insertUserWireCatalogSchema = createInsertSchema(userWireCatalogs).omit({
  id: true,
});

export type UserWireCatalog = typeof userWireCatalogs.$inferSelect;
export type InsertUserWireCatalog = z.infer<typeof insertUserWireCatalogSchema>;

export const reviewResponses = pgTable("review_responses", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => countingSessions.id, { onDelete: "cascade" }),
  entryId: integer("entry_id").notNull().references(() => entries.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  username: text("username"),
  verdict: text("verdict").notNull(),
  flagReason: text("flag_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("review_responses_session_entry_user_idx").on(table.sessionId, table.entryId, table.userId),
  index("review_responses_session_id_idx").on(table.sessionId),
  index("review_responses_entry_id_idx").on(table.entryId),
  check("review_responses_verdict_check", sql`${table.verdict} IN ('approved', 'flagged')`),
]);

export const insertReviewResponseSchema = createInsertSchema(reviewResponses).omit({
  id: true,
  createdAt: true,
});

export type ReviewResponse = typeof reviewResponses.$inferSelect;
export type InsertReviewResponse = z.infer<typeof insertReviewResponseSchema>;

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("messages_conversation_id_idx").on(table.conversationId),
]);

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
