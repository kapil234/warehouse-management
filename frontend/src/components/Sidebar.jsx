
import {
  Building2,
  FileBarChart,
  LayoutDashboard,
  LogOut,
  PackageMinus,
  PackagePlus,
  Package,
  Users,
  Warehouse,
  Settings,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { prefetchRoute } from "../routes/lazyPages";

const BASE_ITEMS = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  {
    key: "inward",
    label: "Inward",
    icon: PackagePlus,
  },
  {
    key: "outward",
    label: "Outward",
    icon: PackageMinus,
  },
  {
    key: "reports",
    label: "Reports",
    icon: FileBarChart,
  },
];

export default function Sidebar({
  active = "dashboard",
  onNavigate = () => {},
}) {
  const navigate = useNavigate();

  let user = null;

  try {
    user = JSON.parse(localStorage.getItem("user"));
  } catch {}

  const role = user?.role;

  // System Configuration items according to role
  const systemConfigItems =
    role === "SUPER_ADMIN"
      ? [
          {
            key: "companies",
            label: "Companies",
            icon: Building2,
          },
          {
            key: "allusers",
            label: "User Management",
            icon: Users,
          },
          {
            key: "warehousemanagement",
            label: "Warehouses",
            icon: Warehouse,
          },
          {
            key: "products",
            label: "Product Management",
            icon: Package,
          },
        ]
      : [];

  const showSystemConfiguration = systemConfigItems.length > 0;

  const signOut = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    navigate("/", {
      replace: true,
    });
  };

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-56 bg-white border-r border-gray-200 flex-col shrink-0">
        <nav className="flex-1 py-4 overflow-y-auto">

          {/* Main Navigation */}
          <ul className="space-y-1 px-3">
            {BASE_ITEMS.map(({ key, label, icon: Icon }) => {
              return (
                <li key={key}>
                  <button
                    onClick={() => onNavigate(key)}
                    onMouseEnter={() => prefetchRoute(key)}
                    onFocus={() => prefetchRoute(key)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                      active === key
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    }`}
                  >
                    <Icon size={18} />
                    {label}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* System Configuration */}
          {showSystemConfiguration && (
            <div className="mt-6 px-3">
              {/* Separator line */}
              <div className="border-t border-gray-200 mb-3" />

              {/* One-line heading */}
              <div className="flex items-center gap-2 px-3 mb-2 whitespace-nowrap">
                <Settings size={16} className="text-gray-500 shrink-0" />

                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  System Configuration
                </span>
              </div>

              {/* Configuration Items */}
              <ul className="space-y-1">
                {systemConfigItems.map(
                  ({ key, label, icon: Icon }) => {
                    return (
                      <li key={key}>
                        <button
                          onClick={() => onNavigate(key)}
                          onMouseEnter={() => prefetchRoute(key)}
                          onFocus={() => prefetchRoute(key)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                            active === key
                              ? "bg-blue-50 text-blue-700"
                              : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                          }`}
                        >
                          <Icon size={18} />
                          {label}
                        </button>
                      </li>
                    );
                  }
                )}
              </ul>
            </div>
          )}
        </nav>

        {/* Sign Out */}
        <div className="p-3 border-t border-gray-200">
          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-red-600"
          >
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile Bottom Navigation */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 flex items-stretch"
        style={{
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {BASE_ITEMS.slice(0, 5).map(
          ({ key, label, icon: Icon }) => {
            return (
              <button
                key={key}
                onClick={() => onNavigate(key)}
                onTouchStart={() => prefetchRoute(key)}
                aria-label={label}
                className={`flex-1 flex items-center justify-center py-3 ${
                  active === key
                    ? "text-blue-700"
                    : "text-gray-500"
                }`}
              >
                <Icon size={22} />
              </button>
            );
          }
        )}
      </nav>
    </>
  );
}


