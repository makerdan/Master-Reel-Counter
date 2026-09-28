export function assertIsolatedReleaseDatabase(input: {
  releaseDatabaseUrl: string | undefined;
  publicationDatabaseUrl: string | undefined;
}): string;

export function assertReleaseSchema(client: {
  query(query: string): Promise<{ rows: Array<Record<string, string>> }>;
}, options?: { expectedSchema?: ReleaseSchema; target?: string }): Promise<ReleaseSchema>;

export interface ReleaseSchema {
  databaseName: string | undefined;
  schemaName: string | undefined;
  missingColumns: string[];
  missingRoleValues: string[];
  legacyObjects: string[];
  roleValues: string[];
  schemaState: {
    columns: Array<Record<string, string | null>>;
    indexes: Array<{ indexname: string; indexdef: string }>;
  };
}

export function readReleaseSchema(client: {
  query(query: string): Promise<{ rows: Array<Record<string, string>> }>;
}): Promise<ReleaseSchema>;

export function releaseSchemaFingerprint(schema: ReleaseSchema): string;
export function compareReleaseSchema(expected: ReleaseSchema, actual: ReleaseSchema): string[];
export const REVIEWED_PUBLICATION_TRANSITION: Readonly<{
  schemaName: string;
  legacyFingerprint: string;
  candidateFingerprint: string;
}>;
export function assertPublicationSchema(
  client: { query(query: string): Promise<{ rows: Array<Record<string, string>> }> },
  options: {
    expectedSchema: ReleaseSchema;
    transition?: {
      schemaName: string;
      legacyFingerprint: string;
      candidateFingerprint: string;
    };
  },
): Promise<{ mode: "current" | "reviewed-legacy"; schema: ReleaseSchema }>;