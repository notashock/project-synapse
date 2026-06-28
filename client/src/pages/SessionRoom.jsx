import { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useSessionRoom } from '../hooks/useSessionRoom';
import { useSessionNav } from '../context/SessionNavContext';
import { AuthContext } from '../context/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';

import SharedFiles from '../components/sessionRoom/SharedFiles';
import LiveChat from '../components/sessionRoom/LiveChat';
import ActivitySidebar from '../components/sessionRoom/ActivitySidebar';

export default function SessionRoom() {
    const { sessionId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { user, loading } = useContext(AuthContext);
    const { setSessionNav } = useSessionNav();
    
    const [sessionMeta, setSessionMeta] = useState(location.state || null);
    const [loadingMeta, setLoadingMeta] = useState(!location.state);
    const [isActivityOpen, setIsActivityOpen] = useState(false);

    useEffect(() => {
        if (!sessionMeta) {
            const fetchMeta = async () => {
                try {
                    const res = await api.get(`/sessions/${sessionId}`);
                    setSessionMeta(res.data);
                } catch (err) {
                    toast.error("Session has ended or is not available.");
                    navigate('/dashboard');
                } finally {
                    setLoadingMeta(false);
                }
            };
            fetchMeta();
        }
    }, [sessionId, sessionMeta, navigate]);

    // Initialize hook once session metadata is available
    const sessionData = useSessionRoom(
        sessionId, 
        navigate, 
        sessionMeta?.isLocal ?? sessionMeta?.local, 
        sessionMeta?.hostUsername || sessionMeta?.host
    );

    // Push session-specific data into Navbar via context
    useEffect(() => {
        if (!sessionMeta) return;
        setSessionNav({
            sessionId,
            sessionTitle: sessionMeta.sessionTitle || 'Live Workspace',
            host: sessionMeta.hostUsername || sessionMeta.host,
            joinCode: sessionMeta.joinCode,
            isConnected: sessionData.isConnected,
            isLeaving: sessionData.isLeaving,
            handleLeaveSession: sessionData.handleLeaveSession,
            isActivityOpen,
            setIsActivityOpen,
        });

        return () => setSessionNav(null);
    }, [
        sessionId, sessionMeta, sessionData.isConnected, sessionData.isLeaving, 
        sessionData.handleLeaveSession, isActivityOpen, setSessionNav
    ]);

    useEffect(() => {
        if (!loading && !loadingMeta && !user && !(sessionMeta?.isLocal ?? sessionMeta?.local)) {
            navigate('/login');
        }
    }, [user, loading, loadingMeta, navigate, sessionMeta]);

    if (loading || loadingMeta) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-900 text-white font-sans">
                <p className="animate-pulse">Loading workspace details...</p>
            </div>
        );
    }

    if (!user && !(sessionMeta?.isLocal ?? sessionMeta?.local)) {
        return null;
    }

    return (
        <div className="flex flex-col lg:flex-row h-[calc(100dvh-53px)] bg-gray-900 text-white font-sans overflow-hidden">
            <div className="flex-1 p-3 sm:p-4 lg:p-6 flex flex-col min-w-0 h-full relative">
                {sessionData.connectionError && (
                    <div className="absolute top-4 left-4 right-4 bg-red-600/90 backdrop-blur text-white px-4 py-3 rounded-lg flex items-center justify-between z-50 border border-red-500 shadow-lg">
                        <div>
                            <span className="font-bold">WebRTC Inconsistency:</span> Some session members (
                            {sessionData.connectionError.missing?.join(', ') || 'N/A'}) are not connected via P2P.
                        </div>
                        <button 
                            onClick={sessionData.handleRetryConnection}
                            className="bg-white text-red-600 font-bold px-3 py-1.5 rounded-md hover:bg-gray-100 transition-all text-sm ml-4 shadow shrink-0"
                        >
                            Retry Connection
                        </button>
                    </div>
                )}
                <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0 overflow-hidden pb-2">
                    <SharedFiles sessionData={sessionData} />
                    <LiveChat sessionData={sessionData} hostUsername={sessionMeta?.hostUsername || sessionMeta?.host} />
                </div>
            </div>

            <ActivitySidebar 
                notifications={sessionData.notifications} 
                isActivityOpen={isActivityOpen} 
                setIsActivityOpen={setIsActivityOpen} 
            />

            {isActivityOpen && (
                <div className="fixed inset-0 bg-black/50 z-40 xl:hidden" onClick={() => setIsActivityOpen(false)} />
            )}
        </div>
    );
}