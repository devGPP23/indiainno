import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "../../components/DashboardLayout";
import api from "../../utils/api";
import toast from "react-hot-toast";
import { HiOutlinePlus, HiOutlineClipboardList, HiOutlineClock, HiOutlineCheckCircle, HiOutlinePhone } from "react-icons/hi";
import { useAuth } from "../../contexts/AuthContext";

export default function UserDashboard() {
    const { userProfile } = useAuth();
    const [stats, setStats] = useState({ total: 0, open: 0, resolved: 0, pending: 0 });
    const [recentComplaints, setRecentComplaints] = useState([]);
    const [loading, setLoading] = useState(true);
    const [calling, setCalling] = useState(false);
    const fetchedRef = useRef(false);

    useEffect(() => {
        if (fetchedRef.current) return;
        fetchedRef.current = true;

        const fetchData = async () => {
            try {
                const { data } = await api.get('/tickets/my-complaints', { timeout: 30000 });
                const complaints = data;
                let open = 0, resolved = 0, pending = 0;

                complaints.forEach(c => {
                    let status = c.ticket?.status || c.status;
                    if (status === "Closed") resolved++;
                    else if (status === "Pending_Verification") pending++;
                    else open++;
                });

                setStats({ total: complaints.length, open, resolved, pending });
                setRecentComplaints(complaints.slice(0, 5));
            } catch (err) {
                console.error("Error fetching user data:", err);
                const msg = err?.code === 'ECONNABORTED'
                    ? "Complaints are taking longer than expected. Please wait and refresh."
                    : (err?.response?.data?.message || "Could not load complaints. Please refresh.");
                toast.error(msg);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    const handleCallMe = async () => {
        if (calling) return;
        setCalling(true);
        toast.dismiss(); // Clear any existing toasts to prevent flood
        try {
            const userPhone = userProfile?.phone?.trim() || "";
            if (!userPhone) {
                toast.error("No phone number found in your profile.");
                setCalling(false);
                return;
            }

            const { data } = await api.post('/voice/call-me', {}, { timeout: 20000 });
            toast.success(data.message || "Call initiated! Your phone will ring shortly.", { duration: 6000, icon: '📞' });
        } catch (err) {
            const msg =
                err.response?.data?.message ||
                err.response?.data?.detail?.RestException?.Message ||
                "Failed to initiate call. Please try again.";
            toast.error(msg, { duration: 8000, id: 'call-error' });
        }
        setCalling(false);
    };

    const statCards = [
        { label: "Total Complaints", value: stats.total, icon: <HiOutlineClipboardList className="text-2xl text-[#6366f1]" />, color: "from-[#6366f1]/10" },
        { label: "Open", value: stats.open, icon: <HiOutlineClock className="text-2xl text-[#3b82f6]" />, color: "from-[#3b82f6]/10" },
        { label: "Pending Verification", value: stats.pending, icon: <HiOutlineClock className="text-2xl text-[#f59e0b]" />, color: "from-[#f59e0b]/10" },
        { label: "Resolved", value: stats.resolved, icon: <HiOutlineCheckCircle className="text-2xl text-[#22c55e]" />, color: "from-[#22c55e]/10" },
    ];

    return (
        <DashboardLayout title="Citizen Dashboard" subtitle="Track and manage your civic complaints">
            <div className="flex flex-wrap gap-3 mb-8 animate-fadeInUp">
                <Link to="/citizen/submit" className="btn-primary">
                    <HiOutlinePlus className="text-lg" /> Submit New Complaint
                </Link>
                <Link to="/citizen/complaints" className="btn-secondary">
                    View All Complaints
                </Link>
                <button
                    onClick={handleCallMe}
                    disabled={calling}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm transition-all cursor-pointer"
                    style={{
                        background: calling ? '#94a3b8' : 'linear-gradient(135deg, #059669, #10b981)',
                        color: '#fff',
                        border: 'none',
                        boxShadow: '0 2px 8px rgba(5,150,105,0.25)',
                        opacity: calling ? 0.7 : 1,
                    }}
                >
                    {calling ? (
                        <><div className="spinner w-4 h-4 border-2" /> Connecting...</>
                    ) : (
                        <><HiOutlinePhone className="text-lg" /> Contact Authorities</>
                    )}
                </button>
            </div>

            <div className="bg-[#ecfdf5] border border-[#a7f3d0] rounded-xl p-4 mb-8 animate-fadeInUp">
                <p className="text-[#065f46] text-xs mb-2">
                    <strong>📞 How it works:</strong> Click "Contact Authorities" and we'll call your registered phone number. Select your language, describe your complaint in any Indian language — our AI will automatically transcribe, classify the department, and register your complaint. It will appear on your dashboard instantly!
                </p>
                <p className="text-[#065f46] text-xs">
                    <strong>☎️ Toll-Free Helpline:</strong> You can also dial <strong style={{ fontSize: '13px', letterSpacing: '0.5px' }}>918047360814</strong> directly from any phone. Our system will call you back and register your complaint automatically.
                </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 stagger">
                {statCards.map((s, i) => (
                    <div key={i} className={`stat-card bg-gradient-to-br ${s.color} to-transparent animate-fadeInUp`}>
                        <div className="flex items-center justify-between mb-3">
                            {s.icon}
                            <span className="text-2xl font-bold">{loading ? "—" : s.value}</span>
                        </div>
                        <p className="text-xs text-[var(--color-text-muted)] font-medium">{s.label}</p>
                    </div>
                ))}
            </div>

            <div className="card animate-fadeInUp" style={{ animationDelay: "200ms" }}>
                <h2 className="text-lg font-semibold mb-4">Recent Complaints</h2>
                {loading ? (
                    <div className="flex justify-center py-8"><div className="spinner" /></div>
                ) : recentComplaints.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-4xl mb-3">📋</p>
                        <p className="text-[var(--color-text-muted)]">No complaints yet. Submit your first one!</p>
                        <Link to="/citizen/submit" className="btn-primary mt-4 inline-flex">
                            <HiOutlinePlus /> Submit Complaint
                        </Link>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {recentComplaints.map((c) => (
                            <div key={c.id} className="flex items-center gap-4 p-3 rounded-xl hover:bg-[var(--color-surface)] transition-colors">
                                <div className="w-10 h-10 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center text-lg flex-shrink-0">
                                    {c.intentCategory === "Pothole" ? "🕳️" :
                                        c.intentCategory === "Streetlight" ? "💡" :
                                            c.intentCategory === "Water_Leak" ? "💧" :
                                                c.intentCategory === "Garbage" ? "🗑️" : "📋"}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm truncate">{c.intentCategory?.replace(/_/g, " ")} — {c.extractedLandmark || c.ticket?.landmark || "Unknown Location"}</p>
                                    <p className="text-xs text-[var(--color-text-muted)]">{new Date(c.createdAt).toLocaleDateString()}</p>
                                </div>
                                <span className={`badge status-${(c.ticket?.status || c.status || "open").toLowerCase()}`}>
                                    {c.ticket?.status || c.status || "Open"}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
