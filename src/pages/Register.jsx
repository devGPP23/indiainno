import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import DEPARTMENTS from "../data/departments";
import toast from "react-hot-toast";

export default function Register() {
    const [form, setForm] = useState({
        name: "", phone: "", pin: "", confirmPin: "",
        email: "", city: "", role: "user", department: ""
    });
    const [loading, setLoading] = useState(false);
    const { register } = useAuth();
    const navigate = useNavigate();

    const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!/^\d{6}$/.test(form.pin)) return toast.error("PIN must be exactly 6 digits");
        if (form.pin !== form.confirmPin) return toast.error("PINs don't match");
        setLoading(true);
        try {
            await register({
                name: form.name,
                phone: form.phone,
                pin: form.pin,
                email: form.email || undefined,
                city: form.city,
                role: form.role,
                department: form.department || null
            });
            toast.success("Account created successfully!");
            navigate("/");
        } catch (err) {
            toast.error(err?.response?.data?.message || err.message || "Registration failed");
        }
        setLoading(false);
    };

    const roleOptions = [
        { value: "user", label: "Citizen", emoji: "👤", desc: "Report issues" },
        { value: "engineer", label: "Engineer", emoji: "🔧", desc: "Fix issues" },
        { value: "admin", label: "Officer", emoji: "👨‍💼", desc: "Manage all" },
    ];

    return (
        <div style={{ minHeight: "100vh", background: "#f1f5f9", display: "flex", flexDirection: "column" }}>
            {/* Top bar */}
            <div style={{ background: "#1e3a8a", padding: "12px 24px", display: "flex", alignItems: "center", gap: 12 }}>
                <Link to="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
                    <div style={{ width: 32, height: 32, background: "#fff", color: "#1e3a8a", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, borderRadius: 4 }}>CS</div>
                    <span style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>CivicSync</span>
                </Link>
            </div>

            {/* Form */}
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
                <div style={{ width: "100%", maxWidth: 500 }}>
                    <div style={{ textAlign: "center", marginBottom: 32 }}>
                        <h1 style={{ fontSize: 28, fontWeight: 800, color: "#1e3a8a", marginBottom: 8 }}>Create Account</h1>
                        <p style={{ color: "#64748b", fontSize: 14 }}>Register on the CivicSync platform</p>
                    </div>

                    <form onSubmit={handleSubmit} style={{
                        background: "#fff", border: "1px solid #cbd5e1",
                        borderTop: "4px solid #f97316", borderRadius: 4,
                        padding: 32, boxShadow: "0 1px 3px rgba(0,0,0,0.06)"
                    }}>
                        {/* Role Selector */}
                        <div style={{ marginBottom: 20 }}>
                            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 8 }}>I am a</label>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                                {roleOptions.map((r) => (
                                    <button key={r.value} type="button" onClick={() => setForm({ ...form, role: r.value })}
                                        style={{
                                            padding: "12px 8px", border: form.role === r.value ? "2px solid #1e3a8a" : "1px solid #cbd5e1",
                                            background: form.role === r.value ? "#eff6ff" : "#fff",
                                            borderRadius: 4, textAlign: "center", cursor: "pointer",
                                            transition: "all 0.2s"
                                        }}>
                                        <div style={{ fontSize: 20, marginBottom: 4 }}>{r.emoji}</div>
                                        <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>{r.label}</div>
                                        <div style={{ fontSize: 11, color: "#64748b" }}>{r.desc}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div style={{ marginBottom: 16 }}>
                            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Full Name</label>
                            <input name="name" type="text" value={form.name} onChange={handleChange} className="input-field" placeholder="Your full name" required />
                        </div>

                        <div style={{ marginBottom: 16 }}>
                            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Phone Number <span style={{ color: "#ef4444" }}>*</span></label>
                            <input name="phone" type="tel" value={form.phone} onChange={handleChange} className="input-field" placeholder="+91 9876543210" required />
                        </div>

                        <div style={{ marginBottom: 16 }}>
                            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Email <span style={{ color: "#94a3b8", fontWeight: 400 }}>(optional)</span></label>
                            <input name="email" type="email" value={form.email} onChange={handleChange} className="input-field" placeholder="you@example.com" />
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                            <div>
                                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 6 }}>City</label>
                                <input name="city" type="text" value={form.city} onChange={handleChange} className="input-field" placeholder="e.g. Jaipur" required />
                            </div>
                            <div style={{ display: (form.role === "engineer" || form.role === "admin") ? "block" : "none" }}>
                                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Department</label>
                                <select name="department" value={form.department} onChange={handleChange} className="input-field">
                                    <option value="">Select Department</option>
                                    {DEPARTMENTS.map((d) => (
                                        <option key={d.id} value={d.id}>{d.icon} {d.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
                            <div>
                                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 6 }}>6-Digit PIN</label>
                                <input name="pin" type="password" value={form.pin} onChange={handleChange} className="input-field" placeholder="e.g. 123456" maxLength={6} inputMode="numeric" pattern="\d{6}" required />
                            </div>
                            <div>
                                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Confirm PIN</label>
                                <input name="confirmPin" type="password" value={form.confirmPin} onChange={handleChange} className="input-field" placeholder="Re-enter PIN" maxLength={6} inputMode="numeric" pattern="\d{6}" required />
                            </div>
                        </div>

                        <button type="submit" className="btn-primary" style={{ width: "100%", justifyContent: "center", padding: "12px" }} disabled={loading}>
                            {loading ? <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> : "Create Account"}
                        </button>

                        <p style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: "#64748b" }}>
                            Already have an account?{" "}
                            <Link to="/login" style={{ color: "#1e3a8a", fontWeight: 600 }}>Sign In</Link>
                        </p>
                    </form>
                </div>
            </div>
        </div>
    );
}
