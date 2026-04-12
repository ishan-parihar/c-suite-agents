export interface QueryResult<T = unknown> {
  success: boolean;
  data?: T[];
  count?: number;
  table: string;
  error?: string;
}

export interface InsertResult<T = unknown> {
  success: boolean;
  data?: T[];
  count?: number;
  table: string;
  error?: string;
}

export interface UpdateResult<T = unknown> {
  success: boolean;
  data?: T[];
  count?: number;
  table: string;
  error?: string;
}

export interface SchemaInfo {
  tables: Record<string, Record<string, { name: string; dataType: string; notNull: boolean }>>;
}

export type FilterValue = string | number | boolean | null | string[] | number[] | {
  $like?: string;
  $gt?: unknown;
  $gte?: unknown;
  $lt?: unknown;
  $lte?: unknown;
  $in?: unknown[];
  $isNull?: boolean;
};

export type Filters = Record<string, FilterValue>;

export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
}
