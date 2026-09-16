export const STALE_UNCOMMITTED_PINS_QUERY = `
  SELECT COUNT(*)::int AS count FROM pins p
  JOIN photos ph ON p.photo_id = ph.id
  JOIN counting_sessions cs ON ph.session_id = cs.id
  WHERE p.entry_id IS NULL
    AND cs.started_at < NOW() - INTERVAL '7 days'
    AND cs.deleted_at IS NULL
`;

export const DELETE_STALE_UNCOMMITTED_PINS_QUERY = `
  DELETE FROM pins
  WHERE entry_id IS NULL
    AND photo_id IN (
      SELECT ph.id FROM photos ph
      JOIN counting_sessions cs ON ph.session_id = cs.id
      WHERE cs.started_at < NOW() - INTERVAL '7 days'
        AND cs.deleted_at IS NULL
    )
`;