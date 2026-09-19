import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { ArrowLeft, PackageMinus, PackagePlus, Search, Warehouse } from "lucide-react";

import { selectSelectedWarehouse } from "../features/warehouse/warehouseSlice";
import {
  fetchStockLedger,
  selectStockLedger,
  selectStockLedgerTotals,
  selectStockLedgerPagination,
  selectStockLedgerStatus,
  selectStockLedgerError,
} from "../features/reports/reportSlice";

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-IN");
}

function TotalCard({ icon: Icon, iconClass, label, value }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{label}</p>
        <Icon size={17} className={iconClass} />
      </div>
      <p className="mt-2 text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

export default function StockLedger() {
  const dispatch = useDispatch();

  const selectedWarehouse = useSelector(selectSelectedWarehouse);
  const rows = useSelector(selectStockLedger);
  const totals = useSelector(selectStockLedgerTotals);
  const pagination = useSelector(selectStockLedgerPagination);
  const status = useSelector(selectStockLedgerStatus);
  const error = useSelector(selectStockLedgerError);
  const loading = status === "loading";

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const warehouseId = selectedWarehouse?.id;

  // Reset to page 1 whenever the search term changes.
  useEffect(() => {
    setPage(1);
  }, [search]);

  // Debounce search so every keystroke doesn't fire a request.
  useEffect(() => {
    if (!warehouseId) return undefined;
    const timer = setTimeout(() => {
      dispatch(fetchStockLedger({ warehouseId, search, page, pageSize: 20 }));
    }, 300);
    return () => clearTimeout(timer);
  }, [dispatch, warehouseId, search, page]);

  return (
    <div className="min-h-screen bg-[#F1EFE8] p-4 sm:p-6">
      {/* =================================================
          HEADER
      ================================================= */}

      <div className="mx-auto max-w-5xl">
        <Link to="/reports" className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
          <ArrowLeft size={14} />
          Back to Reports
        </Link>

        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Stock Ledger Summary</h1>
            <p className="mt-1 text-sm text-gray-500">{selectedWarehouse?.name || "Select a warehouse"}</p>
          </div>

          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search category or model"
              className="w-64 rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-xs outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>

        {!warehouseId && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 text-center">
            <p className="text-sm text-gray-500">Select a warehouse from the navbar to view its stock ledger.</p>
          </div>
        )}

        {warehouseId && (
          <>
            {/* =============================================
                TOTALS
            ============================================= */}

            <div className="mb-6 grid grid-cols-3 gap-3 sm:gap-4">
              <TotalCard
                icon={Warehouse}
                iconClass="text-purple-600"
                label="Current Stock"
                value={loading && !totals ? "—" : `${formatNumber(totals?.currentStock)} units`}
              />
              <TotalCard
                icon={PackagePlus}
                iconClass="text-green-600"
                label="Total Inward (all-time)"
                value={loading && !totals ? "—" : formatNumber(totals?.totalInward)}
              />
              <TotalCard
                icon={PackageMinus}
                iconClass="text-amber-600"
                label="Total Outward (all-time)"
                value={loading && !totals ? "—" : formatNumber(totals?.totalOutward)}
              />
            </div>

            {/* =============================================
                TABLE
            ============================================= */}

            {status === "failed" && (
              <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-medium text-red-600">{error}</p>
                <button
                  type="button"
                  onClick={() => dispatch(fetchStockLedger({ warehouseId, search, page, pageSize: 20 }))}
                  className="mt-3 rounded-lg bg-[#185FA5] px-4 py-2 text-xs font-semibold text-white"
                >
                  Try again
                </button>
              </div>
            )}

            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                <h3 className="text-sm font-semibold text-gray-900">Items</h3>
                <p className="text-xs text-gray-500">{pagination ? `${formatNumber(pagination.total)} items` : ""}</p>
              </div>

              {loading && (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm text-gray-500">Loading stock ledger...</p>
                </div>
              )}

              {!loading && rows.length === 0 && (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm text-gray-500">No items found.</p>
                </div>
              )}

              {!loading && rows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Category</th>
                        <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Model / SKU</th>
                        <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">UOM</th>
                        <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">Inward</th>
                        <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">Outward</th>
                        <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">Current Stock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.map((row) => (
                        <tr key={`${row.category}-${row.sku}`}>
                          <td className="px-5 py-3.5 text-xs text-gray-700">{row.category}</td>
                          <td className="px-5 py-3.5 text-xs font-medium text-gray-800">{row.sku}</td>
                          <td className="px-5 py-3.5 text-xs text-gray-500">{row.uom}</td>
                          <td className="px-5 py-3.5 text-right text-xs font-semibold text-green-700">+{formatNumber(row.inward)}</td>
                          <td className="px-5 py-3.5 text-right text-xs font-semibold text-red-600">-{formatNumber(row.outward)}</td>
                          <td className="px-5 py-3.5 text-right text-sm font-semibold tabular-nums text-gray-900">
                            {formatNumber(row.currentStock)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3">
                  <p className="text-xs text-gray-500">
                    Page {pagination.page} of {pagination.totalPages}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={pagination.page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={pagination.page >= pagination.totalPages}
                      onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
