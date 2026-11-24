import { useLocalStorage } from "../hooks/useLocalStorage";
import {
  DEFAULT_COLUMNS,
  DEFAULT_LAYOUT,
  normalizeLayout,
  VOUCHER_LAYOUT_KEY,
  VoucherLayout,
  type ColumnId,
  type ViewSort,
} from "./columns";

/**
 * Column layout and sort for this device; read synchronously so the first render has it.
 * `fieldIds` is null until local fields load, so their columns survive the first render.
 */
export function useVoucherLayout(fieldIds: ReadonlySet<number> | null) {
  const [stored, setStored] = useLocalStorage(VOUCHER_LAYOUT_KEY, DEFAULT_LAYOUT, VoucherLayout);
  const { columns, sort } = normalizeLayout(stored, fieldIds);
  const save = (next: { columns?: readonly ColumnId[]; sort?: ViewSort }) =>
    setStored((current) => {
      const normalized = normalizeLayout(current, fieldIds);
      return {
        version: 1,
        columns: next.columns ?? normalized.columns,
        sort: next.sort ?? normalized.sort,
      };
    });
  return {
    columns,
    sort,
    setColumns: (next: readonly ColumnId[]) => save({ columns: next }),
    setSort: (next: ViewSort) => save({ sort: next }),
    reset: () => save({ columns: DEFAULT_COLUMNS }),
  };
}
