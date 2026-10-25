export interface BackfillBatchResult {
  total: number;
  updated: number;
  failed: number;
  hasMore: boolean;
  nextCursor: number | null;
}

export function backfillProgress(result: BackfillBatchResult) {
  const counts = `Updated ${result.updated} of ${result.total} photos in this batch${result.failed ? ` (${result.failed} unavailable; retry on a later pass)` : ""}.`;
  return {
    title: result.hasMore ? "More photos remain" : "Backfill pass finished",
    description: result.hasMore
      ? `${counts} Use Continue to process the next batch. If rate-limited, wait a minute.`
      : `${counts} You can calculate again to retry any photos still missing sizes.`,
    nextCursor: result.nextCursor,
  };
}
