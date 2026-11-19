import AssistantChat from '@/components/AssistantChat';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import Login from '@/pages/Login';
import Shell from '@/components/shell/Shell';
import NotFound from '@/pages/NotFound';
import { Toaster } from '@/components/ui';

function Protected({ children }: { children: JSX.Element }) {
  const token = useAuth((s) => s.accessToken);
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <Protected>
              <Shell />
            </Protected>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toaster />
      <AssistantChat />
    </>
  );
}
