import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import toast from "react-hot-toast";

export default function Login() {
    const [phone, setPhone] = useState("");
    const [pin, setPin] = useState("");
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!/^\d{6}$/.test(pin)) return toast.error("PIN must be exactly 6 digits");
        setLoading(true);
        try {
            await login(phone, pin);
            toast.success("Welcome back!");
            navigate("/");
        } catch (err) {
            toast.error(err?.response?.data?.message || err.message || "Login failed");
        }
        setLoading(false);
    };

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
                <div style={{ width: "100%", maxWidth: 440 }}>
                    <div style={{ textAlign: "center", marginBottom: 32 }}>
                        <h1 style={{ fontSize: 28, fontWeight: 800, color: "#1e3a8a", marginBottom: 8 }}>Login</h1>
                        <p style={{ color: "#64748b", fontSize: 14 }}>Sign in to access your CivicSync dashboard</p>
                    </div>

                    <form onSubmit={handleSubmit} style={{
                        background: "#fff", border: "1px solid #cbd5e1",
                        borderTop: "4px solid #f97316", borderRadius: 4,
                        padding: 32, boxShadow: "0 1px 3px rgba(0,0,0,0.06)"
                    }}>
                        <div style={{ marginBottom: 20 }}>
                            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Phone Number</label>
                            <input
                                type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                                className="input-field" placeholder="+91 9876543210" required
                            />
                        </div>

                        <div style={{ marginBottom: 24 }}>
                            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 6 }}>6-Digit PIN</label>
                            <input
                                type="password" value={pin} onChange={(e) => setPin(e.target.value)}
                                className="input-field" placeholder="Enter your 6-digit PIN"
                                maxLength={6} inputMode="numeric" pattern="\d{6}" required
                            />
                        </div>

                        <button type="submit" className="btn-primary" style={{ width: "100%", justifyContent: "center", padding: "12px" }} disabled={loading}>
                            {loading ? <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> : "Sign In"}
                        </button>

                        <p style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: "#64748b" }}>
                            Don't have an account?{" "}
                            <Link to="/register" style={{ color: "#1e3a8a", fontWeight: 600 }}>Register here</Link>
                        </p>
                    </form>
                </div>
            </div>
        </div>
    );
}
