// Metadata-only delta captured read-only from the publication endpoint on
// 2026-10-25. Common candidate metadata is reused, but the resulting whole shape
// must still hash to the independently captured legacy pin. No rows or URLs.
export function reviewedPublicationFixture(candidate) {
  const candidateOnlyColumns = new Set([
    "ai_usage_logs.provider", "ai_usage_logs.endpoint", "ai_usage_logs.route",
    "ai_usage_logs.status", "ai_usage_logs.latency_ms", "ai_usage_logs.retry_count",
    "ai_usage_logs.fallback_state", "ai_usage_logs.cache_state",
    "conversations.user_id", "entries.client_operation_id",
    "folders.trashed_from_parent_folder_id", "photos.registration_key",
    "user_settings.help_guide_version", "user_settings.help_guide_completed_at",
    "users.clerk_user_id", "users.role", "users.capabilities",
  ]);
  const candidateOnlyIndexes = new Set([
    "ai_usage_logs_provider_idx", "conversations_user_id_idx",
    "entries_session_user_operation_id_unique",
    "photos_session_registration_key_unique", "users_clerk_user_id_unique",
  ]);
  const column = (table_name, column_name, data_type, udt_name, is_nullable, column_default = null) =>
    ({ table_name, column_name, data_type, udt_name, is_nullable, column_default });
  return {
    ...structuredClone(candidate),
    databaseName: "reviewed_publication_fixture",
    missingColumns: ["clerk_user_id", "role", "capabilities"],
    missingRoleValues: ["Admin", "User"],
    roleValues: [],
    legacyObjects: ["users.is_tester", "user_settings.tester_password", "sessions"],
    schemaState: {
      columns: candidate.schemaState.columns
        .filter((c) => !candidateOnlyColumns.has(`${c.table_name}.${c.column_name}`))
        .map((c) => c.table_name === "user_settings" && c.column_name === "photo_quality"
          ? { ...c, column_default: "85" } : { ...c })
        .concat([
          column("sessions", "sid", "character varying", "varchar", "NO"),
          column("sessions", "sess", "jsonb", "jsonb", "NO"),
          column("sessions", "expire", "timestamp without time zone", "timestamp", "NO"),
          column("user_settings", "tester_password", "text", "text", "YES"),
          column("users", "is_tester", "boolean", "bool", "NO", "false"),
        ]),
      indexes: candidate.schemaState.indexes
        .filter((i) => !candidateOnlyIndexes.has(i.indexname))
        .map((i) => ({ ...i }))
        .concat([
          { indexname: "IDX_session_expire", indexdef: 'CREATE INDEX "IDX_session_expire" ON public.sessions USING btree (expire)' },
          { indexname: "sessions_pkey", indexdef: "CREATE UNIQUE INDEX sessions_pkey ON public.sessions USING btree (sid)" },
        ]),
    },
  };
}
