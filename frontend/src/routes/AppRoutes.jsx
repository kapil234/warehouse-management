import { Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";

// Login stays in the main bundle - it is the first screen most
// visitors see. Everything else is loaded on demand (see lazyPages.js).
import Login from "../pages/Login";
import AppLayout from "../components/AppLayout";
import ProtectedRoute from "../components/ProtectedRoutes";
import RouteFallback from "../components/RouteFallback";
import {
  Signup,
  Dashboard,
  Reports,
  InwardForm,
  InwardList,
  InwardDetail,
  OutwardForm,
  OutwardList,
  OutwardDetail,
  AllUsers,
  WarehouseManagement,
  CompanyManagement,
  StockLedger,
  ProductManagement,
} from "./lazyPages";

// Full-screen flows have no shell around them, so they get their own
// Suspense boundary + a protected wrapper.
const fullScreen = (page) => (
  <ProtectedRoute>
    <Suspense fallback={<RouteFallback fullScreen />}>{page}</Suspense>
  </ProtectedRoute>
);

const router = createBrowserRouter([
  {
    path: "/",
    element: <Login />,
  },

  {
    path: "/signup",
    element: (
      <Suspense fallback={<RouteFallback fullScreen />}>
        <Signup />
      </Suspense>
    ),
  },

  // Pages that live inside the shared Navbar + Sidebar shell.
  // AppLayout derives which tab is active from the URL itself,
  // so switching tabs (or hitting Back after opening a detail
  // page) always lands on the right page instead of resetting
  // to the dashboard. AppLayout also owns the Suspense boundary,
  // so the Navbar + Sidebar stay on screen while a page chunk loads.
  {
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { path: "/dashboard", element: <Dashboard /> },
      { path: "/inward", element: <InwardList /> },
      { path: "/outward", element: <OutwardList /> },
      { path: "/reports", element: <Reports /> },
      { path: "/allusers", element: <AllUsers /> },
      { path: "/stock-ledger", element: <StockLedger /> },
      { path: "/warehousemanagement", element: <WarehouseManagement /> },
      { path: "/companies", element: <CompanyManagement /> },
      { path: "/products", element: <ProductManagement /> },
    ],
  },

  // Full-screen flows (create forms + detail pages) - these have
  // their own header + Back button and intentionally render
  // without the sidebar/navbar shell.
  { path: "/inward/create", element: fullScreen(<InwardForm />) },
  { path: "/inward/:id/edit", element: fullScreen(<InwardForm />) },
  { path: "/inward/:id", element: fullScreen(<InwardDetail />) },

  { path: "/outward/create", element: fullScreen(<OutwardForm />) },
  { path: "/outward/:id/edit", element: fullScreen(<OutwardForm />) },
  { path: "/outward/:id", element: fullScreen(<OutwardDetail />) },
]);

export default router;
