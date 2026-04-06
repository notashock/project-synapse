export default function ActivitySidebar({ notifications, isActivityOpen, setIsActivityOpen }) {
    return (
        <div className={`
            fixed inset-y-0 right-0 z-50 w-64 sm:w-72 bg-gray-800 p-4 sm:p-6 flex flex-col border-l border-gray-700 shadow-2xl xl:shadow-none
            transform transition-transform duration-300 ease-in-out
            ${isActivityOpen ? 'translate-x-0' : 'translate-x-full'}
            xl:relative xl:translate-x-0
        `}>
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-700">
                <h2 className="text-xs sm:text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                    <span className="text-green-400">⚡</span> Room Activity
                </h2>
                <button onClick={() => setIsActivityOpen(false)} className="xl:hidden text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-2 sm:space-y-3 custom-scrollbar pr-1">
                {notifications.length === 0 ? (
                    <p className="text-gray-500 text-[10px] sm:text-xs font-semibold text-center mt-4">Waiting for activity...</p>
                ) : (
                    notifications.map((note, index) => (
                        <div key={index} className="text-[10px] sm:text-xs font-semibold text-gray-300 bg-gray-700/50 p-2 sm:p-3 rounded border-l-4 border-blue-500 shadow-sm break-words">
                            {note}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}