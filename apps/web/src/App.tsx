import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage.js';
import { ProcurementOverviewPage } from './pages/ProcurementOverviewPage.js';
import { ProcurementReviewPage } from './pages/ProcurementReviewPage.js';
import { useSession } from './hooks/useSession.js';

function ProtectedRoute() {
  const { data, isPending } = useSession();

  if (isPending) {
    return (
      <div className="app-shell" dir="rtl">
        <div className="state-message" role="status">
          <span className="spinner" aria-hidden="true" />
          جاري التحقق من الجلسة...
        </div>
      </div>
    );
  }

  if (!data?.authenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<ProcurementOverviewPage />} />
        <Route path="/procurement" element={<ProcurementOverviewPage />} />
        <Route path="/procurement/review" element={<ProcurementReviewPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
