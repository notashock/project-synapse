import { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import { Plus, Radio, RefreshCw, Users, Trash2, ArrowRight, Wifi, Globe } from 'lucide-react';

export default function Dashboard() {
    const { user, guestUsername } = useContext(AuthContext);
    const navigate = useNavigate();
    
    const [sessions, setSessions] = useState([]);
    const [sessionTitle, setSessionTitle] = useState('');
    const [isLocalMode, setIsLocalMode] = useState(!user);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [joiningId, setJoiningId] = useState(null);
    const [deletingId, setDeletingId] = useState(null);

    // Direct access code join states
    const [directJoinCode, setDirectJoinCode] = useState('');
    const [isJoiningByCode, setIsJoiningByCode] = useState(false);

    const fetchSessions = async () => {
        setIsLoading(true);
        try {
            const response = await api.get('/sessions/active');
            if (user) {
                setSessions(response.data);
            } else {
                setSessions(response.data.filter(s => s.isLocal ?? s.local));
            }
        } catch (error) {
            if (error.response?.status !== 401) toast.error('Failed to load active sessions');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchSessions();
        setIsLocalMode(!user);
    }, [user]);

    const handleCreateSession = async (e) => {
        e.preventDefault();
        if (!sessionTitle.trim() || isCreating) return;
        setIsCreating(true);
        try {
            const response = await api.post('/sessions/create', { 
                sessionTitle,
                isLocal: isLocalMode,
                guestUsername: guestUsername
            });
            const session = response.data;
            toast.success(`Session Created! Code: ${session.joinCode}`, { duration: 5000 });
            setSessionTitle(''); 
            
            // Automatically join the newly created session
            navigate(`/session/${session.sessionId}`, { 
                state: { 
                    joinCode: session.joinCode, 
                    trainer: user?.username || guestUsername,
                    sessionTitle: session.sessionTitle,
                    isLocal: isLocalMode
                } 
            });
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
            await api.post(`/sessions/join/${session.sessionId}`, { 
                joinCode: code,
                guestUsername: guestUsername 
            });
            navigate(`/session/${session.sessionId}`, { 
                state: { 
                    joinCode: session.joinCode, 
                    trainer: session.trainerUsername,
                    sessionTitle: session.sessionTitle,
                    isLocal: session.isLocal ?? session.local
                } 
            });
        } catch (error) {
            toast.error(error.response?.data?.message || 'Incorrect Join Code');
            setJoiningId(null); 
        }
    };

    const handleJoinByCode = async (e) => {
        e.preventDefault();
        const code = directJoinCode.trim().toUpperCase();
        if (!code || isJoiningByCode) return;
        setIsJoiningByCode(true);
        try {
            // 1. Fetch session metadata by access code
            const response = await api.get(`/sessions/code/${code}`);
            const session = response.data;
            
            // 2. Register joiner in session
            await api.post(`/sessions/join/${session.sessionId}`, {
                joinCode: code,
                guestUsername: guestUsername
            });
            
            toast.success("Joined Workspace!");
            setDirectJoinCode('');
            
            // 3. Navigate to session room
            navigate(`/session/${session.sessionId}`, {
                state: {
                    joinCode: session.joinCode,
                    trainer: session.trainerUsername,
                    sessionTitle: session.sessionTitle,
                    isLocal: session.isLocal ?? session.local
                }
            });
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to join session. Verify access code.');
        } finally {
            setIsJoiningByCode(false);
        }
    };

    return (
        <div className="h-[calc(100dvh-53px)] bg-linear-to-b from-gray-900 via-gray-950 to-black text-white p-4 md:p-8 relative overflow-y-auto custom-scrollbar">
            {/* Background glowing effects */}
            <div className="absolute top-0 right-1/4 w-96 h-96 bg-blue-600/5 rounded-full blur-[120px] pointer-events-none"></div>
            <div className="absolute bottom-10 left-1/4 w-96 h-96 bg-purple-600/5 rounded-full blur-[120px] pointer-events-none"></div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8 relative z-10">
                {/* CREATE & JOIN PANEL */}
                <div className="lg:col-span-1 order-first lg:order-0 space-y-6">
                    {/* START NEW SESSION */}
                    <div className="bg-white/5 backdrop-blur-md p-5 md:p-6 rounded-2xl border border-white/10 shadow-xl">
                        <h2 className="text-sm font-bold mb-4 text-gray-200 uppercase tracking-wider flex items-center gap-2">
                            <Plus className="w-4 h-4 text-blue-400" />
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
                            
                            <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${isLocalMode ? 'bg-blue-600/10 border-blue-500/50' : 'bg-gray-950/60 border-gray-800 hover:border-gray-700'} ${!user ? 'opacity-70 cursor-not-allowed' : ''}`}>
                                <div className="relative flex items-center justify-center">
                                    <input 
                                        type="checkbox" 
                                        className="sr-only" 
                                        checked={isLocalMode}
                                        onChange={(e) => !user ? null : setIsLocalMode(e.target.checked)}
                                        disabled={!user || isCreating}
                                    />
                                    <div className={`w-5 h-5 rounded flex items-center justify-center border transition-all ${isLocalMode ? 'bg-blue-600 border-blue-500' : 'bg-gray-800 border-gray-600'}`}>
                                        {isLocalMode && <Wifi className="w-3.5 h-3.5 text-white" />}
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <div className="text-sm font-bold text-gray-200">Local Network Mode</div>
                                    <div className="text-[10px] text-gray-500 leading-tight mt-0.5">Faster P2P sharing, bypasses cloud server</div>
                                </div>
                            </label>

                            <button 
                                type="submit" 
                                disabled={isCreating || !sessionTitle.trim()}
                                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-800 disabled:text-gray-500 text-white font-bold py-3 px-4 rounded-xl transition active:scale-[0.98] shadow-lg shadow-blue-600/20 text-sm flex items-center justify-center gap-2"
                            >
                                <Plus className="w-4 h-4" />
                                {isCreating ? 'Creating...' : 'Create Session'}
                            </button>
                        </form>
                    </div>

                    {/* JOIN WITH CODE */}
                    <div className="bg-white/5 backdrop-blur-md p-5 md:p-6 rounded-2xl border border-white/10 shadow-xl">
                        <h2 className="text-sm font-bold mb-4 text-gray-200 uppercase tracking-wider flex items-center gap-2">
                            <ArrowRight className="w-4 h-4 text-blue-400" />
                            Join with Access Code
                        </h2>
                        <form onSubmit={handleJoinByCode} className="space-y-4">
                            <div>
                                <label className="block text-gray-400 mb-1.5 text-xs font-bold uppercase tracking-wider">Access Code</label>
                                <input 
                                    type="text" 
                                    className="w-full px-4 py-3 bg-gray-950/60 text-white rounded-xl border border-gray-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm font-mono tracking-[0.2em] uppercase placeholder-gray-600 transition"
                                    placeholder="E.G. A4X9D2"
                                    value={directJoinCode}
                                    onChange={(e) => setDirectJoinCode(e.target.value)}
                                    maxLength={6}
                                    required
                                    disabled={isJoiningByCode}
                                />
                            </div>
                            <button 
                                type="submit" 
                                disabled={isJoiningByCode || !directJoinCode.trim()}
                                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-800 disabled:text-gray-500 text-white font-bold py-3 px-4 rounded-xl transition active:scale-[0.98] shadow-lg shadow-emerald-600/20 text-sm flex items-center justify-center gap-2"
                            >
                                <ArrowRight className="w-4 h-4" />
                                {isJoiningByCode ? 'Joining...' : 'Join Workspace'}
                            </button>
                        </form>
                    </div>
                </div>

                {/* LIVE SESSIONS GRID */}
                <div className="lg:col-span-2">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2">
                            <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                            Active Rooms
                        </h2>
                        <button 
                            onClick={fetchSessions}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 hover:text-white transition duration-200 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider active:scale-95 cursor-pointer"
                            title="Reload active sessions"
                        >
                            <RefreshCw className="w-3.5 h-3.5" />
                            Reload
                        </button>
                    </div>
                    
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
                        <div className="max-h-[calc(100dvh-220px)] overflow-y-auto pr-1 custom-scrollbar">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {sessions.map((session) => (
                                    <div key={session.sessionId} className="bg-white/5 p-5 rounded-2xl border border-white/10 shadow-lg flex flex-col justify-between hover:border-white/20 transition-all duration-300 group">
                                        <div>
                                            <h3 className="text-md font-bold text-gray-100 truncate group-hover:text-blue-400 transition duration-200 flex items-center gap-2">
                                                {(session.isLocal ?? session.local) ? <Wifi className="w-4 h-4 text-blue-400" title="Local Network Session" /> : <Globe className="w-4 h-4 text-emerald-400" title="Cloud Session" />}
                                                {session.sessionTitle}
                                            </h3>
                                            <p className="text-xs text-gray-400 mt-1 flex items-center gap-1.5">
                                                <Users className="w-3 h-3" />
                                                Host: <span className="text-gray-300 font-semibold">@{session.trainerUsername}</span>
                                            </p>
                                            
                                            {(user?.username === session.trainerUsername || guestUsername === session.trainerUsername) && (
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
                                                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-800 disabled:text-gray-600 text-white py-2 px-3 rounded-xl font-bold transition text-xs active:scale-[0.98] flex items-center justify-center gap-1.5 cursor-pointer"
                                            >
                                                <ArrowRight className="w-3.5 h-3.5" />
                                                {joiningId === session.sessionId ? 'Joining...' : 'Join Workspace'}
                                            </button>
                                            
                                            {(user?.username === session.trainerUsername || guestUsername === session.trainerUsername) && (
                                                <button 
                                                    onClick={() => handleDeleteSession(session.sessionId)}
                                                    disabled={deletingId === session.sessionId || joiningId === session.sessionId}
                                                    className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 disabled:bg-gray-850 disabled:opacity-50 text-red-400 py-2 px-4 rounded-xl font-bold transition text-xs active:scale-[0.98] flex items-center gap-1.5 cursor-pointer"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                    {deletingId === session.sessionId ? 'Ending...' : 'End'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}