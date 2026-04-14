import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { UserWireCatalog } from "@shared/schema";

export function useWireCatalogs() {
  const { data: catalogs = [], isLoading } = useQuery<UserWireCatalog[]>({
    queryKey: ["/api/wire-catalogs"],
  });

  const addMutation = useMutation({
    mutationFn: async (data: Omit<UserWireCatalog, "id" | "userId">) => {
      const res = await apiRequest("POST", "/api/wire-catalogs", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wire-catalogs"] });
    },
  });

  const bulkAddMutation = useMutation({
    mutationFn: async (items: Omit<UserWireCatalog, "id" | "userId">[]) => {
      const res = await apiRequest("POST", "/api/wire-catalogs/bulk", { catalogs: items });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wire-catalogs"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/wire-catalogs/${id}`);
    },
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: ["/api/wire-catalogs"] });
      const previous = queryClient.getQueryData<UserWireCatalog[]>(["/api/wire-catalogs"]);
      queryClient.setQueryData<UserWireCatalog[]>(["/api/wire-catalogs"], (old) =>
        (old ?? []).filter((c) => c.id !== id)
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/wire-catalogs"], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wire-catalogs"] });
    },
  });

  return {
    catalogs,
    isLoading,
    addCatalog: addMutation.mutateAsync,
    isAdding: addMutation.isPending,
    bulkAddCatalogs: bulkAddMutation.mutateAsync,
    isBulkAdding: bulkAddMutation.isPending,
    deleteCatalog: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
  };
}
