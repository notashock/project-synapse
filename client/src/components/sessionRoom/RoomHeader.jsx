export default function RoomHeader({ joinCode, trainer, isActivityOpen, setIsActivityOpen, sessionData }) {
    const { user, isConnected, isLeaving, handleLeaveSession } = sessionData;

    return (
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 pb-4 border-b border-gray-700 shrink-0">
            <div className="flex justify-between items-center w-full sm:w-auto">
                <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-blue-400 truncate">Live Workspace</h1>
                <button 
                    onClick={() => setIsActivityOpen(!isActivityOpen)}
                    className="xl:hidden text-gray-400 hover:text-white bg-gray-800 px-3 py-1.5 rounded-lg border border-gray-700 text-xs font-bold transition"
                >
                    {isActivityOpen ? 'Close Activity' : 'Show Activity'}
                </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 sm:gap-6 w-full sm:w-auto justify-between sm:justify-end">
                {user?.username === trainer && joinCode && (
                    <div className="bg-gray-800 border border-blue-500/50 rounded-lg px-3 sm:px-6 py-1 text-center shadow-[0_0_15px_rgba(59,130,246,0.15)]">
                        <span className="text-[9px] sm:text-[10px] text-gray-400 uppercase tracking-widest block mb-0.5">Room Code</span>
                        <span className="text-sm sm:text-xl font-mono font-black text-blue-400 tracking-[0.2em]">{joinCode}</span>
                    </div>
                )}

                <div className="flex items-center gap-3 sm:gap-4">
                    <span className="flex items-center gap-1 sm:gap-2 whitespace-nowrap text-xs sm:text-sm font-semibold">
                        <span className={`w-2 h-2 sm:w-3 sm:h-3 rounded-full shadow-lg ${isConnected ? 'bg-green-500 shadow-green-500/50 animate-pulse' : 'bg-red-500 shadow-red-500/50'}`}></span>
                        <span className={`hidden sm:inline ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
                            {isConnected ? 'Connected' : 'Connecting...'}
                        </span>
                    </span>
                    <button 
                        onClick={handleLeaveSession}
                        disabled={isLeaving}
                        className="bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:opacity-50 px-3 sm:px-5 py-1.5 sm:py-2 rounded font-bold text-xs sm:text-sm whitespace-nowrap transition shadow-lg"
                    >
                        {isLeaving ? 'Leaving...' : 'Leave Room'}
                    </button>
                </div>
            </div>
        </div>
    );
}