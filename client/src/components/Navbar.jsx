import { useContext, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { useSessionNav } from '../context/SessionNavContext';
import { 
    Zap, LogOut, Wifi, WifiOff, DoorOpen, XCircle, 
    Copy, Check, Menu, X
} from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';

export default function Navbar() {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, logout } = useContext(AuthContext);
    const { sessionNav } = useSessionNav();
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [isEnding, setIsEnding] = useState(false);
    const [copied, setCopied] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const isLoginPage = location.pathname === '/login' || location.pathname === '/';
    const isDashboard = location.pathname === '/dashboard';
    const isSessionPage = location.pathname.startsWith('/session/');

    const handleLogout = async () => {
        if (isLoggingOut) return;
        setIsLoggingOut(true);
        try { await logout(navigate); } finally { setIsLoggingOut(false); }
    };

    const handleEndSession = async () => {
        if (!sessionNav?.sessionId) return;
        if (!window.confirm("Are you sure you want to end this session for everyone?")) return;
        setIsEnding(true);
        try {
            await api.delete(`/sessions/end/${sessionNav.sessionId}`);
            toast.success("Session terminated.");
            navigate('/dashboard');
        } catch (error) {
            toast.error(error.response?.data?.message || "Failed to end session");
        } finally {
            setIsEnding(false);
        }
    };

    const handleCopyCode = () => {
        if (sessionNav?.joinCode) {
            navigator.clipboard.writeText(sessionNav.joinCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    // ─── LOGIN PAGE: minimal branding ───
    if (isLoginPage) return null; // Login has its own branding

    return (
        <nav className="bg-gray-900/80 backdrop-blur-xl border-b border-white/10 px-4 sm:px-6 py-3 shrink-0 relative z-50">
            <div className="flex items-center justify-between gap-3">
                {/* LEFT: Logo */}
                <div className="flex items-center gap-3 min-w-0">
                    <div 
                        className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-600/20 shrink-0 cursor-pointer"
                        onClick={() => !isSessionPage && navigate('/dashboard')}
                    >
                        <Zap className="w-4 h-4 text-white" />
                    </div>
                    
                    {isSessionPage && sessionNav ? (
                        <div className="min-w-0">
                            <h1 className="text-sm sm:text-base font-bold text-white truncate leading-tight">
                                {sessionNav.sessionTitle || 'Live Workspace'}
                            </h1>
                            <p className="text-[10px] text-gray-500 font-medium truncate">
                                Host: @{sessionNav.trainer}
                            </p>
                        </div>
                    ) : (
                        <h1 className="text-base sm:text-lg font-extrabold tracking-tight bg-gradient-to-r from-blue-400 to-indigo-300 bg-clip-text text-transparent">
                            Synapse
                        </h1>
                    )}
                </div>

                {/* RIGHT: Desktop Actions */}
                <div className="hidden sm:flex items-center gap-3">
                    {/* ─── SESSION PAGE actions ─── */}
                    {isSessionPage && sessionNav && (
                        <>
                            {/* Connection Status */}
                            <span className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border ${
                                sessionNav.isConnected 
                                    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' 
                                    : 'text-red-400 bg-red-500/10 border-red-500/20'
                            }`}>
                                {sessionNav.isConnected 
                                    ? <Wifi className="w-3.5 h-3.5" /> 
                                    : <WifiOff className="w-3.5 h-3.5" />
                                }
                                {sessionNav.isConnected ? 'Connected' : 'Reconnecting...'}
                            </span>

                            {/* Join Code (trainer only) */}
                            {user?.username === sessionNav.trainer && sessionNav.joinCode && (
                                <button 
                                    onClick={handleCopyCode}
                                    className="flex items-center gap-1.5 bg-gray-800/80 border border-white/10 rounded-lg px-3 py-1.5 hover:border-white/20 transition group"
                                    title="Click to copy"
                                >
                                    <span className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">Code</span>
                                    <span className="text-sm font-mono font-bold text-blue-400 tracking-widest">{sessionNav.joinCode}</span>
                                    {copied 
                                        ? <Check className="w-3 h-3 text-emerald-400" /> 
                                        : <Copy className="w-3 h-3 text-gray-500 group-hover:text-gray-300 transition" />
                                    }
                                </button>
                            )}

                            {/* Activity Toggle */}
                            <button
                                onClick={() => sessionNav.setIsActivityOpen?.(!sessionNav.isActivityOpen)}
                                className="xl:hidden flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg border border-gray-700 transition"
                            >
                                Activity
                            </button>

                            {/* End Session (trainer only) */}
                            {user?.username === sessionNav.trainer && (
                                <button 
                                    onClick={handleEndSession}
                                    disabled={isEnding || sessionNav.isLeaving}
                                    className="flex items-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 px-3 py-1.5 rounded-lg font-bold text-xs transition active:scale-95 disabled:opacity-50"
                                >
                                    <XCircle className="w-3.5 h-3.5" />
                                    {isEnding ? 'Ending...' : 'End'}
                                </button>
                            )}

                            {/* Leave Room */}
                            <button 
                                onClick={sessionNav.handleLeaveSession}
                                disabled={sessionNav.isLeaving || isEnding}
                                className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 border border-gray-600/50 text-white px-3 py-1.5 rounded-lg font-bold text-xs transition active:scale-95 shadow-md disabled:opacity-50"
                            >
                                <DoorOpen className="w-3.5 h-3.5" />
                                {sessionNav.isLeaving ? 'Leaving...' : 'Leave'}
                            </button>
                        </>
                    )}

                    {/* ─── DASHBOARD actions ─── */}
                    {isDashboard && user && (
                        <>
                            <span className="text-xs text-gray-400 font-medium">
                                <span className="text-blue-400 font-semibold">@{user.username}</span>
                            </span>
                            <button 
                                onClick={handleLogout} 
                                disabled={isLoggingOut}
                                className="flex items-center gap-1.5 bg-red-500/15 hover:bg-red-500/25 border border-red-500/20 text-red-300 px-3 py-1.5 rounded-lg transition font-bold text-xs uppercase tracking-wider active:scale-95 disabled:opacity-50"
                            >
                                <LogOut className="w-3.5 h-3.5" />
                                {isLoggingOut ? 'Logging out...' : 'Logout'}
                            </button>
                        </>
                    )}
                </div>

                {/* RIGHT: Mobile hamburger */}
                <button 
                    className="sm:hidden text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-white/5 transition"
                    onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                >
                    {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                </button>
            </div>

            {/* ─── MOBILE DROPDOWN ─── */}
            {mobileMenuOpen && (
                <div className="sm:hidden mt-3 pt-3 border-t border-white/10 flex flex-col gap-2.5">
                    {isSessionPage && sessionNav && (
                        <>
                            <span className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border w-fit ${
                                sessionNav.isConnected 
                                    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' 
                                    : 'text-red-400 bg-red-500/10 border-red-500/20'
                            }`}>
                                {sessionNav.isConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                                {sessionNav.isConnected ? 'Connected' : 'Reconnecting...'}
                            </span>

                            {user?.username === sessionNav.trainer && sessionNav.joinCode && (
                                <button onClick={handleCopyCode} className="flex items-center gap-2 text-xs text-gray-300">
                                    <span className="text-gray-500 uppercase tracking-wider font-bold">Code:</span>
                                    <span className="font-mono font-bold text-blue-400 tracking-widest">{sessionNav.joinCode}</span>
                                    {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-gray-500" />}
                                </button>
                            )}

                            <button
                                onClick={() => { sessionNav.setIsActivityOpen?.(!sessionNav.isActivityOpen); setMobileMenuOpen(false); }}
                                className="xl:hidden flex items-center gap-1.5 text-xs font-bold text-gray-400 bg-gray-800 px-3 py-2 rounded-lg border border-gray-700 w-fit"
                            >
                                Activity
                            </button>

                            <div className="flex gap-2 pt-1">
                                {user?.username === sessionNav.trainer && (
                                    <button 
                                        onClick={() => { handleEndSession(); setMobileMenuOpen(false); }}
                                        disabled={isEnding}
                                        className="flex-1 flex items-center justify-center gap-1.5 bg-red-500/10 border border-red-500/20 text-red-400 py-2 rounded-lg font-bold text-xs disabled:opacity-50"
                                    >
                                        <XCircle className="w-3.5 h-3.5" />
                                        {isEnding ? 'Ending...' : 'End'}
                                    </button>
                                )}
                                <button 
                                    onClick={() => { sessionNav.handleLeaveSession?.(); setMobileMenuOpen(false); }}
                                    disabled={sessionNav.isLeaving}
                                    className="flex-1 flex items-center justify-center gap-1.5 bg-gray-700 border border-gray-600/50 text-white py-2 rounded-lg font-bold text-xs disabled:opacity-50"
                                >
                                    <DoorOpen className="w-3.5 h-3.5" />
                                    {sessionNav.isLeaving ? 'Leaving...' : 'Leave'}
                                </button>
                            </div>
                        </>
                    )}

                    {isDashboard && user && (
                        <>
                            <span className="text-xs text-gray-400">Logged in as <span className="text-blue-400 font-semibold">@{user.username}</span></span>
                            <button 
                                onClick={() => { handleLogout(); setMobileMenuOpen(false); }}
                                disabled={isLoggingOut}
                                className="flex items-center justify-center gap-1.5 bg-red-500/15 border border-red-500/20 text-red-300 py-2 rounded-lg font-bold text-xs uppercase tracking-wider disabled:opacity-50"
                            >
                                <LogOut className="w-3.5 h-3.5" />
                                {isLoggingOut ? 'Logging out...' : 'Logout'}
                            </button>
                        </>
                    )}
                </div>
            )}
        </nav>
    );
}
