export const FILTER_REMOVED_REVIEW_COHORT_SQL = `
  WITH filtered_cohorts AS (
    SELECT session.id,
           CASE
             WHEN count(*) FILTER (WHERE removed.id IS NULL) = 0 THEN NULL
             ELSE (
               jsonb_agg(member ORDER BY ordinal)
               FILTER (WHERE removed.id IS NULL)
             )::text
           END AS cohort
    FROM counting_sessions session
    CROSS JOIN LATERAL jsonb_array_elements(session.review_cohort::jsonb)
         WITH ORDINALITY AS cohort_member(member, ordinal)
    LEFT JOIN cutover_removed_identities removed
      ON removed.id = member->>'userId'
    WHERE session.review_cohort IS NOT NULL
    GROUP BY session.id
    HAVING count(*) FILTER (WHERE removed.id IS NOT NULL) > 0
  )
  UPDATE counting_sessions session
  SET review_cohort = filtered.cohort
  FROM filtered_cohorts filtered
  WHERE session.id = filtered.id
`;

export const COUNT_REMAINING_REMOVED_ACCOUNT_DATA_SQL = `
  SELECT ((
    SELECT count(*)
    FROM (
      SELECT user_id AS owner_id FROM counting_sessions
      UNION ALL SELECT user_id FROM folders
      UNION ALL SELECT user_id FROM session_collaborators
      UNION ALL SELECT created_by FROM session_invite_links
      UNION ALL SELECT user_id FROM photos
      UNION ALL SELECT user_id FROM entries
      UNION ALL SELECT user_id FROM user_settings
      UNION ALL SELECT user_id FROM upload_intents
      UNION ALL SELECT user_id FROM conversations
      UNION ALL SELECT user_id FROM user_wire_categories
      UNION ALL SELECT user_id FROM ai_usage_logs
      UNION ALL SELECT user_id FROM feedback
      UNION ALL SELECT user_id FROM comments
      UNION ALL SELECT user_id FROM review_responses
      UNION ALL SELECT user_id FROM activity_logs
    ) owned
    JOIN cutover_removed_accounts removed ON removed.id = owned.owner_id
  ) + (
    SELECT count(*)
    FROM scan_results scan
    JOIN cutover_removed_identities removed ON removed.id = scan.scanned_by
  ) + (
    SELECT count(*)
    FROM counting_sessions session
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(session.review_cohort, '[]')::jsonb
    ) member
    JOIN cutover_removed_identities removed
      ON removed.id = member->>'userId'
  ))::int AS count
`;