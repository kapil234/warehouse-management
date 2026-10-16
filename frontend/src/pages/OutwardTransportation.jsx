import { useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, Loader2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  fetchOutwardById,
  saveOutwardTransportation,
  clearCurrentOutward,
  selectCurrentOutward,
  selectOutwardDetailStatus,
  selectOutwardDetailError,
} from "../features/outward/outwardSlice";
import { TRANSPORT_MODES, DISPATCH_MODES, isTransportSubmitted } from "../features/outward/outwardHelpers";

/**
 * =========================================================
 * TRANSPORTATION FORM  (Warehouse manager, Super admin)
 * =========================================================
 * Opens only after Account has approved the entry. The manager picks the vehicle type:
 *
 *   Dedicated vehicle -> Vehicle no. + Driver name + Driver contact
 *   Transportation    -> Transporter ID + Transporter name
 *
 * Submitting it sends the details to the account team, who can then upload Invoice / E-way bill /
 * DC Challan / Without Invoice / Other. Can be corrected until the entry is dispatched.
 * =========================================================
 */

const PHONE_RE = /^\d{10}$/;

export default function OutwardTransportation() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { id } = useParams();

  const outward = useSelector(selectCurrentOutward);
  const detailStatus = useSelector(selectOutwardDetailStatus);
  const detailError = useSelector(selectOutwardDetailError);

  const [mode, setMode] = useState("");
  const [dispatchMode, setDispatchMode] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverContact, setDriverContact] = useState("");
  const [transporterId, setTransporterId] = useState("");
  const [transporterName, setTransporterName] = useState("");
  const [transporterContact, setTransporterContact] = useState("");
  const [saving, setSaving] = useState(false);
  const [filled, setFilled] = useState(false);

  const inputCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-400";
  const labelCls = "block text-sm font-semibold text-black mb-1.5";

  useEffect(() => {
    if (id) dispatch(fetchOutwardById(id));
    return () => dispatch(clearCurrentOutward());
  }, [dispatch, id]);

  // Prefill when the form was already submitted (correcting it).
  useEffect(() => {
    if (!outward || outward.id !== id || filled) return;
    setFilled(true);
    if (isTransportSubmitted(outward)) {
      setMode(outward.transportMode || "");
      setDispatchMode(DISPATCH_MODES.includes(outward.dispatchMode) ? outward.dispatchMode : "");
      setVehicleNumber(outward.vehicleNumber || "");
      setDriverName(outward.driverName || "");
      setDriverContact(outward.driverContact || "");
      setTransporterId(outward.transporterId || "");
      setTransporterName(outward.transporterName || "");
      setTransporterContact(outward.transporterContact || "");
    }
  }, [outward, id, filled]);

  // Only an approved entry has this form (approved = the server sends a stage).
  useEffect(() => {
    if (detailStatus === "succeeded" && outward && outward.id === id && !outward.stage) {
      toast.info("The transportation form opens after the entry is approved.");
      navigate(`/outward/${id}`, { replace: true });
    }
  }, [detailStatus, outward, id, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (outward?.transportLocked) return toast.error("The transportation details are locked because the account team has already uploaded its documents.");
    if (!mode) return toast.error("Please select the vehicle type.");
    if (mode === "DEDICATED") {
      if (!vehicleNumber.trim()) return toast.error("Please enter the vehicle number.");
      if (!driverName.trim()) return toast.error("Please enter the driver name.");
      if (!driverContact.trim()) return toast.error("Please enter the driver contact number.");
      if (!PHONE_RE.test(driverContact.trim())) return toast.error("Please enter a driver contact number (10 digits).");
    } else {
      if (!transporterId.trim()) return toast.error("Please enter the transporter ID.");
      if (!transporterName.trim()) return toast.error("Please enter the transporter name.");
      if (!transporterContact.trim()) return toast.error("Please enter the transporter contact number.");
      if (!PHONE_RE.test(transporterContact.trim())) return toast.error("Please enter a transporter contact number (10 digits).");
    }

    setSaving(true);
    const result = await dispatch(
      saveOutwardTransportation({
        id,
        payload:
          mode === "DEDICATED"
            ? { transportMode: mode, dispatchMode, vehicleNumber: vehicleNumber.trim(), driverName: driverName.trim(), driverContact: driverContact.trim() }
            : { transportMode: mode, dispatchMode, transporterId: transporterId.trim(), transporterName: transporterName.trim(), transporterContact: transporterContact.trim() },
      })
    );
    setSaving(false);

    if (saveOutwardTransportation.rejected.match(result)) {
      return toast.error(result.payload || "Failed to save transportation details.");
    }
    toast.success(result.payload?.message || "Transportation details saved.");
    navigate(`/outward/${id}`, { replace: true });
  };

  if (detailStatus === "loading" || (detailStatus === "idle" && !outward) || (outward && outward.id !== id)) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-50 text-gray-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading outward entry...
      </div>
    );
  }

  if (detailError || !outward) {
    return (
      <div className="min-h-dvh bg-gray-50 p-4 sm:p-6">
        <button onClick={() => navigate(`/outward/${id}`)} className="mb-6 flex items-center gap-2 text-gray-600"><ArrowLeft size={20} />Back</button>
        <div className="rounded-xl border border-red-200 bg-white p-6 text-red-600">{detailError || "Outward entry not found."}</div>
      </div>
    );
  }

  const submitted = isTransportSubmitted(outward);
  // Frozen for everyone once Account has uploaded its documents (the server refuses changes too).
  const locked = Boolean(outward.transportLocked);

  return (
    <div className="min-h-dvh bg-gray-50 px-4 py-6 md:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center gap-3 sm:mb-6">
          <button type="button" onClick={() => navigate(`/outward/${id}`)} className="text-gray-500 hover:text-gray-800"><ArrowLeft size={22} /></button>
          <div>
            <h1 className="text-base font-semibold text-gray-900 md:text-lg">{locked ? "Transportation details" : submitted ? "Update transportation details" : "Transportation details"}</h1>
            <p className="text-xs text-gray-400">{outward.outwardNumber}</p>
          </div>
        </div>

        {locked && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 sm:text-sm">
            These details are locked. The account team has already uploaded its documents, so the transportation details can no longer be changed.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <fieldset disabled={locked} className="min-w-0 border-0 p-0">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Vehicle</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelCls}>Dispatch mode</label>
                <div className="relative">
                  <select value={dispatchMode} onChange={(e) => setDispatchMode(e.target.value)} className={`${inputCls} appearance-none`}>
                    <option value="">Select dispatch mode</option>
                    {DISPATCH_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Vehicle type</label>
                <div className="relative">
                  <select value={mode} onChange={(e) => setMode(e.target.value)} className={`${inputCls} appearance-none`}>
                    <option value="">Select vehicle type</option>
                    {TRANSPORT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                </div>
              </div>

              {mode === "DEDICATED" && (
                <>
                  <div><label className={labelCls}>Vehicle no.</label><input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} placeholder="e.g. DL01AB1234" className={inputCls} /></div>
                  <div><label className={labelCls}>Driver name</label><input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Enter driver name" className={inputCls} /></div>
                  <div><label className={labelCls}>Driver contact</label><input type="tel" inputMode="numeric" maxLength={10} value={driverContact} onChange={(e) => setDriverContact(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="Enter driver contact no." className={inputCls} /></div>
                </>
              )}

              {mode === "TRANSPORTATION" && (
                <>
                  <div><label className={labelCls}>Transporter ID</label><input value={transporterId} onChange={(e) => setTransporterId(e.target.value)} placeholder="Enter transporter ID" className={inputCls} /></div>
                  <div><label className={labelCls}>Transporter name</label><input value={transporterName} onChange={(e) => setTransporterName(e.target.value)} placeholder="Enter transporter name" className={inputCls} /></div>
                  <div><label className={labelCls}>Transporter contact</label><input type="tel" inputMode="numeric" maxLength={10} value={transporterContact} onChange={(e) => setTransporterContact(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="Enter transporter contact no." className={inputCls} /></div>
                </>
              )}
            </div>
            {!locked && (
              <p className="mt-4 text-xs text-gray-500">
                After you submit, the details go to the account team. Once the account team uploads its documents, these details can no longer be changed.
              </p>
            )}
          </section>
          </fieldset>

          {!locked && <button type="submit" disabled={saving} className="w-full rounded-lg bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-black disabled:opacity-40">
            {saving ? "Saving..." : submitted ? "Update transportation details" : "Submit to account team"}
          </button>}
        </form>
      </div>
    </div>
  );
}
