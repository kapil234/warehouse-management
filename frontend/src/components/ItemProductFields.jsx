import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { ChevronDown, Plus } from "lucide-react";
import {
  selectAllProducts,
  selectProductStatus,
} from "../features/product/productSlice";
import AddProductModal from "./AddProductModal";

const sameText = (a, b) =>
  String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

/**
 * SKU / Model picker for the outward form. The open list shows every model with
 * how many are available ("GW5000 - 5", out-of-stock ones greyed out), but once
 * a model is picked the field shows ONLY the SKU - the quantity is just a hint
 * in the list, it is never part of the value that gets saved.
 * (A native <select> can't do this: it always shows the picked option's full
 * text in the closed field.)
 */
function StockSkuSelect({ value, options, disabled, placeholder, inputCls, onSelect }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`${inputCls} block appearance-none bg-white pr-8 text-left disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400`}
      >
        <span className={`block truncate ${value ? "" : "text-gray-400"}`}>
          {value || placeholder}
        </span>
      </button>
      <ChevronDown
        size={16}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"
      />
      {open && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {options.length === 0 && (
            <li className="px-3 py-2 text-sm text-gray-400">No models found</li>
          )}
          {options.map(({ sku, available }) => {
            const outOfStock = available <= 0;
            const selected = sku === value;
            return (
              <li key={sku} role="option" aria-selected={selected} aria-disabled={outOfStock}>
                <button
                  type="button"
                  disabled={outOfStock}
                  onClick={() => {
                    onSelect(sku);
                    setOpen(false);
                  }}
                  className={`block w-full px-3 py-2 text-left text-sm ${
                    outOfStock
                      ? "cursor-not-allowed text-gray-300"
                      : selected
                        ? "bg-blue-50 font-medium text-blue-700"
                        : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {`${sku} - ${available}`}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Category + SKU / Model dropdowns for one item row on the inward and
 * outward forms. Options come from the product list (the same one shown on
 * the Product Management page) - nothing can be typed straight into the
 * dropdowns.
 *
 * Stock mode (outward form): when `getStock(category, sku)` is passed, every
 * category is still listed, and the SKU dropdown shows each model with how many
 * are available, like "GW5000 - 5". Models with 0 are shown but greyed out and
 * can't be picked. `getStock` returns { available, uom }. `stockBlockReason`
 * (e.g. "Select warehouse first") disables both dropdowns until stock is known.
 *
 * When `canAdd` is true (inward form, admin / warehouse manager) an "Add"
 * button sits next to each label. It opens a small dialog that saves a new
 * category / SKU to the product list and selects it on this row.
 *
 * If an older entry is being edited and its category / SKU is no longer in
 * the product list (e.g. the product was deleted), the current value is still
 * shown so it isn't silently lost.
 *
 * Renders two grid cells, so it must sit inside the item row's grid.
 */
export default function ItemProductFields({
  item,
  products,
  onChange, // (field, value) => void
  inputCls,
  labelCls,
  categoryClass = "md:col-span-3",
  skuClass = "md:col-span-5",
  canAdd = false,
  getStock, // (category, sku) => { available, uom }   - outward only
  stockBlockReason = "", // outward only
}) {
  const stockMode = typeof getStock === "function";

  // null = closed, "category" = add category + SKU, "sku" = add SKU to the chosen category
  const [addMode, setAddMode] = useState(null);

  const categories = useMemo(() => {
    const list = [...new Set(products.map((p) => p.category))];
    if (item.category && !list.some((c) => sameText(c, item.category))) {
      list.push(item.category);
    }
    return list.sort((a, b) => a.localeCompare(b));
  }, [products, item.category]);

  const categoryValue =
    categories.find((c) => sameText(c, item.category)) || "";

  const skus = useMemo(() => {
    const list = products
      .filter((p) => sameText(p.category, item.category))
      .map((p) => p.sku);
    if (item.sku && !list.some((s) => sameText(s, item.sku))) {
      list.push(item.sku);
    }
    return list.sort((a, b) => a.localeCompare(b));
  }, [products, item.category, item.sku]);

  const skuValue = skus.find((s) => sameText(s, item.sku)) || "";

  // The new product is already in the product list (the slice adds it), so just
  // select it on this row. Category first - it clears the SKU - then the SKU.
  const handleCreated = (product) => {
    onChange("category", product.category);
    onChange("sku", product.sku);
    setAddMode(null);
  };

  const addButtonCls =
    "mb-1.5 inline-flex items-center gap-0.5 text-xs font-semibold text-blue-700 hover:underline disabled:cursor-not-allowed disabled:text-gray-300 disabled:no-underline";

  return (
    <>
      <div className={categoryClass}>
        <div className="flex items-start justify-between">
          <label className={labelCls}>Category</label>
          {canAdd && (
            <button
              type="button"
              onClick={() => setAddMode("category")}
              className={addButtonCls}
            >
              <Plus size={12} /> Add
            </button>
          )}
        </div>
        <div className="relative">
          <select
            value={categoryValue}
            disabled={Boolean(stockBlockReason)}
            onChange={(e) => onChange("category", e.target.value)}
            className={`${inputCls} appearance-none bg-white pr-8 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400`}
          >
            <option value="">{stockBlockReason || "Select category"}</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <ChevronDown
            size={16}
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"
          />
        </div>
      </div>

      <div className={skuClass}>
        <div className="flex items-start justify-between">
          <label className={labelCls}>SKU / Model</label>
          {canAdd && (
            <button
              type="button"
              disabled={!item.category}
              onClick={() => setAddMode("sku")}
              title={item.category ? "" : "Select a category first"}
              className={addButtonCls}
            >
              <Plus size={12} /> Add
            </button>
          )}
        </div>
        {stockMode ? (
          <StockSkuSelect
            value={skuValue}
            disabled={!item.category || Boolean(stockBlockReason)}
            placeholder={item.category ? "Select SKU / model" : "Select category first"}
            inputCls={inputCls}
            options={skus.map((sku) => ({
              sku,
              available: getStock(item.category, sku).available,
            }))}
            onSelect={(sku) => onChange("sku", sku)}
          />
        ) : (
          <div className="relative">
            <select
              value={skuValue}
              disabled={!item.category || Boolean(stockBlockReason)}
              onChange={(e) => onChange("sku", e.target.value)}
              className={`${inputCls} appearance-none bg-white pr-8 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400`}
            >
              <option value="">
                {item.category ? "Select SKU / model" : "Select category first"}
              </option>
              {skus.map((sku) => (
                <option key={sku} value={sku}>
                  {sku}
                </option>
              ))}
            </select>
            <ChevronDown
              size={16}
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"
            />
          </div>
        )}
      </div>

      {addMode && (
        <AddProductModal
          lockedCategory={addMode === "sku" ? categoryValue || item.category : ""}
          categories={categories}
          onClose={() => setAddMode(null)}
          onCreated={handleCreated}
        />
      )}
    </>
  );
}

/**
 * Small hint shown above the item rows when the product list is empty,
 * so people know why the dropdowns have nothing in them.
 *
 * `canAdd` = the form has the inline "Add" buttons (inward form).
 * `isAdmin` = the user can open the Product Management page.
 */
export function ItemProductNotice({ isAdmin = false, canAdd = false }) {
  const products = useSelector(selectAllProducts);
  const status = useSelector(selectProductStatus);

  if (status !== "succeeded" || products.length > 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
      No products have been added yet.{" "}
      {canAdd ? (
        <>Use the Add button next to Category to add the first one.</>
      ) : isAdmin ? (
        <>
          Add them in{" "}
          <Link to="/products" className="font-semibold underline">
            Product Management
          </Link>
          .
        </>
      ) : (
        "Ask an admin to add them in Product Management."
      )}
    </div>
  );
}
