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
            navigate(`/session/${session.sessionId}`, { state: { joinCode: session.joinCode, trainer: session.trainerUsername } });
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
        <div className="min-h-screen bg-gray-900 text-white p-4 md:p-8">
            {/* RESPONSIVE HEADER */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 pb-4 border-b border-gray-700">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-blue-400">Placement Hub</h1>
                    <p className="text-gray-400 text-xs md:text-sm mt-1">Logged in as: <span className="text-green-400 font-semibold">{user?.username}</span></p>
                </div>
                
                <button 
                    onClick={handleLogout} 
                    disabled={isLoggingOut}
                    className="bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:opacity-50 text-white px-4 py-2 rounded transition flex items-center gap-2 w-full sm:w-auto justify-center font-bold"
                >
                    {isLoggingOut ? 'Logging out...' : 'Logout'}
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
                {/* CREATE SESSION FORM */}
                <div className="lg:col-span-1 order-first lg:order-none">
                    <div className="bg-gray-800 p-5 md:p-6 rounded-lg shadow-lg border border-gray-700">
                        <h2 className="text-lg md:text-xl font-bold mb-4 text-gray-200">Start New Session</h2>
                        <form onSubmit={handleCreateSession} className="space-y-4">
                            <div>
                                <label className="block text-gray-400 mb-1 text-sm font-bold">Session Title</label>
                                <input 
                                    type="text" 
                                    className="w-full p-3 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                                    placeholder="e.g., TCS Prep"
                                    value={sessionTitle}
                                    onChange={(e) => setSessionTitle(e.target.value)}
                                    disabled={isCreating}
                                    required
                                />
                            </div>
                            <button 
                                type="submit" 
                                disabled={isCreating || !sessionTitle.trim()}
                                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-bold py-3 px-4 rounded-lg transition"
                            >
                                {isCreating ? 'Creating...' : 'Create Session'}
                            </button>
                        </form>
                    </div>
                </div>

                {/* LIVE SESSIONS GRID */}
                <div className="lg:col-span-2">
                    <h2 className="text-xl md:text-2xl font-bold mb-4 text-gray-200">Live Sessions</h2>
                    
                    {isLoading ? (
                        <div className="flex justify-center items-center h-32 bg-gray-800 rounded-lg border border-gray-700">
                            <p className="text-gray-400 animate-pulse">Loading active sessions...</p>
                        </div>
                    ) : sessions.length === 0 ? (
                        <div className="bg-gray-800 p-8 rounded-lg border border-gray-700 text-center shadow-inner">
                            <p className="text-gray-400 text-lg">No active sessions right now.</p>
                            <p className="text-sm text-gray-500 mt-2">Create one using the panel on the left!</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {sessions.map((session) => (
                                <div key={session.sessionId} className="bg-gray-800 p-5 rounded-lg border border-gray-700 shadow-lg flex flex-col justify-between hover:border-gray-500 transition">
                                    <div>
                                        <h3 className="text-lg font-bold text-blue-300 truncate">{session.sessionTitle}</h3>
                                        <p className="text-sm text-gray-400 mt-1">
                                            Trainer: <span className="text-gray-200 font-semibold">{session.trainerUsername}</span>
                                        </p>
                                        
                                        {user?.username === session.trainerUsername && (
                                            <p className="text-sm text-green-400 mt-3 font-mono bg-gray-900 inline-block px-3 py-1.5 rounded border border-green-800/50 shadow-sm">
                                                Code: <span className="font-bold tracking-[0.15em] text-green-300">{session.joinCode}</span>
                                            </p>
                                        )}
                                    </div>
                                    
                                    {/* Responsive Action Buttons */}
                                    <div className="mt-6 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                                        <button 
                                            onClick={() => handleJoinSession(session)}
                                            disabled={joiningId === session.sessionId || deletingId === session.sessionId}
                                            className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:opacity-50 text-white py-2 px-3 rounded font-bold transition w-full"
                                        >
                                            {joiningId === session.sessionId ? 'Joining...' : 'Join Session'}
                                        </button>
                                        
                                        {user?.username === session.trainerUsername && (
                                            <button 
                                                onClick={() => handleDeleteSession(session.sessionId)}
                                                disabled={deletingId === session.sessionId || joiningId === session.sessionId}
                                                className="bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:opacity-50 text-white py-2 px-4 rounded font-bold transition w-full sm:w-auto"
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