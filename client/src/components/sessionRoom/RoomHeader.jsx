import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';

export default function RoomHeader({ joinCode, trainer, sessionTitle, isActivityOpen, setIsActivityOpen, sessionData }) {
    const { user, isConnected, isLeaving, handleLeaveSession } = sessionData;
    const { sessionId } = useParams();
    const navigate = useNavigate();
    const [isEnding, setIsEnding] = useState(false);

    const handleEndSession = async () => {
        if (!window.confirm("Are you sure you want to end this session for everyone?")) return;
        setIsEnding(true);
        try {
            await api.delete(`/sessions/end/${sessionId}`);
            toast.success("Session terminated.");
            navigate('/dashboard');
        } catch (error) {
            toast.error(error.response?.data?.message || "Failed to end session");
        } finally {
            setIsEnding(false);
        }
    };

    return (
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 pb-4 border-b border-gray-700 shrink-0">
            <div className="flex justify-between items-center w-full sm:w-auto">
                <h1 className="text-xl sm:text-2xl lg:text-3xl font-black text-blue-400 truncate tracking-tight">
                    {sessionTitle || "Live Workspace"}
                </h1>
                <button 
                    onClick={() => setIsActivityOpen(!isActivityOpen)}
                    className="xl:hidden text-gray-400 hover:text-white bg-gray-800 px-3 py-1.5 rounded-lg border border-gray-700 text-xs font-bold transition ml-3"
                >
                    {isActivityOpen ? 'Close Activity' : 'Show Activity'}
                </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 sm:gap-6 w-full sm:w-auto justify-between sm:justify-end">
                {user?.username === trainer && joinCode && (
                    <div className="bg-gray-800/80 border border-blue-500/30 rounded-xl px-4 py-1.5 text-center shadow-md">
                        <span className="text-[9px] text-gray-400 uppercase tracking-widest block mb-0.5">Room Code</span>
                        <span className="text-sm sm:text-lg font-mono font-black text-blue-400 tracking-[0.2em]">{joinCode}</span>
                    </div>
                )}

                <div className="flex items-center gap-3 sm:gap-4">
                    <span className="flex items-center gap-1 sm:gap-2 whitespace-nowrap text-xs sm:text-sm font-semibold">
                        <span className={`w-2 h-2 sm:w-3 sm:h-3 rounded-full shadow-lg ${isConnected ? 'bg-green-500 shadow-green-500/50 animate-pulse' : 'bg-red-500 shadow-red-500/50'}`}></span>
                        <span className={`hidden sm:inline ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
                            {isConnected ? 'Connected' : 'Reconnecting...'}
                        </span>
                    </span>

                    {user?.username === trainer && (
                        <button 
                            onClick={handleEndSession}
                            disabled={isEnding || isLeaving}
                            className="bg-red-500/10 hover:bg-red-500/25 border border-red-500/20 text-red-400 px-3 sm:px-5 py-1.5 sm:py-2 rounded-xl font-bold text-xs sm:text-sm whitespace-nowrap transition active:scale-95"
                        >
                            {isEnding ? 'Ending...' : 'End Session'}
                        </button>
                    )}

                    <button 
                        onClick={handleLeaveSession}
                        disabled={isLeaving || isEnding}
                        className="bg-gray-700 hover:bg-gray-600 border border-gray-600/50 text-white px-3 sm:px-5 py-1.5 sm:py-2 rounded-xl font-bold text-xs sm:text-sm whitespace-nowrap transition active:scale-95 shadow-md"
                    >
                        {isLeaving ? 'Leaving...' : 'Leave Room'}
                    </button>
                </div>
            </div>
        </div>
    );
}