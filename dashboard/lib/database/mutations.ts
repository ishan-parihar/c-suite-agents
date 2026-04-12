import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type EntitySlug } from '@/lib/crud/entities';
import { api } from '@/lib/api-client';
import { toast } from 'sonner';

interface CreateMutationInput {
  entity: EntitySlug;
  data: Record<string, unknown>;
}

interface UpdateMutationInput {
  entity: EntitySlug;
  id: string | number;
  data: Record<string, unknown>;
}

interface DeleteMutationInput {
  entity: EntitySlug;
  id: string | number;
}

export function useCreateEntity(entity: EntitySlug) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await api.post<{ id: string | number }>(`/api/crud/${entity}`, data);
      if (res.error) throw new Error(res.error.message);
      return res.data;
    },
    onMutate: async (newData) => {
      await queryClient.cancelQueries({ queryKey: ['table', entity] });
      const previous = queryClient.getQueryData(['table', entity]);
      queryClient.setQueryData(['table', entity], (old: any) => {
        if (!old) return old;
        return { ...old, items: [...(old.items || []), { ...newData, id: 'temp' }] };
      });
      return { previous };
    },
    onError: (_err, _vars, context: any) => {
      if (context?.previous) {
        queryClient.setQueryData(['table', entity], context.previous);
      }
      toast.error('Failed to create record');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table', entity] });
    },
  });
}

export function useUpdateEntity(entity: EntitySlug) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: UpdateMutationInput) => {
      const res = await api.patch<unknown>(`/api/crud/${entity}/${id}`, data);
      if (res.error) throw new Error(res.error.message);
      return res.data;
    },
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ['table', entity] });
      const previous = queryClient.getQueryData(['table', entity]);
      queryClient.setQueryData(['table', entity], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          items: (old.items || []).map((item: Record<string, unknown>) =>
            String(item.id) === String(id) ? { ...item, ...data } : item
          ),
        };
      });
      return { previous };
    },
    onError: (_err, _vars, context: any) => {
      if (context?.previous) {
        queryClient.setQueryData(['table', entity], context.previous);
      }
      toast.error('Failed to update record');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table', entity] });
    },
  });
}

export function useDeleteEntity(entity: EntitySlug) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string | number) => {
      const res = await api.delete<unknown>(`/api/crud/${entity}/${id}`);
      if (res.error) throw new Error(res.error.message);
      return res.data;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['table', entity] });
      const previous = queryClient.getQueryData(['table', entity]);
      queryClient.setQueryData(['table', entity], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          items: (old.items || []).filter(
            (item: Record<string, unknown>) => String(item.id) !== String(id)
          ),
          total: Math.max(0, (old.total || 0) - 1),
        };
      });
      return { previous };
    },
    onError: (_err, _vars, context: any) => {
      if (context?.previous) {
        queryClient.setQueryData(['table', entity], context.previous);
      }
      toast.error('Failed to delete record');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table', entity] });
    },
  });
}
