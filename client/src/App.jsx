import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import { SessionNavProvider } from './context/SessionNavContext';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import SessionRoom from './pages/SessionRoom';

function App() {
  return (
    <Router>
      <AuthProvider>
        <SessionNavProvider>
          <Toaster 
            position="bottom-center"
            toastOptions={{
              style: {
                background: '#1f2937',
                color: '#f3f4f6',
                border: '1px solid rgba(255,255,255,0.1)',
                bottom:'10px',
                borderRadius: '12px',
                fontSize: '13px',
                maxWidth: '360px',
                padding: '10px 16px',
                fontFamily: 'Inter, sans-serif',
              },
              duration: 3000,
            }}
          />
          <Navbar />
          <Routes>
            <Route path="/" element={<Navigate to="/login" />} />
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/session/:sessionId" element={<SessionRoom />} /> 
          </Routes>
        </SessionNavProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;