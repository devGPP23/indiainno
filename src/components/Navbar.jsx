import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { getRoleTitle } from "../config/roleConfig";
import { HiOutlineMenu, HiOutlineX, HiOutlineLogout } from "react-icons/hi";
import { useState } from "react";

const NAV_LINKS = {
  citizen: [
    { to: "/citizen", label: "Dashboard", icon: "📊" },
    { to: "/citizen/submit", label: "Submit Complaint", icon: "📝" },
    { to: "/citizen/complaints", label: "My Complaints", icon: "📋" },
    { to: "/citizen/map", label: "City Map", icon: "🗺️" },
  ],
  user: [
    { to: "/citizen", label: "Dashboard", icon: "📊" },
    { to: "/citizen/submit", label: "Submit Complaint", icon: "📝" },
    { to: "/citizen/complaints", label: "My Complaints", icon: "📋" },
    { to: "/citizen/map", label: "City Map", icon: "🗺️" },
  ],
  junior: [
    { to: "/junior", label: "Dashboard", icon: "📊" },
  ],
  engineer: [
    { to: "/junior", label: "Dashboard", icon: "📊" },
  ],
  dept_head: [
    { to: "/dept-head", label: "Dashboard", icon: "📊" },
    { to: "/dept-head/pending", label: "Pending Cases", icon: "⏳" },
    { to: "/dept-head/sla", label: "SLA Cares", icon: "⚠️" },
    { to: "/dept-head/juniors", label: "My Juniors", icon: "👷" },
    { to: "/dept-head/reports", label: "Reports", icon: "📄" },
    { to: "/dept-head/manual-queue", label: "Manual Queue", icon: "📌" },
  ],
  officer: [
    { to: "/officer", label: "Dashboard", icon: "📊" },
    { to: "/officer/tickets", label: "Tickets", icon: "🎫" },
    { to: "/officer/map", label: "Live Map", icon: "🗺️" },
    { to: "/officer/engineers", label: "Officials", icon: "👷" },
    { to: "/officer/departments", label: "Departments", icon: "🏛️" },
    { to: "/officer/manual-queue", label: "Manual Queue", icon: "📌" },
    { to: "/officer/reports", label: "Reports", icon: "📄" },
  ],
  admin: [
    { to: "/officer", label: "Dashboard", icon: "📊" },
    { to: "/officer/tickets", label: "Tickets", icon: "🎫" },
    { to: "/officer/map", label: "Live Map", icon: "🗺️" },
    { to: "/officer/engineers", label: "Officials", icon: "👷" },
    { to: "/officer/departments", label: "Departments", icon: "🏛️" },
    { to: "/officer/manual-queue", label: "Manual Queue", icon: "📌" },
  ],
};

export default function Navbar() {
    const { user, userProfile, logout } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const [mobileOpen, setMobileOpen] = useState(false);

    if (!user) return null;

    const role = userProfile?.role || "citizen";
    const mode = userProfile?.mode || "urban";
    const links = NAV_LINKS[role] || NAV_LINKS.citizen;
    const roleName = getRoleTitle(role, mode);

    const handleLogout = async () => {
        await logout();
        navigate("/");
    };

    return (
        <>
            {/* Sidebar */}
            <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
                <div style={{ padding: "16px 20px 24px", borderBottom: "1px solid #e2e8f0" }}>
                    <Link to="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
                        <div style={{
                            width: 36, height: 36, background: "#1e3a8a", color: "#fff",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontWeight: 800, fontSize: 14, borderRadius: 4
                        }}>CS</div>
                        <div>
                            <div style={{ fontSize: 15, fontWeight: 700, color: "#1e3a8a" }}>CivicSync</div>
                            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 500 }}>{roleName}</div>
                        </div>
                    </Link>
                    {/* Mode badge */}
                    {["junior", "dept_head", "officer", "engineer", "admin"].includes(role) && (
                        <div style={{
                            marginTop: 8, fontSize: 10, fontWeight: 700,
                            padding: "3px 8px", borderRadius: 4, display: "inline-block",
                            background: mode === "urban" ? "#eff6ff" : "#f0fdf4",
                            color: mode === "urban" ? "#1e40af" : "#15803d",
                            border: `1px solid ${mode === "urban" ? "#bfdbfe" : "#bbf7d0"}`,
                            textTransform: "uppercase", letterSpacing: "0.5px"
                        }}>
                            {mode === "urban" ? "🏙️ URBAN" : "🌾 RURAL"}
                        </div>
                    )}
                </div>

                <nav style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
                    {links.map((link) => (
                        <Link
                            key={link.to}
                            to={link.to}
                            className={`sidebar-link ${location.pathname === link.to ? "active" : ""}`}
                            onClick={() => setMobileOpen(false)}
                        >
                            <span style={{ fontSize: 18 }}>{link.icon}</span>
                            <span>{link.label}</span>
                        </Link>
                    ))}
                </nav>

                <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: 16, borderTop: "1px solid #e2e8f0", background: "#f8fafc" }}>
                    <div style={{ padding: "0 4px", marginBottom: 12 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userProfile?.name}</p>
                        <p style={{ fontSize: 11, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userProfile?.email}</p>
                    </div>
                    <button onClick={handleLogout} className="btn-secondary" style={{ width: "100%", justifyContent: "center", fontSize: 13 }}>
                        <HiOutlineLogout style={{ fontSize: 16 }} />
                        Logout
                    </button>
                </div>
            </aside>

            {/* Mobile Toggle */}
            <button
                style={{
                    position: "fixed", top: 12, left: 12, zIndex: 50,
                    padding: 8, borderRadius: 4, background: "#fff",
                    border: "1px solid #cbd5e1", cursor: "pointer",
                    display: "none"
                }}
                className="md-hidden-toggle"
                onClick={() => setMobileOpen(!mobileOpen)}
            >
                {mobileOpen ? <HiOutlineX style={{ fontSize: 20 }} /> : <HiOutlineMenu style={{ fontSize: 20 }} />}
            </button>

            {/* Mobile Backdrop */}
            {mobileOpen && (
                <div
                    style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 30 }}
                    onClick={() => setMobileOpen(false)}
                />
            )}

            <style>{`
                @media (max-width: 768px) {
                    .md-hidden-toggle { display: block !important; }
                }
            `}</style>
        </>
    );
}
