import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

/** Rule-engine variable registry (shared cache with the signal builder). */
export function useRuleVariables() {
  const { data } = useQuery({
    queryKey: ["rule-variables"],
    queryFn: () => api.get("/rules/variables"),
    staleTime: Infinity,
  })
  return data?.variables ?? []
}
