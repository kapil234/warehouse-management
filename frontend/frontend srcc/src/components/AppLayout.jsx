import { Suspense, useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import Navbar from "./Navbar";
import Sidebar from "./Sidebar";
import RouteFallback from "./RouteFallback";
import { prefetchRoute } from "../routes/lazyPages";

// Derives which sidebar/bottom-nav item should be highlighted
// from the actual URL, instead of local component state - this
// is what makes browser/`navigate(-1)` back-navigation land on
// the right page instead of resetting to the dashboard tab.
function getActiveKey(pathname) {
  if (pathname.startsWith("/inward")) return "inward";
  if (pathname.startsWith("/outward")) return "outward";
  if (pathname.startsWith("/reports")) return "reports";
  if (pathname.startsWith("/companies")) return "companies";
  if (pathname.startsWith("/products")) return "products";
  if (pathname.startsWith("/allusers")) return "allusers";
  if (pathname.startsWith("/warehousemanagement")) return "warehousemanagement";
  return "dashboard";
}

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const active = getActiveKey(location.pathname);

  // Once the shell is up and the browser is idle, download the pages people
  // open most so navigating to them doesn't wait on a network round-trip.
  useEffect(() => {
    const warm = () =>
      ["dashboard", "inward", "outward", "reports", "inwardForm", "outwardForm"].forEach(
        prefetchRoute
      );

    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }

    const id = setTimeout(warm, 2000);
    return () => clearTimeout(id);
  }, []);

  const handleNavigate = (key) => {
    navigate(`/${key}`);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <Navbar location="Delhi Warehouse" />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar active={active} onNavigate={handleNavigate} />

        {/* pb-16 reserves space for Sidebar's mobile bottom bar;
            md:pb-0 because that bar is hidden at md+ (real sidebar shown instead) */}
        <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
