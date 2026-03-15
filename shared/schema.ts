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
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const folders = pgTable("folders", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  parentFolderId: integer("parent_folder_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
});

export const photos = pgTable("photos", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
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
  pinScale: real("pin_scale").default(1),
  fileSize: integer("file_size"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const entries = pgTable("entries", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  userId: varchar("user_id").notNull(),
  photoId: integer("photo_id"),
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
});

export const pins = pgTable("pins", {
  id: serial("id").primaryKey(),
  photoId: integer("photo_id").notNull(),
  entryId: integer("entry_id"),
  xPercent: real("x_percent").notNull(),
  yPercent: real("y_percent").notNull(),
  label: text("label"),
  reelCount: integer("reel_count").default(1),
  wireDetails: text("wire_details"),
  vendorCode: text("vendor_code"),
  footage: integer("footage"),
  flagged: boolean("flagged").default(false),
  flagReason: text("flag_reason"),
});


export const sessionCollaborators = pgTable("session_collaborators", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  userId: varchar("user_id").notNull(),
  username: text("username"),
  role: text("role").notNull().default("editor"),
  addedAt: timestamp("added_at").defaultNow().notNull(),
});

export const sessionInviteLinks = pgTable("session_invite_links", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  token: varchar("token").notNull().unique(),
  createdBy: varchar("created_by").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  usedCount: integer("used_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
});

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
  useReceivingQuality: boolean("use_receiving_quality").notNull().default(false),
  receivingPhotoQuality: integer("receiving_photo_quality").notNull().default(50),
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
});

export const activityLogs = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  userId: varchar("user_id").notNull(),
  username: text("username"),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  details: text("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const comments = pgTable("comments", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  userId: varchar("user_id").notNull(),
  username: text("username"),
  entryId: integer("entry_id"),
  photoId: integer("photo_id"),
  parentCommentId: integer("parent_comment_id"),
  text: text("text").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertFolderSchema = createInsertSchema(folders).omit({
  id: true,
  createdAt: true,
});

export const insertSessionSchema = createInsertSchema(countingSessions).omit({
  id: true,
  startedAt: true,
  lastUpdatedAt: true,
  completedAt: true,
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
  userId: text("user_id").notNull(),
  topic: text("topic").notNull(),
  message: text("message").notNull(),
  page: text("page"),
  status: text("status").notNull().default("PENDING"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertFeedbackSchema = createInsertSchema(feedback).omit({
  id: true,
  createdAt: true,
  status: true,
});

export type Feedback = typeof feedback.$inferSelect;
export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;

export const scanResults = pgTable("scan_results", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  photoId: integer("photo_id").notNull(),
  pinId: integer("pin_id").notNull().unique(),
  pinLabel: text("pin_label"),
  rawText: text("raw_text"),
  readable: boolean("readable").default(false),
  scannedBy: varchar("scanned_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertScanResultSchema = createInsertSchema(scanResults).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ScanResult = typeof scanResults.$inferSelect;
export type InsertScanResult = z.infer<typeof insertScanResultSchema>;

export const userWireCategories = pgTable("user_wire_categories", {
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
});

export const insertUserWireCategorySchema = createInsertSchema(userWireCategories).omit({
  id: true,
});

export type UserWireCategory = typeof userWireCategories.$inferSelect;
export type InsertUserWireCategory = z.infer<typeof insertUserWireCategorySchema>;
