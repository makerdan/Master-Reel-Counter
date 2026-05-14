import type { Session, Entry, Photo, Pin, Collaborator, InviteLink } from "@shared/schema";

export type { Session, Entry, Photo, Pin, Collaborator, InviteLink };

export interface LocalPin {
  id: string;
  x: number;
  y: number;
  label: string;
  reelCount: number;
  wireDetails?: string;
  vendorCode?: string;
  footage?: number;
  flagged?: boolean;
  flagReason?: string;
  aliasUsed?: string;
  /** Stable client-generated UUID persisted on the server so concurrent draft-pin
   *  writes can be merged per-row instead of last-write-wins for the whole set. */
  draftClientId?: string;
}

export interface SessionWithRole extends Session {
  firstPhotoAt: string | null;
  lastPhotoAt: string | null;
  role: "owner" | "editor" | "viewer";
  collaboratorCount: number;
}
