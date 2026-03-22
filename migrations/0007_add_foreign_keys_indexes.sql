-- Clean up orphaned records before adding foreign key constraints

-- Delete photos referencing non-existent sessions
DELETE FROM photos WHERE session_id NOT IN (SELECT id FROM counting_sessions);

-- Delete entries referencing non-existent sessions
DELETE FROM entries WHERE session_id NOT IN (SELECT id FROM counting_sessions);

-- Nullify entries referencing non-existent photos
UPDATE entries SET photo_id = NULL WHERE photo_id IS NOT NULL AND photo_id NOT IN (SELECT id FROM photos);

-- Delete pins referencing non-existent photos
DELETE FROM pins WHERE photo_id NOT IN (SELECT id FROM photos);

-- Nullify pins referencing non-existent entries
UPDATE pins SET entry_id = NULL WHERE entry_id IS NOT NULL AND entry_id NOT IN (SELECT id FROM entries);

-- Delete session_collaborators referencing non-existent sessions
DELETE FROM session_collaborators WHERE session_id NOT IN (SELECT id FROM counting_sessions);

-- Delete session_invite_links referencing non-existent sessions
DELETE FROM session_invite_links WHERE session_id NOT IN (SELECT id FROM counting_sessions);

-- Delete activity_logs referencing non-existent sessions
DELETE FROM activity_logs WHERE session_id NOT IN (SELECT id FROM counting_sessions);

-- Delete comments referencing non-existent sessions
DELETE FROM comments WHERE session_id NOT IN (SELECT id FROM counting_sessions);

-- Nullify comments referencing non-existent entries
UPDATE comments SET entry_id = NULL WHERE entry_id IS NOT NULL AND entry_id NOT IN (SELECT id FROM entries);

-- Nullify comments referencing non-existent photos
UPDATE comments SET photo_id = NULL WHERE photo_id IS NOT NULL AND photo_id NOT IN (SELECT id FROM photos);

-- Delete scan_results referencing non-existent sessions, photos, or pins
DELETE FROM scan_results WHERE session_id NOT IN (SELECT id FROM counting_sessions);
DELETE FROM scan_results WHERE photo_id NOT IN (SELECT id FROM photos);
DELETE FROM scan_results WHERE pin_id NOT IN (SELECT id FROM pins);

-- Delete dismissed_duplicates referencing non-existent sessions
DELETE FROM dismissed_duplicates WHERE session_id NOT IN (SELECT id FROM counting_sessions);

-- Delete review_responses referencing non-existent sessions or entries
DELETE FROM review_responses WHERE session_id NOT IN (SELECT id FROM counting_sessions);
DELETE FROM review_responses WHERE entry_id NOT IN (SELECT id FROM entries);

-- Clean up orphaned self-references
UPDATE photos SET parent_photo_id = NULL WHERE parent_photo_id IS NOT NULL AND parent_photo_id NOT IN (SELECT id FROM photos);
UPDATE comments SET parent_comment_id = NULL WHERE parent_comment_id IS NOT NULL AND parent_comment_id NOT IN (SELECT id FROM comments);

-- Add foreign key constraints

-- photos.session_id -> counting_sessions.id (CASCADE)
ALTER TABLE photos ADD CONSTRAINT photos_session_id_fk FOREIGN KEY (session_id) REFERENCES counting_sessions(id) ON DELETE CASCADE;

-- photos.parent_photo_id -> photos.id (SET NULL)
ALTER TABLE photos ADD CONSTRAINT photos_parent_photo_id_fk FOREIGN KEY (parent_photo_id) REFERENCES photos(id) ON DELETE SET NULL;

-- entries.session_id -> counting_sessions.id (CASCADE)
ALTER TABLE entries ADD CONSTRAINT entries_session_id_fk FOREIGN KEY (session_id) REFERENCES counting_sessions(id) ON DELETE CASCADE;

-- entries.photo_id -> photos.id (SET NULL)
ALTER TABLE entries ADD CONSTRAINT entries_photo_id_fk FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE SET NULL;

-- pins.photo_id -> photos.id (CASCADE)
ALTER TABLE pins ADD CONSTRAINT pins_photo_id_fk FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE;

-- pins.entry_id -> entries.id (SET NULL)
ALTER TABLE pins ADD CONSTRAINT pins_entry_id_fk FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE SET NULL;

-- session_collaborators.session_id -> counting_sessions.id (CASCADE)
ALTER TABLE session_collaborators ADD CONSTRAINT session_collaborators_session_id_fk FOREIGN KEY (session_id) REFERENCES counting_sessions(id) ON DELETE CASCADE;

-- session_invite_links.session_id -> counting_sessions.id (CASCADE)
ALTER TABLE session_invite_links ADD CONSTRAINT session_invite_links_session_id_fk FOREIGN KEY (session_id) REFERENCES counting_sessions(id) ON DELETE CASCADE;

