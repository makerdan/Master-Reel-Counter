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

export const countingSessions = pgTable("counting_sessions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  location: text("location"),
  status: text("status").notNull().default("active"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  lastUpdatedAt: timestamp("last_updated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
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
  color: text("color"),
  manufacturer: text("manufacturer"),
  notes: text("notes"),
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
});

export const userSettings = pgTable("user_settings", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().unique(),
  encodingEnabled: boolean("encoding_enabled").notNull().default(false),
  encryptionKey: text("encryption_key"),
  encryptionSalt: text("encryption_salt"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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

export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof countingSessions.$inferSelect;
export type InsertPhoto = z.infer<typeof insertPhotoSchema>;
export type Photo = typeof photos.$inferSelect;
export type InsertEntry = z.infer<typeof insertEntrySchema>;
export type Entry = typeof entries.$inferSelect;
export type InsertPin = z.infer<typeof insertPinSchema>;
export type Pin = typeof pins.$inferSelect;

export type UserSettings = typeof userSettings.$inferSelect;
