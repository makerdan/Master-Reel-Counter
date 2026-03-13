import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { UserWireCategory } from "@shared/schema";

export function useWireCategories() {
  const { data: categories = [], isLoading } = useQuery<UserWireCategory[]>({
    queryKey: ["/api/wire-categories"],
  });

  const addMutation = useMutation({
    mutationFn: async (data: Omit<UserWireCategory, "id" | "userId">) => {
      const res = await apiRequest("POST", "/api/wire-categories", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wire-categories"] });
    },
  });

  const bulkAddMutation = useMutation({
    mutationFn: async (items: Omit<UserWireCategory, "id" | "userId">[]) => {
      const res = await apiRequest("POST", "/api/wire-categories/bulk", { categories: items });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wire-categories"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/wire-categories/${id}`);
    },
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: ["/api/wire-categories"] });
      const previous = queryClient.getQueryData<UserWireCategory[]>(["/api/wire-categories"]);
      queryClient.setQueryData<UserWireCategory[]>(["/api/wire-categories"], (old) =>
        (old ?? []).filter((c) => c.id !== id)
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/wire-categories"], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wire-categories"] });
    },
  });

  return {
    categories,
    isLoading,
    addCategory: addMutation.mutateAsync,
    isAdding: addMutation.isPending,
    bulkAddCategories: bulkAddMutation.mutateAsync,
    isBulkAdding: bulkAddMutation.isPending,
    deleteCategory: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
  };
}
