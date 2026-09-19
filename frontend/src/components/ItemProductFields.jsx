import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { ChevronDown } from "lucide-react";
import {
  selectAllProducts,
  selectProductStatus,
} from "../features/product/productSlice";

const sameText = (a, b) =>
  String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

/**
 * Category + SKU / Model dropdowns for one item row on the inward and
 * outward forms. Options come from the product list that admins manage
 * on the Product Management page - nothing can be typed in here.
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
}) {
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

  return (
    <>
      <div className={categoryClass}>
        <label className={labelCls}>Category</label>
        <div className="relative">
          <select
            value={categoryValue}
            onChange={(e) => onChange("category", e.target.value)}
            className={`${inputCls} appearance-none bg-white pr-8`}
          >
            <option value="">Select category</option>
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
        <label className={labelCls}>SKU / Model</label>
        <div className="relative">
          <select
            value={skuValue}
            disabled={!item.category}
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
      </div>
    </>
  );
}

/**
 * Small hint shown above the item rows when the product list is empty,
 * so people know why the dropdowns have nothing in them.
 */
export function ItemProductNotice({ isAdmin = false }) {
  const products = useSelector(selectAllProducts);
  const status = useSelector(selectProductStatus);

  if (status !== "succeeded" || products.length > 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
      No products have been added yet.{" "}
      {isAdmin ? (
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
