import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import apiClient from "../../services/apiClient";

// =====================================================
// PRODUCT MASTER
//
// A product is a category (Inverter, Cable, Panel...) plus a
// SKU / module name. Everyone can read the list (the inward and
// outward forms use it), only SUPER_ADMIN can create / edit / delete.
// =====================================================

const initialState = {
  list: [],

  // Fetch status
  status: "idle",

  // Create / update / delete status
  saveStatus: "idle",

  error: null,
};

const sortProducts = (list) =>
  list.sort(
    (a, b) =>
      a.category.localeCompare(b.category) || a.sku.localeCompare(b.sku)
  );

// GET /api/products
export const fetchProducts = createAsyncThunk(
  "product/fetchAll",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get("/api/products");
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to fetch products"
      );
    }
  }
);

// POST /api/products
export const createProduct = createAsyncThunk(
  "product/create",
  async (productData, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.post("/api/products", productData);
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to create product"
      );
    }
  }
);

// PATCH /api/products/:id
export const updateProduct = createAsyncThunk(
  "product/update",
  async ({ id, ...fields }, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.patch(`/api/products/${id}`, fields);
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to update product"
      );
    }
  }
);

// DELETE /api/products/:id
export const deleteProduct = createAsyncThunk(
  "product/delete",
  async (id, { rejectWithValue }) => {
    try {
      await apiClient.delete(`/api/products/${id}`);
      return id;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to delete product"
      );
    }
  }
);

const productSlice = createSlice({
  name: "product",

  initialState,

  reducers: {
    clearProductError: (state) => {
      state.error = null;
    },
  },

  extraReducers: (builder) => {
    builder
      // ---------------- fetch ----------------
      .addCase(fetchProducts.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchProducts.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.list = Array.isArray(action.payload)
          ? action.payload
          : action.payload?.data || [];
      })
      .addCase(fetchProducts.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload || "Failed to fetch products";
      })

      // ---------------- create ----------------
      .addCase(createProduct.pending, (state) => {
        state.saveStatus = "loading";
        state.error = null;
      })
      .addCase(createProduct.fulfilled, (state, action) => {
        state.saveStatus = "succeeded";
        const created = action.payload?.product || action.payload;
        if (created?.id) {
          state.list.push(created);
          sortProducts(state.list);
        }
      })
      .addCase(createProduct.rejected, (state) => {
        // The form shows the message itself, so don't also set the page-level error.
        state.saveStatus = "failed";
      })

      // ---------------- update ----------------
      .addCase(updateProduct.pending, (state) => {
        state.saveStatus = "loading";
        state.error = null;
      })
      .addCase(updateProduct.fulfilled, (state, action) => {
        state.saveStatus = "succeeded";
        const updated = action.payload?.product || action.payload;
        if (!updated?.id) return;
        const index = state.list.findIndex((p) => p.id === updated.id);
        if (index !== -1) {
          state.list[index] = updated;
          sortProducts(state.list);
        }
      })
      .addCase(updateProduct.rejected, (state) => {
        state.saveStatus = "failed";
      })

      // ---------------- delete ----------------
      .addCase(deleteProduct.fulfilled, (state, action) => {
        state.list = state.list.filter((p) => p.id !== action.payload);
      })
      .addCase(deleteProduct.rejected, (state, action) => {
        state.error = action.payload || "Failed to delete product";
      });
  },
});

export const { clearProductError } = productSlice.actions;

export const selectAllProducts = (state) => state.product.list;
export const selectProductStatus = (state) => state.product.status;
export const selectProductSaveStatus = (state) => state.product.saveStatus;
export const selectProductError = (state) => state.product.error;

export default productSlice.reducer;
