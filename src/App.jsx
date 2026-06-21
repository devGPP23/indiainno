import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import { normalizeRole } from "./config/roleConfig";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";

// Citizen
import UserDashboard from "./pages/user/UserDashboard";
import SubmitComplaint from "./pages/user/SubmitComplaint";
import MyComplaints from "./pages/user/MyComplaints";
import CityMap from "./pages/user/CityMap";
import AnonymousReport from "./pages/user/AnonymousReport";
import TrackReport from "./pages/user/TrackReport";


// Junior (replaces engineer)
import JuniorDashboard from "./pages/junior/JuniorDashboard";
import ResolveTicket from "./pages/engineer/ResolveTicket";

// Dept Head
import DeptHeadDashboard from "./pages/dept_head/DeptHeadDashboard";
import PendingCases from "./pages/dept_head/PendingCases";
import SLACares from "./pages/dept_head/SLACares";
import MyJuniors from "./pages/dept_head/MyJuniors";
import DeptHeadReports from "./pages/dept_head/Reports";
import DeptHeadManualQueue from "./pages/dept_head/ManualQueue";

// Officer (replaces admin)
import OfficerDashboard from "./pages/officer/OfficerDashboard";
import ManageTickets from "./pages/admin/ManageTickets";
import ManageEngineers from "./pages/admin/ManageEngineers";
import ManageDepartments from "./pages/admin/ManageDepartments";
import MapView from "./pages/admin/MapView";
import HeatmapView from "./pages/admin/HeatmapView";
import ManualQueue from "./pages/admin/ManualQueue";
import OfficerReports from "./pages/officer/Reports";

// Implementation Plan Pages
import ImplementationPlanSheet from "./pages/implementationPlan/ImplementationPlanSheet";
import ProgressSummaryReport from "./pages/implementationPlan/ProgressSummaryReport";
import ImplementationPlansList from "./pages/implementationPlan/ImplementationPlansList";

