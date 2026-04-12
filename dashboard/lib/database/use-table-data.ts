import { entityRegistry, type EntitySlug } from '@/lib/crud/entities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

export interface ListQueryParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  filter?: Record<string, string>;
  search?: string;
}

export interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function buildQueryParams(params: ListQueryParams): Record<string, string> {
  const qs: Record<string, string> = {};
  if (params.page) qs.page = String(params.page);
  if (params.limit) qs.limit = String(params.limit);
  if (params.sort) qs.sort = params.sort;
  if (params.order) qs.order = params.order;
  if (params.search) qs.search = params.search;
  if (params.filter) {
    Object.entries(params.filter).forEach(([key, value]) => {
      if (value) qs[`filter_${key}`] = value;
    });
  }
  return qs;
}

export function useTableData<T = Record<string, unknown>>(
  entity: EntitySlug,
  params: ListQueryParams = {}
) {
  const queryParams = buildQueryParams({
    page: params.page || 1,
    limit: params.limit || 25,
    sort: params.sort,
    order: params.order || 'asc',
    filter: params.filter,
    search: params.search,
  });

  return useQuery<ListResponse<T>>({
    queryKey: ['table', entity, queryParams],
    queryFn: async () => {
      const qs = new URLSearchParams(queryParams).toString();
      const res = await fetch(`/api/crud/${entity}?${qs}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to fetch');
      return json.data;
    },
    staleTime: 10_000,
  });
}

export function useEntityConfig(entity: EntitySlug) {
  return entityRegistry[entity];
}

export function useEntityList(entity: EntitySlug) {
  return useQuery<Array<Record<string, unknown>>>({
    queryKey: ['entity-list', entity],
    queryFn: async () => {
      const res = await fetch(`/api/crud/${entity}?limit=1000`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data.items;
    },
    staleTime: 60_000,
  });
}

export function useInvalidateTable(entity: EntitySlug) {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['table', entity] });
    queryClient.invalidateQueries({ queryKey: ['entity-list', entity] });
  }, [queryClient, entity]);
}
