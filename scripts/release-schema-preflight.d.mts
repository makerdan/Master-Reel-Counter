export function assertIsolatedReleaseDatabase(input: {
  releaseDatabaseUrl: string | undefined;
  publicationDatabaseUrl: string | undefined;
}): string;

export function assertReleaseSchema(client: {
  query(query: string): Promise<{ rows: Array<Record<string, string>> }>;
}): Promise<{
  databaseName: string | undefined;
  schemaName: string | undefined;
  missingColumns: string[];
  missingRoleValues: string[];
  legacyObjects: string[];
}>;

export function readReleaseSchema(client: {
  query(query: string): Promise<{ rows: Array<Record<string, string>> }>;
}): Promise<{
  databaseName: string | undefined;
  schemaName: string | undefined;
  missingColumns: string[];
  missingRoleValues: string[];
  legacyObjects: string[];
}>;