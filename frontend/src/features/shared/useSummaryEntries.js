import { useEffect, useState } from "react";
import apiClient from "../../services/apiClient";

/**
 * Entries for the KPI cards of a list page. They ignore the search / type / status / date filters, so the cards
 * stay the same while the list below is being searched. Loaded once per warehouse (latest 100 entries).
 */
export default function useSummaryEntries(url, warehouseId, skip = false) {
  const [state, setState] = useState({ entries: [], total: 0, ready: false });

  useEffect(() => {
    if (skip) return undefined;
    let cancelled = false;
    apiClient
      .get(url, { params: { ...(warehouseId ? { warehouseId } : {}), page: 1, pageSize: 100 } })
      .then(({ data }) => {
        if (cancelled) return;
        const entries = Array.isArray(data) ? data : data.data || data.outwards || data.grns || [];
        setState({ entries, total: data.pagination?.total ?? entries.length, ready: true });
      })
      .catch(() => { if (!cancelled) setState((s) => ({ ...s, ready: true })); });
    return () => { cancelled = true; };
  }, [url, warehouseId, skip]);

  return state;
}
