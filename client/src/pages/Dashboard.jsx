import { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';

export default function Dashboard() {
    const { user, logout } = useContext(AuthContext);
    const navigate = useNavigate();
    
    // Data & Loading States
    const [sessions, setSessions] = useState([]);
    const [sessionTitle, setSessionTitle] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [joiningId, setJoiningId] = useState(null);
    const [deletingId, setDeletingId] = useState(null);

    const fetchSessions = async () => {
        try {
            const response = await api.get('/sessions/active');
            setSessions(response.data);
        } catch (error) {
            if (error.response?.status !== 401) toast.error('Failed to load active sessions');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { fetchSessions(); }, []);

    const handleCreateSession = async (e) => {
        e.preventDefault();
        if (!sessionTitle.trim() || isCreating) return;
        setIsCreating(true);
        try {
            const response = await api.post('/sessions/create', { sessionTitle });
            toast.success(`Session Created! Code: ${response.data.joinCode}`, { duration: 5000 });
            setSessionTitle(''); 
            await fetchSessions(); 
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to create session');
        } finally { setIsCreating(false); }
    };

    const handleDeleteSession = async (sessionId) => {
        if (deletingId) return; 
        if (!window.confirm("Are you sure you want to end this session for everyone?")) return;
        setDeletingId(sessionId);
        try {
            const response = await api.delete(`/sessions/end/${sessionId}`);
            toast.success(response.data || "Session ended.");
            await fetchSessions(); 
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to delete session');
        } finally { setDeletingId(null); }
    };

    const handleJoinSession = async (session) => {
        if (joiningId) return;
        let code = '';
        if (user?.username === session.trainerUsername) {
            code = session.joinCode; 
        } else {
            code = window.prompt(`Enter the 6-digit Join Code for '${session.sessionTitle}':`);
            if (!code) return; 
        }
        setJoiningId(session.sessionId);
        try {
            await api.post(`/sessions/join/${session.sessionId}`, { joinCode: code });
            navigate(`/session/${session.sessionId}`, { 
                state: { 
                    joinCode: session.joinCode, 
                    trainer: session.trainerUsername,
                    sessionTitle: session.sessionTitle 
                } 
            });
        } catch (error) {
            toast.error(error.response?.data?.message || 'Incorrect Join Code');
            setJoiningId(null); 
        }
    };

    const handleLogout = async () => {
        if (isLoggingOut) return;
        setIsLoggingOut(true);
        try { await logout(navigate); } finally { setIsLoggingOut(false); }
    };

    return (
        <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-950 to-black text-white p-4 md:p-8 relative overflow-hidden">
            {/* Background glowing effects */}
            <div className="absolute top-0 right-1/4 w-96 h-96 bg-blue-600/5 rounded-full blur-[120px] pointer-events-none"></div>
            <div className="absolute bottom-10 left-1/4 w-96 h-96 bg-purple-600/5 rounded-full blur-[120px] pointer-events-none"></div>

            {/* RESPONSIVE HEADER */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 pb-6 border-b border-white/10 relative z-10">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-black text-sm">S</span>
                        <h1 className="text-xl md:text-2xl font-black tracking-tight bg-gradient-to-r from-blue-400 to-indigo-300 bg-clip-text text-transparent">
                            Placement Hub
                        </h1>
                    </div>
                    <p className="text-gray-400 text-xs md:text-sm mt-1.5">
                        Logged in as: <span className="text-blue-400 font-semibold">@{user?.username}</span>
                    </p>
                </div>
                
                <button 
                    onClick={handleLogout} 
                    disabled={isLoggingOut}
                    className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 disabled:bg-red-950 disabled:opacity-50 text-red-200 px-5 py-2 rounded-xl transition duration-200 flex items-center gap-2 w-full sm:w-auto justify-center font-bold text-xs uppercase tracking-wider active:scale-95 shadow-[0_4px_12px_rgba(239,68,68,0.1)]"
                >
                    {isLoggingOut ? 'Logging out...' : 'Logout'}
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8 relative z-10">
                {/* CREATE SESSION FORM */}
                <div className="lg:col-span-1 order-first lg:order-none">
                    <div className="bg-white/5 backdrop-blur-md p-5 md:p-6 rounded-2xl border border-white/10 shadow-xl">
                        <h2 className="text-base font-bold mb-4 text-gray-200 uppercase tracking-wider flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                            Start New Session
                        </h2>
                        <form onSubmit={handleCreateSession} className="space-y-4">
                            <div>
                                <label className="block text-gray-400 mb-1.5 text-xs font-bold uppercase tracking-wider">Session Title</label>
                                <input 
                                    type="text" 
                                    className="w-full px-4 py-3 bg-gray-950/60 text-white rounded-xl border border-gray-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50 text-sm placeholder-gray-600 transition"
                                    placeholder="e.g., TCS Prep - Coding Round"
                                    value={sessionTitle}
                                    onChange={(e) => setSessionTitle(e.target.value)}
                                    disabled={isCreating}
                                    required
                                />
                            </div>
                            <button 
                                type="submit" 
                                disabled={isCreating || !sessionTitle.trim()}
                                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-800 disabled:text-gray-500 text-white font-bold py-3 px-4 rounded-xl transition active:scale-[0.98] shadow-lg shadow-blue-600/20 text-sm"
                            >
                                {isCreating ? 'Creating...' : 'Create Session'}
                            </button>
                        </form>
                    </div>
                </div>

                {/* LIVE SESSIONS GRID */}
                <div className="lg:col-span-2">
                    <h2 className="text-base font-bold mb-4 text-gray-200 uppercase tracking-wider flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        Active Rooms
                    </h2>
                    
                    {isLoading ? (
                        <div className="flex justify-center items-center h-32 bg-white/5 rounded-2xl border border-white/10">
                            <p className="text-gray-400 text-sm animate-pulse">Scanning network for sessions...</p>
                        </div>
                    ) : sessions.length === 0 ? (
                        <div className="bg-white/5 p-8 rounded-2xl border border-white/10 text-center shadow-inner">
                            <p className="text-gray-400 text-sm font-semibold">No active workspaces available.</p>
                            <p className="text-xs text-gray-500 mt-2">Initialize a new session on the left panel.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {sessions.map((session) => (
                                <div key={session.sessionId} className="bg-white/5 p-5 rounded-2xl border border-white/10 shadow-lg flex flex-col justify-between hover:border-white/20 transition-all duration-300 group">
                                    <div>
                                        <h3 className="text-md font-bold text-gray-100 truncate group-hover:text-blue-400 transition duration-200">{session.sessionTitle}</h3>
                                        <p className="text-xs text-gray-400 mt-1">
                                            Host: <span className="text-gray-300 font-semibold">@{session.trainerUsername}</span>
                                        </p>
                                        
                                        {user?.username === session.trainerUsername && (
                                            <div className="mt-3 flex items-center gap-2">
                                                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Access Code:</span>
                                                <span className="text-xs font-mono font-bold tracking-[0.15em] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-lg">
                                                    {session.joinCode}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                    
                                    <div className="mt-6 flex items-center gap-3">
                                        <button 
                                            onClick={() => handleJoinSession(session)}
                                            disabled={joiningId === session.sessionId || deletingId === session.sessionId}
                                            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-800 disabled:text-gray-600 text-white py-2 px-3 rounded-xl font-bold transition text-xs active:scale-[0.98]"
                                        >
                                            {joiningId === session.sessionId ? 'Joining...' : 'Join Workspace'}
                                        </button>
                                        
                                        {user?.username === session.trainerUsername && (
                                            <button 
                                                onClick={() => handleDeleteSession(session.sessionId)}
                                                disabled={deletingId === session.sessionId || joiningId === session.sessionId}
                                                className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 disabled:bg-gray-850 disabled:opacity-50 text-red-400 py-2 px-4 rounded-xl font-bold transition text-xs active:scale-[0.98]"
                                            >
                                                {deletingId === session.sessionId ? 'Ending...' : 'End'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}