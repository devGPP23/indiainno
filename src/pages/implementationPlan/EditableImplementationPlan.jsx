import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import DashboardLayout from "../../components/DashboardLayout";
import api from "../../utils/api";
import { getRoleTitle, normalizeRole } from "../../config/roleConfig";
import DEPARTMENTS from "../../data/departments";
import toast from "react-hot-toast";

export default function EditableImplementationPlan() {
    const { ticketId, planId } = useParams();
    const navigate = useNavigate();
    const { userProfile } = useAuth();
    const { currentLanguage, translateText } = useLanguage();
    
    const [plan, setPlan] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [connectedUsers, setConnectedUsers] = useState({});
    const [activeTab, setActiveTab] = useState("plan");
    const [editingField, setEditingField] = useState(null);
    
    const role = normalizeRole(userProfile?.role);
    const mode = userProfile?.mode || "urban";

    const canEdit = role === "junior" || role === "engineer";
    const canApprove = ["senior_engineer", "dept_head", "officer"].includes(role);
    const isCitizen = role === "citizen" || role === "user";

    useEffect(() => {
        const fetchPlan = async () => {
            try {
                let planData = null;
                if (ticketId) {
                    const res = await api.get(`/implementation-plans/${ticketId}`);
                    planData = res.data;
                } else if (planId) {
                    const res = await api.get(`/implementation-plans/id/${planId}`);
                    planData = res.data;
                }
                setPlan(planData);
                
                if (planData?.department) {
                    fetchConnectedOfficials(planData.department);
                }
            } catch (err) {
                console.error("Failed to fetch plan:", err);
                setError(err.response?.data?.message || "Failed to load implementation plan");
            }
            setLoading(false);
        };
        fetchPlan();
    }, [ticketId, planId]);

    const fetchConnectedOfficials = async (department) => {
        try {
            const res = await api.get("/users");
            const allUsers = res.data || [];
            const deptUsers = allUsers.filter(u => 
                u.department === department && 
                ["junior", "engineer", "senior_engineer", "dept_head", "officer"].includes(u.role)
            );
            
            const officials = {
                commissioner: deptUsers.find(u => u.role === "officer"),
                deptHead: deptUsers.find(u => u.role === "dept_head"),
                juniors: deptUsers.filter(u => ["junior", "engineer"].includes(u.role))
            };
            setConnectedUsers(officials);
        } catch (err) {
            console.error("Failed to fetch officials:", err);
        }
    };

    const handleFieldUpdate = async (field, value) => {
        setSaving(true);
        try {
            const res = await api.put(`/implementation-plans/${plan._id}/update-field`, {
                field,
                value
            });
            setPlan(prev => ({ ...prev, [field]: value }));
            setEditingField(null);
            toast.success("Updated successfully");
        } catch (err) {
            toast.error(err.response?.data?.message || "Failed to update");
        }
        setSaving(false);
    };

    const handleStepUpdate = async (stepNumber, field, value) => {
        setSaving(true);
        try {
            const res = await api.put(`/implementation-plans/${plan._id}/step-update`, {
                stepNumber,
                field,
                value
            });
            setPlan(res.data.plan);
            toast.success("Step updated");
        } catch (err) {
            toast.error(err.response?.data?.message || "Failed to update step");
        }
        setSaving(false);
    };

    const handleJuniorReview = async (forwardToSenior = true) => {
        setSaving(true);
        try {
            const res = await api.put(`/implementation-plans/${plan._id}/junior-review`, {
                forwardToSenior,
                remarks: plan.juniorRemarks || "Reviewed by junior engineer"
            });
            setPlan(res.data.plan);
            toast.success(forwardToSenior ? "Plan forwarded to senior" : "Draft saved");
        } catch (err) {
            toast.error(err.response?.data?.message || "Failed");
        }
        setSaving(false);
    };

    const handleSeniorReview = async (action) => {
        setSaving(true);
        try {
            const res = await api.put(`/implementation-plans/${plan._id}/senior-review`, {
                action,
                remarks: plan.seniorRemarks || ""
            });
            setPlan(res.data.plan);
            toast.success(action === "approve" ? "Approved!" : action === "send_back" ? "Sent back" : "Rejected");
        } catch (err) {
            toast.error(err.response?.data?.message || "Failed");
        }
        setSaving(false);
    };

    const handleStartWork = async () => {
        setSaving(true);
        try {
            const res = await api.put(`/implementation-plans/${plan._id}/start-work`, {});
            setPlan(res.data.plan);
            toast.success("Work started!");
        } catch (err) {
            toast.error(err.response?.data?.message || "Failed");
        }
        setSaving(false);
    };

    const handleAddComment = async () => {
        if (!plan.newComment?.trim()) return;
        setSaving(true);
        try {
            const res = await api.post(`/implementation-plans/${plan._id}/comment`, {
                content: plan.newComment
            });
            setPlan(prev => ({
                ...prev,
                comments: [...(prev.comments || []), res.data.comment],
                newComment: ""
            }));
        } catch (err) {
            toast.error(err.response?.data?.message || "Failed");
        }
        setSaving(false);
    };

    const getDeptColor = (dept) => {
        const d = DEPARTMENTS.find(d => d.id === dept);
        return d?.color || "#6366f1";
    };

    const getDeptIcon = (dept) => {
        const d = DEPARTMENTS.find(d => d.id === dept);
        return d?.icon || "🏛️";
    };

    const getStatusBadge = (status) => {
        const colors = {
            pending: "#64748b",
            in_progress: "#f59e0b",
            completed: "#22c55e",
            verified: "#06b6d4",
            rejected: "#ef4444"
        };
        return colors[status] || "#64748b";
    };

    if (loading) {
        return (
            <DashboardLayout title="Implementation Plan">
                <div className="flex justify-center py-20"><div className="spinner" /></div>
            </DashboardLayout>
        );
    }

    if (error || !plan) {
        return (
            <DashboardLayout title="Implementation Plan">
                <div className="card p-8 text-center">
                    <p className="text-red-500 mb-4">{error || "No implementation plan found."}</p>
                    <button onClick={() => navigate(-1)} className="btn-primary">Go Back</button>
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout title="Implementation Plan">
            <div style={{ maxWidth: 1200, margin: "0 auto" }}>
                {/* Header Card */}
                <div className="card p-6 mb-6">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                        <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                                <span style={{ 
                                    padding: "4px 12px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                                    background: getDeptColor(plan.department) + "20", color: getDeptColor(plan.department)
                                }}>
                                    {getDeptIcon(plan.department)} {plan.department?.toUpperCase()}
                                </span>
                                <span className={`badge severity-${(plan.severity || "low").toLowerCase()}`}>{plan.severity}</span>
                                <span className="badge">Level {plan.level}</span>
                                <span style={{
                                    padding: "4px 12px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                                    background: getStatusBadge(plan.currentStage) + "20", color: getStatusBadge(plan.currentStage)
                                }}>
                                    {plan.currentStage?.replace(/_/g, " ").toUpperCase()}
                                </span>
                            </div>
                            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1e3a8a" }}>
                                {plan.ticketNumber} - {plan.title}
                            </h2>
                            <p style={{ color: "#64748b", fontSize: 13 }}>{plan.description}</p>
                        </div>
                        <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 32, fontWeight: 800, color: "#1e3a8a" }}>{plan.overallProgress || 0}%</div>
                            <p style={{ fontSize: 12, color: "#64748b" }}>Progress</p>
                        </div>
                    </div>

                    {/* Progress Bar */}
                    <div style={{ height: 12, background: "#e2e8f0", borderRadius: 6, overflow: "hidden" }}>
                        <div style={{ 
                            width: `${plan.overallProgress || 0}%`, 
                            height: "100%", 
                            background: "linear-gradient(90deg, #3b82f6, #22c55e)",
                            borderRadius: 6,
                            transition: "width 0.5s ease"
                        }} />
                    </div>
                </div>

                {/* Tabs */}
                <div style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
                    {[
                        { key: "plan", label: "📋 Implementation Plan" },
                        { key: "steps", label: "🚧 Progress & Steps" },
                        { key: "team", label: "👥 Connected Team" },
                        { key: "history", label: "📜 History" }
                    ].map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            style={{
                                padding: "10px 16px",
                                borderRadius: 8,
                                border: "none",
                                background: activeTab === tab.key ? "#1e3a8a" : "transparent",
                                color: activeTab === tab.key ? "#fff" : "#64748b",
                                fontWeight: 600,
                                fontSize: 13,
                                cursor: "pointer"
                            }}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                {activeTab === "plan" && (
                    <div className="card p-6">
                        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>📋 Plan Details</h3>
                        
                        {/* Problem Analysis - Editable */}
                        <div style={{ marginBottom: 20 }}>
                            <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 6 }}>
                                PROBLEM ANALYSIS
                            </label>
                            {editingField === "problemAnalysis" ? (
                                <div>
                                    <textarea
                                        value={plan.problemAnalysis || ""}
                                        onChange={(e) => setPlan(prev => ({ ...prev, problemAnalysis: e.target.value }))}
                                        style={{ width: "100%", padding: 12, border: "1px solid #e2e8f0", borderRadius: 8, minHeight: 100, fontSize: 13 }}
                                    />
                                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                                        <button onClick={() => handleFieldUpdate("problemAnalysis", plan.problemAnalysis)} className="btn-primary" disabled={saving}>Save</button>
                                        <button onClick={() => setEditingField(null)} className="btn-secondary">Cancel</button>
                                    </div>
                                </div>
                            ) : (
                                <div 
                                    onClick={() => canEdit && setEditingField("problemAnalysis")}
                                    style={{ 
                                        padding: 12, background: "#f8fafc", borderRadius: 8, cursor: canEdit ? "pointer" : "default",
                                        border: canEdit ? "1px dashed #cbd5e1" : "none",
                                        minHeight: 60
                                    }}
                                >
                                    <p style={{ fontSize: 13, color: "#334155" }}>{plan.problemAnalysis || "Click to add problem analysis..."}</p>
                                </div>
                            )}
                        </div>

                        {/* Estimates */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
                            <div>
                                <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 4 }}>Estimated Hours</label>
                                {editingField === "totalEstimatedHours" ? (
                                    <input 
                                        type="number" 
                                        value={plan.totalEstimatedHours || 0}
                                        onChange={(e) => setPlan(prev => ({ ...prev, totalEstimatedHours: parseFloat(e.target.value) }))}
                                        onBlur={() => handleFieldUpdate("totalEstimatedHours", plan.totalEstimatedHours)}
                                        style={{ width: "100%", padding: 8, border: "1px solid #e2e8f0", borderRadius: 6 }}
                                    />
                                ) : (
                                    <div 
                                        onClick={() => canEdit && setEditingField("totalEstimatedHours")}
                                        style={{ padding: 12, background: "#f8fafc", borderRadius: 8, cursor: canEdit ? "pointer" : "default" }}
                                    >
                                        <p style={{ fontSize: 20, fontWeight: 700, color: "#1e3a8a" }}>{plan.totalEstimatedHours || 0}h</p>
                                    </div>
                                )}
                            </div>
                            <div>
                                <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 4 }}>Estimated Cost (₹)</label>
                                {editingField === "totalEstimatedCost" ? (
                                    <input 
                                        type="number" 
                                        value={plan.totalEstimatedCost || 0}
                                        onChange={(e) => setPlan(prev => ({ ...prev, totalEstimatedCost: parseFloat(e.target.value) }))}
                                        onBlur={() => handleFieldUpdate("totalEstimatedCost", plan.totalEstimatedCost)}
                                        style={{ width: "100%", padding: 8, border: "1px solid #e2e8f0", borderRadius: 6 }}
                                    />
                                ) : (
                                    <div 
                                        onClick={() => canEdit && setEditingField("totalEstimatedCost")}
                                        style={{ padding: 12, background: "#f8fafc", borderRadius: 8, cursor: canEdit ? "pointer" : "default" }}
                                    >
                                        <p style={{ fontSize: 20, fontWeight: 700, color: "#1e3a8a" }}>₹{(plan.totalEstimatedCost || 0).toLocaleString()}</p>
                                    </div>
                                )}
                            </div>
                            <div>
                                <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 4 }}>Steps Count</label>
                                <div style={{ padding: 12, background: "#f8fafc", borderRadius: 8 }}>
                                    <p style={{ fontSize: 20, fontWeight: 700, color: "#1e3a8a" }}>{plan.steps?.length || 0}</p>
                                </div>
                            </div>
                        </div>

                        {/* Materials - Editable */}
                        {canEdit && (
                            <div style={{ marginBottom: 20 }}>
                                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 6 }}>
                                    MATERIALS REQUIRED
                                </label>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                    {plan.primaryMaterials?.map((mat, idx) => (
                                        <div key={idx} style={{ padding: "8px 12px", background: "#f1f5f9", borderRadius: 6, fontSize: 12 }}>
                                            {mat.name} - ₹{mat.estimatedCost || 0}
                                        </div>
                                    ))}
                                    <button 
                                        onClick={() => {
                                            const newMat = prompt("Enter material name:");
                                            if (newMat) {
                                                setPlan(prev => ({
                                                    ...prev,
                                                    primaryMaterials: [...(prev.primaryMaterials || []), { name: newMat, estimatedCost: 0 }]
                                                }));
                                            }
                                        }}
                                        style={{ padding: "8px 12px", background: "#e2e8f0", borderRadius: 6, fontSize: 12, border: "none", cursor: "pointer" }}
                                    >
                                        + Add Material
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Steps Tab */}
                {activeTab === "steps" && (
                    <div className="card p-6">
                        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>🚧 Step-by-Step Progress</h3>
                        
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            {plan.steps?.map((step, idx) => (
                                <div key={idx} style={{ 
                                    padding: 16, 
                                    background: step.status === "completed" ? "#f0fdf4" : step.status === "in_progress" ? "#fffbeb" : "#f8fafc",
                                    borderRadius: 8,
                                    borderLeft: `4px solid ${getStatusBadge(step.status)}`
                                }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                        <div style={{ display: "flex", gap: 12, flex: 1 }}>
                                            <div style={{ 
                                                width: 32, height: 32, borderRadius: "50%", 
                                                background: getStatusBadge(step.status),
                                                color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700,
                                                flexShrink: 0
                                            }}>
                                                {step.status === "completed" ? "✓" : step.status === "in_progress" ? "◐" : step.stepNumber}
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                {/* Step Title - Editable */}
                                                {editingField === `step-${idx}-title` ? (
                                                    <input
                                                        value={step.title}
                                                        onChange={(e) => {
                                                            const newSteps = [...plan.steps];
                                                            newSteps[idx].title = e.target.value;
                                                            setPlan(prev => ({ ...prev, steps: newSteps }));
                                                        }}
                                                        onBlur={() => handleStepUpdate(step.stepNumber, "title", step.title)}
                                                        style={{ width: "100%", padding: 6, border: "1px solid #e2e8f0", borderRadius: 4, fontSize: 14, fontWeight: 600 }}
                                                    />
                                                ) : (
                                                    <p 
                                                        onClick={() => canEdit && setEditingField(`step-${idx}-title`)}
                                                        style={{ fontWeight: 600, marginBottom: 4, cursor: canEdit ? "pointer" : "default" }}
                                                    >
                                                        {step.stepNumber}. {step.title}
                                                    </p>
                                                )}
                                                
                                                {/* Step Description - Editable */}
                                                {editingField === `step-${idx}-description` ? (
                                                    <textarea
                                                        value={step.description || ""}
                                                        onChange={(e) => {
                                                            const newSteps = [...plan.steps];
                                                            newSteps[idx].description = e.target.value;
                                                            setPlan(prev => ({ ...prev, steps: newSteps }));
                                                        }}
                                                        onBlur={() => handleStepUpdate(step.stepNumber, "description", step.description)}
                                                        style={{ width: "100%", padding: 6, border: "1px solid #e2e8f0", borderRadius: 4, fontSize: 12, minHeight: 60 }}
                                                    />
                                                ) : (
                                                    <p 
                                                        onClick={() => canEdit && setEditingField(`step-${idx}-description`)}
                                                        style={{ fontSize: 12, color: "#64748b", cursor: canEdit ? "pointer" : "default" }}
                                                    >
                                                        {step.description || "Click to add description..."}
                                                    </p>
                                                )}
                                                
                                                {/* Step Hours - Editable */}
                                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                                                    <span style={{ fontSize: 11, color: "#64748b" }}>Hours:</span>
                                                    {editingField === `step-${idx}-hours` ? (
                                                        <input
                                                            type="number"
                                                            value={step.estimatedHours || 0}
                                                            onChange={(e) => {
                                                                const newSteps = [...plan.steps];
                                                                newSteps[idx].estimatedHours = parseFloat(e.target.value);
                                                                setPlan(prev => ({ ...prev, steps: newSteps }));
                                                            }}
                                                            onBlur={() => handleStepUpdate(step.stepNumber, "estimatedHours", step.estimatedHours)}
                                                            style={{ width: 60, padding: 4, border: "1px solid #e2e8f0", borderRadius: 4, fontSize: 12 }}
                                                        />
                                                    ) : (
                                                        <span 
                                                            onClick={() => canEdit && setEditingField(`step-${idx}-hours`)}
                                                            style={{ fontSize: 12, fontWeight: 600, cursor: canEdit ? "pointer" : "default" }}
                                                        >
                                                            {step.estimatedHours || 0}h
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Remarks */}
                                                {step.juniorRemarks && (
                                                    <div style={{ marginTop: 8, padding: 8, background: "#fff", borderRadius: 4, fontSize: 11 }}>
                                                        <strong>Jr Engineer:</strong> {step.juniorRemarks}
                                                    </div>
                                                )}
                                                {step.seniorRemarks && (
                                                    <div style={{ marginTop: 4, padding: 8, background: "#fff", borderRadius: 4, fontSize: 11, color: "#06b6d4" }}>
                                                        <strong>Senior:</strong> {step.seniorRemarks}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        
                                        {/* Action Buttons */}
                                        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                                            {canEdit && plan.currentStage === "in_progress" && (
                                                <>
                                                    {step.status === "pending" && (
                                                        <button 
                                                            onClick={() => handleStepUpdate(step.stepNumber, "status", "in_progress")}
                                                            style={{ padding: "6px 12px", background: "#f59e0b", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11 }}
                                                        >
                                                            Start
                                                        </button>
                                                    )}
                                                    {step.status === "in_progress" && (
                                                        <button 
                                                            onClick={() => handleStepUpdate(step.stepNumber, "status", "completed")}
                                                            style={{ padding: "6px 12px", background: "#22c55e", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11 }}
                                                        >
                                                            Complete
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                            {canVerify && step.status === "completed" && (
                                                <>
                                                    <button 
                                                        onClick={() => handleStepUpdate(step.stepNumber, "verified", true)}
                                                        style={{ padding: "6px 12px", background: "#06b6d4", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11 }}
                                                    >
                                                        Verify
                                                    </button>
                                                    <button 
                                                        onClick={() => handleStepUpdate(step.stepNumber, "verified", false)}
                                                        style={{ padding: "6px 12px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11 }}
                                                    >
                                                        Reject
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Team Tab */}
                {activeTab === "team" && (
                    <div className="card p-6">
                        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>👥 Connected Team</h3>
                        
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 16 }}>
                            {connectedUsers.commissioner && (
                                <div style={{ padding: 16, background: "#f8fafc", borderRadius: 8, borderLeft: "4px solid #1e3a8a" }}>
                                    <p style={{ fontSize: 11, color: "#64748b" }}>Commissioner / SDM / CEO</p>
                                    <p style={{ fontSize: 16, fontWeight: 700 }}>{connectedUsers.commissioner.name}</p>
                                    <p style={{ fontSize: 13, color: "#64748b" }}>📞 {connectedUsers.commissioner.phone}</p>
                                    <p style={{ fontSize: 11, color: "#94a3b8" }}>{connectedUsers.commissioner.email}</p>
                                </div>
                            )}
                            
                            {connectedUsers.deptHead && (
                                <div style={{ padding: 16, background: "#f8fafc", borderRadius: 8, borderLeft: "4px solid #22c55e" }}>
                                    <p style={{ fontSize: 11, color: "#64748b" }}>Department Head</p>
                                    <p style={{ fontSize: 16, fontWeight: 700 }}>{connectedUsers.deptHead.name}</p>
                                    <p style={{ fontSize: 13, color: "#64748b" }}>📞 {connectedUsers.deptHead.phone}</p>
                                    <p style={{ fontSize: 11, color: "#94a3b8" }}>{connectedUsers.deptHead.email}</p>
                                </div>
                            )}
                            
                            {connectedUsers.juniors?.map(j => (
                                <div key={j._id} style={{ padding: 16, background: "#f8fafc", borderRadius: 8, borderLeft: "4px solid #f59e0b" }}>
                                    <p style={{ fontSize: 11, color: "#64748b" }}>Jr Engineer</p>
                                    <p style={{ fontSize: 16, fontWeight: 700 }}>{j.name}</p>
                                    <p style={{ fontSize: 13, color: "#64748b" }}>📞 {j.phone}</p>
                                    <p style={{ fontSize: 11, color: "#94a3b8" }}>{j.email}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* History Tab */}
                {activeTab === "history" && (
                    <div className="card p-6">
                        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>📜 Approval History</h3>
                        
                        {/* Add Comment */}
                        {!isCitizen && (
                            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                                <input
                                    type="text"
                                    value={plan.newComment || ""}
                                    onChange={(e) => setPlan(prev => ({ ...prev, newComment: e.target.value }))}
                                    placeholder="Add a remark or update..."
                                    style={{ flex: 1, padding: "10px 14px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13 }}
                                />
                                <button onClick={handleAddComment} disabled={saving || !plan.newComment?.trim()} className="btn-primary">
                                    Post
                                </button>
                            </div>
                        )}
                        
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {plan.approvalHistory?.slice().reverse().map((h, i) => (
                                <div key={i} style={{ padding: 12, background: "#f8fafc", borderRadius: 8 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                        <span style={{ fontWeight: 600, fontSize: 13 }}>
                                            {h.action === "ai_generated" && "🤖 AI Generated"}
                                            {h.action === "junior_reviewed" && "👷 Jr Engineer Reviewed"}
                                            {h.action === "senior_reviewed" && "👨‍💼 Senior Reviewed"}
                                            {h.action === "approved" && "✅ Approved"}
                                            {h.action === "send_back" && "🔙 Sent Back"}
                                            {h.action === "rejected" && "❌ Rejected"}
                                            {h.action === "work_started" && "🚧 Work Started"}
                                            {h.action === "completed" && "🎉 Completed"}
                                        </span>
                                        <span style={{ fontSize: 11, color: "#94a3b8" }}>
                                            {new Date(h.timestamp).toLocaleString()}
                                        </span>
                                    </div>
                                    {h.remarks && (
                                        <p style={{ fontSize: 12, color: "#64748b" }}>{h.remarks}</p>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Comments Section */}
                        {plan.comments?.length > 0 && (
                            <div style={{ marginTop: 20 }}>
                                <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>💬 Activity Log</h4>
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    {plan.comments.slice().reverse().map((c, i) => (
                                        <div key={i} style={{ padding: 12, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 }}>
                                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                                <span style={{ fontWeight: 600, fontSize: 12 }}>{c.authorName || "User"}</span>
                                                <span style={{ fontSize: 11, color: "#94a3b8" }}>{new Date(c.timestamp).toLocaleString()}</span>
                                            </div>
                                            <p style={{ fontSize: 12, color: "#334155" }}>{c.content}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Action Buttons */}
                {!isCitizen && (
                    <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24, padding: 16, background: "#f8fafc", borderRadius: 8 }}>
                        {plan.level === 1 && plan.currentStage === "ai_generated" && canEdit && (
                            <button onClick={handleJuniorReview} disabled={saving} className="btn-primary" style={{ padding: "12px 24px" }}>
                                {saving ? "..." : "✓ Approve & Start Work"}
                            </button>
                        )}
                        
                        {["ai_generated", "pending_junior_review"].includes(plan.currentStage) && canEdit && (
                            <>
                                <button onClick={() => handleJuniorReview(false)} disabled={saving} className="btn-secondary" style={{ padding: "12px 24px" }}>
                                    Save Draft
                                </button>
                                <button onClick={() => handleJuniorReview(true)} disabled={saving} className="btn-primary" style={{ padding: "12px 24px" }}>
                                    {saving ? "..." : "📤 Forward to Senior"}
                                </button>
                            </>
                        )}

                        {plan.currentStage === "pending_senior_review" && canApprove && (
                            <>
                                <button onClick={() => handleSeniorReview("send_back")} disabled={saving} style={{ padding: "12px 24px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 8 }}>
                                    ❌ Send Back
                                </button>
                                <button onClick={() => handleSeniorReview("approve")} disabled={saving} className="btn-primary" style={{ padding: "12px 24px" }}>
                                    {saving ? "..." : "✅ Approve Plan"}
                                </button>
                            </>
                        )}

                        {plan.currentStage === "approved" && canEdit && (
                            <button onClick={handleStartWork} disabled={saving} className="btn-primary" style={{ padding: "12px 24px", background: "#22c55e" }}>
                                {saving ? "..." : "🚧 Start Work"}
                            </button>
                        )}
                    </div>
                )}

                {/* Print Button */}
                <div style={{ textAlign: "center", marginTop: 16 }}>
                    <button onClick={() => window.print()} className="btn-secondary" style={{ padding: "12px 24px" }}>
                        🖨️ Print / Export PDF
                    </button>
                </div>
            </div>

            <style>{`
                @media print {
                    .sidebar, .navbar { display: none !important; }
                }
            `}</style>
        </DashboardLayout>
    );
}