-- activity_logs.session_id -> counting_sessions.id (CASCADE)
ALTER TABLE activity_logs ADD CONSTRAINT activity_logs_session_id_fk FOREIGN KEY (session_id) REFERENCES counting_sessions(id) ON DELETE CASCADE;

-- comments.session_id -> counting_sessions.id (CASCADE)
ALTER TABLE comments ADD CONSTRAINT comments_session_id_fk FOREIGN KEY (session_id) REFERENCES counting_sessions(id) ON DELETE CASCADE;

-- comments.entry_id -> entries.id (CASCADE)
ALTER TABLE comments ADD CONSTRAINT comments_entry_id_fk FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE;

-- comments.photo_id -> photos.id (CASCADE)
ALTER TABLE comments ADD CONSTRAINT comments_photo_id_fk FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE;

-- comments.parent_comment_id -> comments.id (CASCADE)
ALTER TABLE comments ADD CONSTRAINT comments_parent_comment_id_fk FOREIGN KEY (parent_comment_id) REFERENCES comments(id) ON DELETE CASCADE;

-- scan_results.session_id -> counting_sessions.id (CASCADE)
ALTER TABLE scan_results ADD CONSTRAINT scan_results_session_id_fk FOREIGN KEY (session_id) REFERENCES counting_sessions(id) ON DELETE CASCADE;

-- scan_results.photo_id -> photos.id (CASCADE)
ALTER TABLE scan_results ADD CONSTRAINT scan_results_photo_id_fk FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE;

-- scan_results.pin_id -> pins.id (CASCADE)
ALTER TABLE scan_results ADD CONSTRAINT scan_results_pin_id_fk FOREIGN KEY (pin_id) REFERENCES pins(id) ON DELETE CASCADE;

-- dismissed_duplicates.session_id -> counting_sessions.id (CASCADE)
ALTER TABLE dismissed_duplicates ADD CONSTRAINT dismissed_duplicates_session_id_fk FOREIGN KEY (session_id) REFERENCES counting_sessions(id) ON DELETE CASCADE;

-- review_responses.session_id -> counting_sessions.id (CASCADE)
ALTER TABLE review_responses ADD CONSTRAINT review_responses_session_id_fk FOREIGN KEY (session_id) REFERENCES counting_sessions(id) ON DELETE CASCADE;

-- review_responses.entry_id -> entries.id (CASCADE)
ALTER TABLE review_responses ADD CONSTRAINT review_responses_entry_id_fk FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE;

-- Add indexes on foreign key columns

CREATE INDEX IF NOT EXISTS folders_user_id_idx ON folders(user_id);
CREATE INDEX IF NOT EXISTS counting_sessions_user_id_idx ON counting_sessions(user_id);
CREATE INDEX IF NOT EXISTS photos_session_id_idx ON photos(session_id);
CREATE INDEX IF NOT EXISTS entries_session_id_idx ON entries(session_id);
CREATE INDEX IF NOT EXISTS entries_photo_id_idx ON entries(photo_id);
CREATE INDEX IF NOT EXISTS pins_photo_id_idx ON pins(photo_id);
CREATE INDEX IF NOT EXISTS pins_entry_id_idx ON pins(entry_id);
CREATE INDEX IF NOT EXISTS activity_logs_session_id_idx ON activity_logs(session_id);
CREATE INDEX IF NOT EXISTS comments_session_id_idx ON comments(session_id);
CREATE INDEX IF NOT EXISTS comments_entry_id_idx ON comments(entry_id);
CREATE INDEX IF NOT EXISTS session_collaborators_session_id_idx ON session_collaborators(session_id);
CREATE INDEX IF NOT EXISTS scan_results_session_id_idx ON scan_results(session_id);
CREATE INDEX IF NOT EXISTS scan_results_photo_id_idx ON scan_results(photo_id);
CREATE INDEX IF NOT EXISTS dismissed_duplicates_session_id_idx ON dismissed_duplicates(session_id);
CREATE INDEX IF NOT EXISTS dismissed_duplicates_key_idx ON dismissed_duplicates(key);
CREATE INDEX IF NOT EXISTS user_settings_user_id_idx ON user_settings(user_id);
CREATE INDEX IF NOT EXISTS user_wire_categories_user_id_idx ON user_wire_categories(user_id);
CREATE INDEX IF NOT EXISTS review_responses_session_id_idx ON review_responses(session_id);
CREATE INDEX IF NOT EXISTS review_responses_entry_id_idx ON review_responses(entry_id);
CREATE INDEX IF NOT EXISTS comments_photo_id_idx ON comments(photo_id);
CREATE INDEX IF NOT EXISTS session_invite_links_session_id_idx ON session_invite_links(session_id);
