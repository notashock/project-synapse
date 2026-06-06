import { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useSessionRoom } from '../hooks/useSessionRoom';
import { useSessionNav } from '../context/SessionNavContext';
import { AuthContext } from '../context/AuthContext';

import SharedFiles from '../components/sessionRoom/SharedFiles';
import LiveChat from '../components/sessionRoom/LiveChat';
import ActivitySidebar from '../components/sessionRoom/ActivitySidebar';

export default function SessionRoom() {
    const { sessionId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { user, loading } = useContext(AuthContext);
    const { setSessionNav } = useSessionNav();
    
    const { joinCode, trainer, sessionTitle } = location.state || {}; 

    const [isActivityOpen, setIsActivityOpen] = useState(false);
    const sessionData = useSessionRoom(sessionId, navigate);

    // Push session-specific data into Navbar via context
    useEffect(() => {
        setSessionNav({
            sessionId,
            sessionTitle: sessionTitle || 'Live Workspace',
            trainer,
            joinCode,
            isConnected: sessionData.isConnected,
            isLeaving: sessionData.isLeaving,
            handleLeaveSession: sessionData.handleLeaveSession,
            isActivityOpen,
            setIsActivityOpen,
        });

        return () => setSessionNav(null);
    }, [
        sessionId, sessionTitle, trainer, joinCode,
        sessionData.isConnected, sessionData.isLeaving, 
        sessionData.handleLeaveSession, isActivityOpen, setSessionNav
    ]);

    useEffect(() => {
        if (!loading && !user) {
            navigate('/login');
        }
    }, [user, loading, navigate]);

    if (loading || !user) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-900 text-white font-sans">
                <p className="animate-pulse">Verifying credentials...</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col lg:flex-row h-[calc(100dvh-53px)] bg-gray-900 text-white font-sans overflow-hidden">
            <div className="flex-1 p-3 sm:p-4 lg:p-6 flex flex-col min-w-0 h-full relative">
                <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0 overflow-hidden pb-2">
                    <SharedFiles sessionData={sessionData} />
                    <LiveChat sessionData={sessionData} trainer={trainer} />
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