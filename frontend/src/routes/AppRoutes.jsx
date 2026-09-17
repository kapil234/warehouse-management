import { createBrowserRouter } from "react-router-dom";
import Login from "../pages/Login";
import Signup from "../pages/Signup";
import Dashboard from "../pages/Dashboard";
import Reports from "../pages/Reports";
import AppLayout from "../components/AppLayout";
import InwardForm from "../pages/InwardForm";

import InwardList from "../pages/InwardList";
import InwardDetail from "../pages/InwardDetail";

import ProtectedRoute from "../components/ProtectedRoutes";
import OutwardForm from "../pages/OutwardForm";
import OutwardList from "../pages/OutwardList";
import OutwardDetail from "../pages/OutwardDetail";
import AllUsers from "../pages/AllUsers";
import WarehouseManagement from "../pages/WarehouseMangement";
import CompanyManagement from "../pages/CompanyManagement";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Login />,
  },

  {
    path: "/signup",
    element: <Signup />,
  },

  // Pages that live inside the shared Navbar + Sidebar shell.
  // AppLayout derives which tab is active from the URL itself,
  // so switching tabs (or hitting Back after opening a detail
  // page) always lands on the right page instead of resetting
  // to the dashboard.
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
      { path: "/allusers", element: <AllUsers/>},
      {path:"/warehousemanagement",element:<WarehouseManagement/>},
      { path: "/companies", element: <CompanyManagement /> }
    ],
  },

  // Full-screen flows (create forms + detail pages) - these have
  // their own header + Back button and intentionally render
  // without the sidebar/navbar shell.
  {
    path: "/inward/create",
    element: (
      <ProtectedRoute>
        <InwardForm />
      </ProtectedRoute>
    ),
  },

  {
    path: "/inward/:id/edit",
    element: (
      <ProtectedRoute>
        <InwardForm />
      </ProtectedRoute>
    ),
  },

  {
    path: "/inward/:id",
    element: (
      <ProtectedRoute>
        <InwardDetail />
      </ProtectedRoute>
    ),
  },

  {
    path: "/outward/create",
    element: (
      <ProtectedRoute>
        <OutwardForm />
      </ProtectedRoute>
    ),
  },

  {
    path: "/outward/:id/edit",
    element: (
      <ProtectedRoute>
        <OutwardForm />
      </ProtectedRoute>
    ),
  },

  {
    path: "/outward/:id",
    element: (
      <ProtectedRoute>
        <OutwardDetail />
      </ProtectedRoute>
    ),
  },
]);

export default router;
