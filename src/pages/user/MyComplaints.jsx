import { useState, useEffect, useRef } from "react";
import DashboardLayout from "../../components/DashboardLayout";
import api from "../../utils/api";
import { TICKET_STATUSES } from "../../data/departments";
import toast from "react-hot-toast";

export default function MyComplaints() {
    const [complaints, setComplaints] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("all");
    const [reComplaintId, setReComplaintId] = useState(null);
    const [reComplaintFeedback, setReComplaintFeedback] = useState("");
    const [submittingRecomplaint, setSubmittingRecomplaint] = useState(false);
    const fetchedRef = useRef(false);

    useEffect(() => {
        if (fetchedRef.current) return;
        fetchedRef.current = true;

        const fetchComplaints = async () => {
            try {
                const { data } = await api.get('/tickets/my-complaints', { timeout: 30000 });
                setComplaints(data);
            } catch (err) {
                console.error("Error fetching complaints:", err);
                const msg = err?.code === 'ECONNABORTED'
                    ? "Complaints are taking longer than expected. Please wait and refresh."
                    : (err?.response?.data?.message || "Could not load complaints. Please refresh.");
                toast.error(msg);
            } finally {
                setLoading(false);
            }
        };
        fetchComplaints();
    }, []);

    const handleVerify = async (ticketId, verified, rating = null) => {
        try {
            await api.put(`/tickets/master/${ticketId}/verify`, { verified, rating });
            const tid = ticketId?.toString();
            setComplaints(prev => prev.map(c => {
                const cid = (c.ticket?.id || c.masterTicketId)?.toString();
                if (cid === tid) {
                    return {
                        ...c,
                        ticket: c.ticket ? { ...c.ticket, status: verified ? 'Closed' : 'Disputed', citizenRating: rating } : undefined,
                        status: verified ? 'Closed' : 'Disputed'
                    };
                }
                return c;
            }));
            if (verified) toast.success('Thank you! Issue marked as resolved.');
            else toast.success('Dispute has been logged.');
        } catch (error) {
            console.error(error);
            toast.error('Failed to submit verification');
        }
    };

    const handleRecomplaint = async (ticketId) => {
        if (!reComplaintFeedback.trim()) return toast.error("Please provide feedback for your re-complaint");
        setSubmittingRecomplaint(true);
        try {
            const { data } = await api.put(`/tickets/master/${ticketId}/recomplaint`, { feedback: reComplaintFeedback });
            const tid = ticketId?.toString();
            setComplaints(prev => prev.map(c => {
                const cid = (c.ticket?.id || c.masterTicketId)?.toString();
                if (cid === tid) {
                    return {
                        ...c,
                        ticket: c.ticket ? { ...c.ticket, status: 'Disputed', progressPercent: 0, reComplaintCount: data.reComplaintCount } : undefined,
                        status: 'Disputed'
                    };
                }
                return c;
            }));
            toast.success('Re-complaint submitted. The issue has been reopened.');
            setReComplaintId(null);
            setReComplaintFeedback("");
        } catch (error) {
            console.error(error);
            toast.error(error?.response?.data?.message || 'Failed to submit re-complaint');
        }
        setSubmittingRecomplaint(false);
    };

    const filteredComplaints = filter === "all"
        ? complaints
        : complaints.filter((c) => (c.ticket?.status || c.status || "Open") === filter);

    const getCategoryIcon = (cat) => {
        const iconMap = {
            Pothole: "🕳️", Road_Damage: "🛣️", Streetlight: "💡", Power_Outage: "⚡",
            Water_Leak: "💧", No_Water: "🚰", Garbage: "🗑️", Sewage_Overflow: "🚿",
            Traffic_Signal: "🚦", Fire_Hazard: "🔥", Noise_Complaint: "📢",
            Hospital_Issue: "🏥", Tree_Felling: "🌳",
        };
        return iconMap[cat] || "📋";
    };

    const getStatusLabel = (status) => {
        switch (status) {
            case 'Open': return 'Complaint Sent';
            case 'Assigned': return 'Assigned to Engineer';
            case 'In_Progress': return 'Work In Progress';
            case 'Pending_Verification': return 'Solution Done — Review Required';
            case 'Closed': return 'Resolved';
            case 'Disputed': return 'Re-opened / Disputed';
            default: return status?.replace(/_/g, ' ') || 'Complaint Sent';
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'Open': return '#3b82f6';
            case 'Assigned': return '#8b5cf6';
            case 'In_Progress': return '#f59e0b';
            case 'Pending_Verification': return '#22c55e';
            case 'Closed': return '#10b981';
            case 'Disputed': return '#ef4444';
            default: return '#6b7280';
        }
    };

    const getProgressForStatus = (status, progressPercent) => {
        if (progressPercent > 0) return progressPercent;
        switch (status) {
            case 'Open': return 10;
            case 'Assigned': return 25;
            case 'In_Progress': return 50;
            case 'Pending_Verification': return 90;
            case 'Closed': return 100;
            case 'Disputed': return 50;
            default: return 5;
        }
    };

    return (
        <DashboardLayout title="My Complaints" subtitle="Track all your submitted complaints">
            {/* Filters */}
            <div className="flex flex-wrap gap-2 mb-6 animate-fadeInUp">
                <button
                    onClick={() => setFilter("all")}
                    className={`badge cursor-pointer transition-all ${filter === "all" ? "bg-[var(--color-primary)]/20 text-[var(--color-primary-light)] ring-1 ring-[var(--color-primary)]" : "bg-[var(--color-surface)] text-[var(--color-text-muted)]"}`}
                >
                    All ({complaints.length})
                </button>
                {TICKET_STATUSES.slice(0, 6).map((s) => {
                    const count = complaints.filter((c) => (c.ticket?.status || c.status) === s.value).length;
                    return (
                        <button
                            key={s.value}
                            onClick={() => setFilter(s.value)}
                            className={`badge cursor-pointer transition-all ${filter === s.value ? `status-${s.value.toLowerCase()} ring-1` : "bg-[var(--color-surface)] text-[var(--color-text-muted)]"}`}
                        >
                            {s.label} ({count})
                        </button>
                    );
                })}
            </div>

            {loading ? (
                <div className="flex justify-center py-16"><div className="spinner" /></div>
            ) : filteredComplaints.length === 0 ? (
                <div className="card text-center py-16">
                    <p className="text-4xl mb-3">🔍</p>
                    <p className="text-[var(--color-text-muted)]">No complaints found</p>
                </div>
            ) : (
                <div className="space-y-4 stagger">
                    {filteredComplaints.map((c) => {
                        const status = c.ticket?.status || c.status || "Open";
                        const severity = c.ticket?.severity || "Low";
                        const progressPercent = getProgressForStatus(status, c.ticket?.progressPercent || 0);
                        const statusColor = getStatusColor(status);
                        const isResolved = status === 'Pending_Verification' || status === 'Closed';

                        return (
                            <div key={c.id} className="card animate-fadeInUp hover:bg-[var(--color-card-hover)]" style={{ overflow: 'hidden', padding: 0 }}>
                                {/* ── Tracking Banner ── */}
                                <div style={{
                                    background: `linear-gradient(135deg, ${statusColor}10, ${statusColor}05)`,
                                    borderBottom: `2px solid ${statusColor}30`,
                                    padding: '14px 20px',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <span style={{ fontSize: 22 }}>{getCategoryIcon(c.intentCategory)}</span>
                                            <div>
                                                <h3 style={{ fontWeight: 700, fontSize: 15, color: '#1e293b', margin: 0 }}>
                                                    {c.intentCategory?.replace(/_/g, " ")}
                                                </h3>
                                                {c.ticket?.ticketNumber && (
                                                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#64748b' }}>{c.ticket.ticketNumber}</span>
                                                )}
                                            </div>
                                        </div>
                                        <div style={{
                                            background: statusColor,
                                            color: '#fff',
                                            padding: '4px 12px',
                                            borderRadius: 20,
                                            fontSize: 12,
                                            fontWeight: 600,
                                        }}>
                                            {getStatusLabel(status)}
                                        </div>
                                    </div>

                                    {/* Progress bar */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <div style={{ flex: 1, background: '#e2e8f0', borderRadius: 10, height: 8, overflow: 'hidden' }}>
                                            <div style={{
                                                width: `${progressPercent}%`,
                                                height: '100%',
                                                background: `linear-gradient(90deg, ${statusColor}, ${statusColor}cc)`,
                                                borderRadius: 10,
                                                transition: 'width 0.5s ease',
                                            }} />
                                        </div>
                                        <span style={{ fontSize: 13, fontWeight: 700, color: statusColor, minWidth: 40, textAlign: 'right' }}>
                                            {progressPercent}%
                                        </span>
                                    </div>
                                </div>

                                {/* ── Card Body ── */}
                                <div style={{ padding: '16px 20px' }}>
                                    <div className="flex items-center gap-2 flex-wrap mb-1">
                                        <span className={`badge severity-${severity.toLowerCase()}`}>{severity}</span>
                                    </div>
                                    <p className="text-sm text-[var(--color-text-muted)] mb-2 line-clamp-2">{c.transcriptOriginal}</p>
                                    <div className="flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
                                        {c.extractedLandmark && <span>📍 {c.extractedLandmark}</span>}
                                        <span>🕐 {new Date(c.createdAt).toLocaleDateString()}</span>
                                        {c.ticket?.complaintCount > 1 && (
                                            <span className="text-[var(--color-warning)]">👥 {c.ticket.complaintCount} reports</span>
                                        )}
                                        {c.ticket?.reComplaintCount > 0 && (
                                            <span style={{ color: '#ef4444' }}>🔄 Re-complained {c.ticket.reComplaintCount}x</span>
                                        )}
                                    </div>

                                    {/* ── Satisfied / Re-complaint Actions (only for Pending_Verification) ── */}
                                    {status === 'Pending_Verification' && (
                                        <div style={{
                                            marginTop: 16,
                                            paddingTop: 16,
                                            borderTop: '1px solid #e2e8f0'
                                        }}>
                                            {c.ticket?.resolutionNotes && (
                                                <p style={{
                                                    fontSize: 13,
                                                    color: '#334155',
                                                    background: '#f8fafc',
                                                    padding: '10px 14px',
                                                    borderRadius: 8,
                                                    marginBottom: 12,
                                                    borderLeft: '3px solid #22c55e'
                                                }}>
                                                    <strong style={{ color: '#16a34a' }}>Resolution: </strong>
                                                    {c.ticket.resolutionNotes}
                                                </p>
                                            )}
                                            {c.ticket?.resolutionImageUrl && (
                                                <img src={c.ticket.resolutionImageUrl} alt="Resolution" className="w-full h-48 object-cover rounded-md mb-3" />
                                            )}

                                            {reComplaintId === (c.ticket?.id || c.masterTicketId) ? (
                                                /* Re-complaint feedback form */
                                                <div style={{ background: '#fef2f2', borderRadius: 8, padding: 14 }}>
                                                    <label style={{ fontSize: 13, fontWeight: 600, color: '#991b1b', marginBottom: 6, display: 'block' }}>
                                                        Why are you not satisfied?
                                                    </label>
                                                    <textarea
                                                        value={reComplaintFeedback}
                                                        onChange={(e) => setReComplaintFeedback(e.target.value)}
                                                        placeholder="Describe what's still wrong..."
                                                        style={{
                                                            width: '100%', minHeight: 80, padding: 10, borderRadius: 6,
                                                            border: '1px solid #fca5a5', fontSize: 13, resize: 'vertical',
                                                            outline: 'none', marginBottom: 10
                                                        }}
                                                    />
                                                    <div style={{ display: 'flex', gap: 8 }}>
                                                        <button
                                                            onClick={() => handleRecomplaint(c.ticket?.id || c.masterTicketId)}
                                                            disabled={submittingRecomplaint}
                                                            style={{
                                                                padding: '8px 18px', borderRadius: 6, border: 'none',
                                                                background: '#dc2626', color: '#fff', fontWeight: 600,
                                                                fontSize: 13, cursor: 'pointer', opacity: submittingRecomplaint ? 0.6 : 1,
                                                            }}>
                                                            {submittingRecomplaint ? 'Submitting...' : 'Submit Re-complaint'}
                                                        </button>
                                                        <button
                                                            onClick={() => { setReComplaintId(null); setReComplaintFeedback(""); }}
                                                            style={{
                                                                padding: '8px 18px', borderRadius: 6,
                                                                border: '1px solid #e2e8f0', background: '#fff',
                                                                color: '#64748b', fontWeight: 600, fontSize: 13, cursor: 'pointer',
                                                            }}>
                                                            Cancel
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                /* Satisfied / Re-complaint buttons */
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                    <button
                                                        onClick={() => {
                                                            const rating = prompt("Rate the resolution out of 5 (1-5):");
                                                            if (rating !== null) handleVerify(c.ticket?.id || c.masterTicketId, true, parseInt(rating) || 5);
                                                        }}
                                                        style={{
                                                            padding: '10px 22px', borderRadius: 8, border: 'none',
                                                            background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                                                            color: '#fff', fontWeight: 600, fontSize: 13,
                                                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                                                            boxShadow: '0 2px 8px rgba(34,197,94,0.3)',
                                                        }}>
                                                        ✅ Satisfied
                                                    </button>
                                                    <button
                                                        onClick={() => setReComplaintId(c.ticket?.id || c.masterTicketId)}
                                                        style={{
                                                            padding: '10px 22px', borderRadius: 8,
                                                            border: '1px solid #fca5a5',
                                                            background: '#fef2f2', color: '#dc2626',
                                                            fontWeight: 600, fontSize: 13, cursor: 'pointer',
                                                            display: 'flex', alignItems: 'center', gap: 6,
                                                        }}>
                                                        🔄 Re-complaint
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* ── Closed: show completion message ── */}
                                    {status === 'Closed' && (
                                        <div style={{
                                            marginTop: 16, paddingTop: 16,
                                            borderTop: '1px solid #e2e8f0',
                                        }}>
                                            <div style={{
                                                display: 'flex', alignItems: 'center', gap: 10,
                                                background: '#f0fdf4', padding: '12px 16px',
                                                borderRadius: 8, border: '1px solid #bbf7d0'
                                            }}>
                                                <span style={{ fontSize: 20 }}>✅</span>
                                                <div>
                                                    <p style={{ fontWeight: 700, fontSize: 14, color: '#166534', margin: 0 }}>
                                                        Issue Resolved — Thank you for your feedback!
                                                    </p>
                                                    {c.ticket?.citizenRating && (
                                                        <p style={{ fontSize: 12, color: '#15803d', margin: '4px 0 0' }}>
                                                            Your rating: {'⭐'.repeat(Math.min(c.ticket.citizenRating, 5))} ({c.ticket.citizenRating}/5)
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Progress bar for in-progress tickets (non-resolved) */}
                                    {!isResolved && c.ticket?.progressPercent > 0 && c.ticket?.status !== "Closed" && (
                                        <div className="mt-4">
                                            <div className="flex justify-between text-xs mb-1">
                                                <span>Engineer Progress</span>
                                                <span className="font-bold">{c.ticket.progressPercent}%</span>
                                            </div>
                                            <div className="w-full bg-[var(--color-surface)] rounded-full h-2">
                                                <div className="bg-[var(--color-primary)] h-2 rounded-full transition-all" style={{ width: `${c.ticket.progressPercent}%` }}></div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </DashboardLayout>
    );
}
