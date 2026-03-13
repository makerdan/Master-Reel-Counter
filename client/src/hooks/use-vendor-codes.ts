import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { VENDOR_CODES } from "@/lib/wireReference";

const BUILT_IN_CODES: string[] = [...VENDOR_CODES];

function normalizeCustomCodes(raw: string[] | undefined): string[] {
  return (raw ?? [])
    .map((c: string) => c.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3))
    .filter((c: string) => c.length > 0);
}

export function useVendorCodes() {
  const { data: settings } = useQuery<{ customVendorCodes?: string[] }>({
    queryKey: ["/api/settings"],
  });

  const customCodes = normalizeCustomCodes(settings?.customVendorCodes);
  const builtInSet = new Set(BUILT_IN_CODES);
  const allCodes = [...BUILT_IN_CODES, ...customCodes.filter((c: string) => !builtInSet.has(c))];

  const addCustomCodeMutation = useMutation({
    mutationFn: async (code: string) => {
      const upper = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
      if (upper.length !== 3) throw new Error("Vendor code must be exactly 3 characters");
      const cached = queryClient.getQueryData<{ customVendorCodes?: string[] }>(["/api/settings"]);
      const currentCodes = normalizeCustomCodes(cached?.customVendorCodes);
      const newCodes = [...new Set([...currentCodes, upper])];
      await apiRequest("PATCH", "/api/settings", { customVendorCodes: newCodes });
      return upper;
    },
    onMutate: async (code: string) => {
      const upper = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
      await queryClient.cancelQueries({ queryKey: ["/api/settings"] });
      const previous = queryClient.getQueryData<{ customVendorCodes?: string[] }>(["/api/settings"]);
      queryClient.setQueryData(["/api/settings"], (old: { customVendorCodes?: string[] } | undefined) => ({
        ...old,
        customVendorCodes: [...new Set([...(old?.customVendorCodes ?? []), upper])],
      }));
      return { previous };
    },
    onError: (_err, _code, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/settings"], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
  });

  return { allCodes, customCodes, addCustomCode: addCustomCodeMutation.mutate, isAdding: addCustomCodeMutation.isPending };
}
