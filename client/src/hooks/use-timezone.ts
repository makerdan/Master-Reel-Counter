import { useQuery } from "@tanstack/react-query";

export function useTimezone(): string {
  const { data: settings } = useQuery<any>({
    queryKey: ["/api/settings"],
  });
  return settings?.timezone || "America/Chicago";
}
