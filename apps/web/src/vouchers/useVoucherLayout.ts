import type { VoucherSort } from "@madar/contracts";
import { useLocalStorage } from "../hooks/useLocalStorage";
import {
  DEFAULT_COLUMNS,
  DEFAULT_LAYOUT,
  DEFAULT_SORT,
  normalizeLayout,
  VOUCHER_LAYOUT_KEY,
  VoucherLayout,
  type ColumnKey,
} from "./columns";

/** Column layout and sort for this device; read synchronously so the first render has it. */
export function useVoucherLayout() {
  const [stored, setStored] = useLocalStorage(VOUCHER_LAYOUT_KEY, DEFAULT_LAYOUT, VoucherLayout);
  const { columns, sort } = normalizeLayout(stored);
  const save = (next: { columns?: readonly ColumnKey[]; sort?: VoucherSort }) =>
    setStored((current) => {
      const normalized = normalizeLayout(current);
      return {
        version: 1,
        columns: next.columns ?? normalized.columns,
        sort: next.sort ?? normalized.sort,
      };
    });
  return {
    columns,
    sort,
    setColumns: (next: readonly ColumnKey[]) => save({ columns: next }),
    setSort: (next: VoucherSort) => save({ sort: next }),
    reset: () => save({ columns: DEFAULT_COLUMNS, sort: DEFAULT_SORT }),
  };
}
