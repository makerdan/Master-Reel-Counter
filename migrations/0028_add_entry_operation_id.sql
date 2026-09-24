ALTER TABLE entries
  ADD COLUMN client_operation_id varchar(128);

CREATE UNIQUE INDEX entries_session_user_operation_id_unique
  ON entries (session_id, user_id, client_operation_id);