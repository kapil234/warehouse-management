import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { ArrowLeft, Check, Eye, EyeOff, Loader2, Package, UserPlus } from "lucide-react";
import { signupUser, createUser, fetchMe, selectAuthStatus, selectAuthError } from "../features/auth/authSlice";
import { fetchWarehouses, selectWarehouses } from "../features/warehouse/warehouseSlice";
import { fetchCompanies, selectAllCompanies } from "../features/company/companySlice";

const ROLES = [
  { value: "SUPER_ADMIN", label: "Super Admin" },
  { value: "WAREHOUSE_MANAGER", label: "Warehouse Manager" },
];

const emptyAccess = () => ({ canInward: true, canOutward: true, canManageDocuments: true });

export default function Signup() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryCompanyId = searchParams.get("companyId") || "";
  const queryCompanyName = searchParams.get("companyName") || "Company";
  const currentUser = useSelector((state) => state.auth.user);
  const warehouses = useSelector(selectWarehouses);
  const companies = useSelector(selectAllCompanies);
  const authStatus = useSelector(selectAuthStatus);
  const serverError = useSelector(selectAuthError);
  const loading = authStatus === "loading";
  const canLoadWarehouses = Boolean(localStorage.getItem("token"));
  const isSuperAdmin = currentUser?.role === "SUPER_ADMIN";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState(queryCompanyId ? "WAREHOUSE_MANAGER" : "SUPER_ADMIN");
  const [companyId, setCompanyId] = useState(queryCompanyId);
  const [warehouseAccess, setWarehouseAccess] = useState({});
  const [errors, setErrors] = useState({});

  const isAddingForCompany = Boolean(queryCompanyId);

  const availableRoles = useMemo(() => {
    if (isAddingForCompany) return ROLES.filter((r) => r.value === "WAREHOUSE_MANAGER");
    if (isSuperAdmin) return ROLES;
    return ROLES.filter((r) => r.value === "SUPER_ADMIN");
  }, [isAddingForCompany, isSuperAdmin]);

  useEffect(() => {
    if (isSuperAdmin) dispatch(fetchCompanies());
    if (canLoadWarehouses && companyId && role === "WAREHOUSE_MANAGER") {
      dispatch(fetchWarehouses({ companyId }));
    }
  }, [dispatch, canLoadWarehouses, companyId, role, isSuperAdmin]);

  useEffect(() => {
    if (role !== "WAREHOUSE_MANAGER") setWarehouseAccess({});
  }, [role]);

  const toggleWarehouse = (id) => {
    setWarehouseAccess((prev) => {
      if (prev[id]) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: emptyAccess() };
    });
  };

  const updatePermission = (id, key) => {
    setWarehouseAccess((prev) => ({
      ...prev,
      [id]: { ...prev[id], [key]: !prev[id]?.[key] },
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setErrors({});
    const next = {};

    if (!name.trim()) next.name = "Full name is required";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = "Enter a valid email address";
    if (password.length < 8) next.password = "Password must be at least 8 characters";
    if (password !== confirmPassword) next.confirmPassword = "Passwords do not match";
    if (!role) next.role = "Please select a role";
    if (role !== "SUPER_ADMIN" && !companyId.trim()) next.companyId = "Company is required for this role";

    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }

    const access = Object.entries(warehouseAccess).map(([warehouseId, permissions]) => ({
      warehouseId,
      canInward: Boolean(permissions.canInward),
      canOutward: Boolean(permissions.canOutward),
      canManageDocuments: Boolean(permissions.canManageDocuments),
    }));

    const payload = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password,
      role,
      ...(role !== "SUPER_ADMIN" ? { companyId: companyId.trim() } : {}),
      ...(role === "WAREHOUSE_MANAGER" && access.length ? { warehouseAccess: access } : {}),
    };

    // Admin-created users use a separate thunk which deliberately does not
    // persist the newly returned JWT into Redux/localStorage. This keeps the
    // admin session alive and returns to the exact page the admin came from.
    // When a Super Admin creates a user from User Management, never use
    // the public signup flow. The public signup flow persists the newly
    // created user's session, which can log the admin out. Admin-created
    // users must be created without replacing the current admin session.
    const isAdminCreate = isSuperAdmin;

    const result = isAdminCreate
      ? await dispatch(createUser(payload))
      : await dispatch(signupUser(payload));

    if ((isAdminCreate ? createUser.fulfilled : signupUser.fulfilled).match(result)) {
      if (isAdminCreate) {
        // Return to User Management, not the newly created user's profile
        // and never to the login page.
        if (isAddingForCompany) {
          navigate(
            `/allusers?companyId=${encodeURIComponent(companyId)}&companyName=${encodeURIComponent(queryCompanyName)}`,
            { replace: true }
          );
        } else {
          navigate("/allusers", { replace: true });
        }
      } else {
        navigate("/dashboard", { replace: true });
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#F1EFE8] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="bg-blue-600 px-6 py-6 text-white">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-white/15 flex items-center justify-center"><Package size={22} /></div>
            <div><h1 className="text-xl font-semibold">{isAddingForCompany ? "Create user" : "Create account"}</h1><p className="text-sm text-blue-100">InvTrack warehouse operations</p></div>
          </div>
        </div>

        <form onSubmit={submit} className="p-6 space-y-5">
          {serverError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{serverError}</div>}
          {isAddingForCompany && <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">This user will be created inside the selected company. Warehouse access can be granted during signup.</div>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Full name" value={name} onChange={setName} error={errors.name} placeholder="Rahul Sharma" />
            <Field label="Email" type="email" value={email} onChange={setEmail} error={errors.email} placeholder="name@company.com" />
            <Field label="Password" type="password" value={password} onChange={setPassword} error={errors.password} placeholder="Minimum 8 characters" />
            <Field label="Confirm password" type="password" value={confirmPassword} onChange={setConfirmPassword} error={errors.confirmPassword} placeholder="Re-enter password" />
          </div>

          <label className="block">
            <span className="block text-sm font-medium text-gray-600 mb-1.5">Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500">
              {availableRoles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            {errors.role && <p className="mt-1 text-xs text-red-600">{errors.role}</p>}
          </label>

          {role !== "SUPER_ADMIN" && (
            <label className="block">
              <span className="block text-sm font-medium text-gray-600 mb-1.5">Company</span>
              <select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                disabled={isAddingForCompany}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              >
                <option value="">Select company</option>
                {companies.filter((c) => c.status !== "Inactive").map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {errors.companyId && <p className="mt-1 text-xs text-red-600">{errors.companyId}</p>}
            </label>
          )}

          {role === "WAREHOUSE_MANAGER" && (
            <div className="border-t pt-5">
              <div className="flex items-center justify-between mb-3"><div><h2 className="text-sm font-semibold text-gray-900">Warehouse access</h2><p className="text-xs text-gray-500 mt-0.5">Only warehouses granted here can be used by this manager.</p></div><span className="text-xs text-gray-400">Optional</span></div>
              {!canLoadWarehouses && <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">For a public signup, an admin must grant warehouse access after the account is created.</div>}
              {canLoadWarehouses && companyId && warehouses.length === 0 && <p className="text-xs text-gray-500">No warehouses found for this company.</p>}
              <div className="space-y-2">
                {canLoadWarehouses && warehouses.map((warehouse) => {
                  const selected = Boolean(warehouseAccess[warehouse.id]);
                  return <div key={warehouse.id} className="rounded-xl border border-gray-200 p-3">
                    <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={selected} onChange={() => toggleWarehouse(warehouse.id)} className="h-4 w-4" /><span className="text-sm font-medium text-gray-800">{warehouse.name}</span><span className="text-xs text-gray-500">{warehouse.code} • {warehouse.city}</span></label>
                    {selected && <div className="mt-3 ml-7 flex flex-wrap gap-3">{[["canInward","Inward"],["canOutward","Outward"],["canManageDocuments","Documents"]].map(([key,label]) => <label key={key} className="inline-flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={Boolean(warehouseAccess[warehouse.id]?.[key])} onChange={() => updatePermission(warehouse.id,key)} />{label}</label>)}</div>}
                  </div>;
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-3 border-t pt-5">
            <Link to={isSuperAdmin ? `/allusers${isAddingForCompany ? `?companyId=${encodeURIComponent(companyId)}&companyName=${encodeURIComponent(queryCompanyName)}` : ""}` : (isAddingForCompany ? `/allusers?companyId=${encodeURIComponent(companyId)}&companyName=${encodeURIComponent(queryCompanyName)}` : "/")} className="inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"><ArrowLeft size={16} /> Cancel</Link>
            <button disabled={loading} type="submit" className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"><UserPlus size={16} />{loading ? "Creating..." : isAddingForCompany ? "Create user" : "Create account"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder, error }) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";

  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-600 mb-1.5">{label}</span>
      <div className="relative">
        <input
          type={isPassword && showPassword ? "text" : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full rounded-lg border px-3 py-2.5 pr-10 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${error ? "border-red-400" : "border-gray-300"}`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </label>
  );
}
