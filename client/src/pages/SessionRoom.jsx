import { useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useSessionRoom } from '../hooks/useSessionRoom';

import RoomHeader from '../components/sessionRoom/RoomHeader';
import SharedFiles from '../components/sessionRoom/SharedFiles';
import LiveChat from '../components/sessionRoom/LiveChat';
import ActivitySidebar from '../components/sessionRoom/ActivitySidebar';

export default function SessionRoom() {
    const { sessionId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    
    // Extracting dynamic session title from dashboard routing
    const { joinCode, trainer, sessionTitle } = location.state || {}; 

    const [isActivityOpen, setIsActivityOpen] = useState(false);
    const sessionData = useSessionRoom(sessionId, navigate);

    return (
        <div className="flex flex-col lg:flex-row h-[100dvh] bg-gray-900 text-white font-sans overflow-hidden">
            <div className="flex-1 p-3 sm:p-4 lg:p-6 flex flex-col min-w-0 h-full relative">
                
                <RoomHeader 
                    joinCode={joinCode} 
                    trainer={trainer}
                    sessionTitle={sessionTitle}
                    isActivityOpen={isActivityOpen}
                    setIsActivityOpen={setIsActivityOpen}
                    sessionData={sessionData} 
                />

                <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0 overflow-hidden pb-2">
                    <SharedFiles sessionData={sessionData} />
                    <LiveChat sessionData={sessionData} />
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