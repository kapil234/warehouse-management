import { useEffect, useState } from "react";
import {
  Bell,
  MapPin,
  Package,
  LogOut,
  ChevronDown,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  fetchWarehouses,
  selectWarehouses,
  selectSelectedWarehouse,
  setSelectedWarehouse,
} from "../features/warehouse/warehouseSlice";

function Navbar({ location = "Delhi Warehouse" }) {
  const [user, setUser] = useState(null);
  const [warehouseOpen, setWarehouseOpen] = useState(false);
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const warehouses = useSelector(selectWarehouses);
  const selectedWarehouse = useSelector(selectSelectedWarehouse);

  const handleSignOut = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/", { replace: true });
  };

  useEffect(() => {
    dispatch(fetchWarehouses());
    const savedUser = localStorage.getItem("user");

    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (error) {
        console.error("Invalid user data:", error);
      }
    }
  }, [dispatch]);

  const userName = user?.name || "User";
  const userRole = user?.role || "";

  // Super admins see everything. Warehouse managers use the switcher
  // to focus the app on one of their assigned warehouses.
  const canSwitchWarehouse = userRole === "WAREHOUSE_MANAGER";

  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="h-16 bg-blue-700 flex items-center justify-between px-6 shrink-0">

      {/* Logo */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center">
          <Package className="text-white" size={18} />
        </div>

        <span className="text-white font-semibold text-base">
          InvTrack
        </span>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-5">

        {/* Warehouse switcher - warehouse managers only */}
        {canSwitchWarehouse && warehouses.length > 0 && (
          <div className="relative flex min-w-0">
            <button
              type="button"
              onClick={() => warehouses.length > 1 && setWarehouseOpen((value) => !value)}
              className="flex max-w-[150px] items-center gap-1.5 text-white/90 text-sm hover:text-white sm:max-w-none"
              aria-label="Switch warehouse"
              disabled={warehouses.length <= 1}
            >
              <MapPin size={14} />
              <span className="truncate">{selectedWarehouse?.name || location}</span>
              {warehouses.length > 1 && <ChevronDown size={14} />}
            </button>

            {warehouseOpen && warehouses.length > 1 && (
              <div className="absolute right-0 top-9 z-50 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                {warehouses.map((warehouse) => (
                  <button
                    key={warehouse.id}
                    type="button"
                    onClick={() => {
                      dispatch(setSelectedWarehouse(warehouse));
                      setWarehouseOpen(false);
                    }}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                      selectedWarehouse?.id === warehouse.id
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <span>{warehouse.name}</span>
                    <span className="text-xs text-gray-400">{warehouse.code}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Notification */}
        <button
          aria-label="Notifications"
          className="text-white/90 hover:text-white relative"
        >
          <Bell size={20} />

          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-400" />
        </button>

        {/* User */}
        <div className="flex items-center gap-2">

          {/* Initials */}
          <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-blue-700 text-xs font-semibold">
            {initials}
          </div>

          {/* Name + Role */}
          <div className="hidden md:block leading-tight">
            <div className="text-white text-sm font-medium">
              {userName}
            </div>

            <div className="text-white/70 text-xs">
              {userRole}
            </div>
          </div>

        </div>

        {/* Sign out - mobile only, sidebar handles it on desktop */}
        <button
          onClick={handleSignOut}
          aria-label="Sign out"
          className="md:hidden text-white/90 hover:text-white"
        >
          <LogOut size={20} />
        </button>
      </div>
    </header>
  );
}

export default Navbar;