function ProtectedRoute({ children, allowedRoles }) {
  const { user, userProfile, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="spinner" /></div>;
  if (!user) return <Navigate to="/login" />;
  if (allowedRoles && !allowedRoles.includes(userProfile?.role)) {
    // Try normalized role
    const normalized = normalizeRole(userProfile?.role);
    if (!allowedRoles.includes(normalized)) {
      return <Navigate to="/" />;
    }
  }
  return children;
}

export default function App() {
  const { user, userProfile } = useAuth();

  const getDefaultRoute = () => {
    if (!user) return "/";
    const role = normalizeRole(userProfile?.role);
    switch (role) {
      case "officer": return "/officer";
      case "junior": return "/junior";
      case "dept_head": return "/dept-head";
      default: return "/citizen";
    }
  };

  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to={getDefaultRoute()} /> : <Landing />} />
      <Route path="/login" element={user ? <Navigate to={getDefaultRoute()} /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to={getDefaultRoute()} /> : <Register />} />

      {/* Citizen Routes */}
      <Route path="/citizen" element={<ProtectedRoute allowedRoles={["citizen", "user"]}><UserDashboard /></ProtectedRoute>} />
      <Route path="/citizen/submit" element={<ProtectedRoute allowedRoles={["citizen", "user"]}><SubmitComplaint /></ProtectedRoute>} />
      <Route path="/citizen/complaints" element={<ProtectedRoute allowedRoles={["citizen", "user"]}><MyComplaints /></ProtectedRoute>} />
      <Route path="/citizen/map" element={<ProtectedRoute allowedRoles={["citizen", "user"]}><CityMap /></ProtectedRoute>} />
      <Route path="/citizen/anonymous-report" element={<ProtectedRoute allowedRoles={["citizen", "user"]}><AnonymousReport /></ProtectedRoute>} />
      <Route path="/citizen/track-report" element={<ProtectedRoute allowedRoles={["citizen", "user"]}><TrackReport /></ProtectedRoute>} />

      <Route path="/citizen/plan/:ticketId" element={<ProtectedRoute allowedRoles={["citizen", "user"]}><ImplementationPlanSheet /></ProtectedRoute>} />
      <Route path="/citizen/progress/:planId" element={<ProtectedRoute allowedRoles={["citizen", "user"]}><ProgressSummaryReport /></ProtectedRoute>} />

      {/* Junior Routes */}
      <Route path="/junior" element={<ProtectedRoute allowedRoles={["junior", "engineer"]}><JuniorDashboard /></ProtectedRoute>} />
      <Route path="/junior/resolve/:ticketId" element={<ProtectedRoute allowedRoles={["junior", "engineer"]}><ResolveTicket /></ProtectedRoute>} />
      <Route path="/junior/plans" element={<ProtectedRoute allowedRoles={["junior", "engineer"]}><ImplementationPlansList /></ProtectedRoute>} />
      <Route path="/junior/plan/:ticketId" element={<ProtectedRoute allowedRoles={["junior", "engineer"]}><ImplementationPlanSheet /></ProtectedRoute>} />
      <Route path="/junior/progress/:planId" element={<ProtectedRoute allowedRoles={["junior", "engineer"]}><ProgressSummaryReport /></ProtectedRoute>} />

      {/* Dept Head Routes */}
      <Route path="/dept-head" element={<ProtectedRoute allowedRoles={["dept_head"]}><DeptHeadDashboard /></ProtectedRoute>} />
      <Route path="/dept-head/pending" element={<ProtectedRoute allowedRoles={["dept_head"]}><PendingCases /></ProtectedRoute>} />
      <Route path="/dept-head/sla" element={<ProtectedRoute allowedRoles={["dept_head"]}><SLACares /></ProtectedRoute>} />
      <Route path="/dept-head/juniors" element={<ProtectedRoute allowedRoles={["dept_head"]}><MyJuniors /></ProtectedRoute>} />
      <Route path="/dept-head/reports" element={<ProtectedRoute allowedRoles={["dept_head"]}><DeptHeadReports /></ProtectedRoute>} />
      <Route path="/dept-head/manual-queue" element={<ProtectedRoute allowedRoles={["dept_head"]}><DeptHeadManualQueue /></ProtectedRoute>} />
      <Route path="/dept-head/plans" element={<ProtectedRoute allowedRoles={["dept_head"]}><ImplementationPlansList /></ProtectedRoute>} />
      <Route path="/dept-head/plan/:ticketId" element={<ProtectedRoute allowedRoles={["dept_head"]}><ImplementationPlanSheet /></ProtectedRoute>} />
      <Route path="/dept-head/progress/:planId" element={<ProtectedRoute allowedRoles={["dept_head"]}><ProgressSummaryReport /></ProtectedRoute>} />

      {/* Officer Routes */}
      <Route path="/officer" element={<ProtectedRoute allowedRoles={["officer", "admin"]}><OfficerDashboard /></ProtectedRoute>} />
      <Route path="/officer/tickets" element={<ProtectedRoute allowedRoles={["officer", "admin"]}><ManageTickets /></ProtectedRoute>} />
      <Route path="/officer/engineers" element={<ProtectedRoute allowedRoles={["officer", "admin"]}><ManageEngineers /></ProtectedRoute>} />
      <Route path="/officer/departments" element={<ProtectedRoute allowedRoles={["officer", "admin"]}><ManageDepartments /></ProtectedRoute>} />
      <Route path="/officer/map" element={<ProtectedRoute allowedRoles={["officer", "admin"]}><MapView /></ProtectedRoute>} />
      <Route path="/officer/heatmap" element={<ProtectedRoute allowedRoles={["officer", "admin", "dept_head", "junior", "engineer"]}><HeatmapView /></ProtectedRoute>} />
      <Route path="/officer/manual-queue" element={<ProtectedRoute allowedRoles={["officer", "admin"]}><ManualQueue /></ProtectedRoute>} />
      <Route path="/officer/reports" element={<ProtectedRoute allowedRoles={["officer", "admin"]}><OfficerReports /></ProtectedRoute>} />
      <Route path="/officer/plans" element={<ProtectedRoute allowedRoles={["officer", "admin"]}><ImplementationPlansList /></ProtectedRoute>} />
      <Route path="/officer/plan/:ticketId" element={<ProtectedRoute allowedRoles={["officer", "admin"]}><ImplementationPlanSheet /></ProtectedRoute>} />
      <Route path="/officer/progress/:planId" element={<ProtectedRoute allowedRoles={["officer", "admin"]}><ProgressSummaryReport /></ProtectedRoute>} />

      {/* Legacy Redirects */}
      <Route path="/admin" element={<Navigate to="/officer" />} />
      <Route path="/admin/*" element={<Navigate to="/officer" />} />
      <Route path="/engineer" element={<Navigate to="/junior" />} />
      <Route path="/engineer/*" element={<Navigate to="/junior" />} />

      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
