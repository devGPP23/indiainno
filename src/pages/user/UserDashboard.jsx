import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "../../components/DashboardLayout";
import api from "../../utils/api";
import toast from "react-hot-toast";
import { HiOutlinePlus, HiOutlineClipboardList, HiOutlineClock, HiOutlineCheckCircle, HiOutlinePhone, HiOutlineLocationMarker, HiOutlineLightBulb, HiOutlineBeaker, HiOutlineTrash, HiOutlineDocumentText } from "react-icons/hi";
import { useAuth } from "../../contexts/AuthContext";

export default function UserDashboard() {
    const { userProfile } = useAuth();
    const [stats, setStats] = useState({ total: 0, open: 0, resolved: 0, pending: 0 });
    const [recentComplaints, setRecentComplaints] = useState([]);
    const [loading, setLoading] = useState(true);
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
                        <HiOutlineClipboardList className="text-4xl mb-3 mx-auto text-[var(--color-primary)] opacity-50" />
                        <p className="text-[var(--color-text-muted)]">No complaints yet. Submit your first one!</p>
                        <Link to="/citizen/submit" className="btn-primary mt-4 inline-flex">
                            <HiOutlinePlus /> Submit Complaint
                        </Link>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {recentComplaints.map((c) => (
                            <div key={c.id} className="flex items-center gap-4 p-3 rounded hover:bg-[var(--color-surface)] transition-colors">
                                <div className="w-10 h-10 rounded bg-[var(--color-primary)]/10 flex items-center justify-center text-lg flex-shrink-0 text-[var(--color-primary)]">
                                    {c.intentCategory === "Pothole" ? <HiOutlineLocationMarker /> :
                                        c.intentCategory === "Streetlight" ? <HiOutlineLightBulb /> :
                                            c.intentCategory === "Water_Leak" ? <HiOutlineBeaker /> :
                                                c.intentCategory === "Garbage" ? <HiOutlineTrash /> : <HiOutlineDocumentText />}
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
