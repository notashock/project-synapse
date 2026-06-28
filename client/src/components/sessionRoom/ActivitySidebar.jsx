import { Activity, X, Bell } from 'lucide-react';

export default function ActivitySidebar({ notifications, isActivityOpen, setIsActivityOpen }) {
    return (
        <div className={`
            fixed inset-y-0 right-0 z-50 w-64 sm:w-72 
            bg-gray-900/95 backdrop-blur-xl p-4 sm:p-6 flex flex-col 
            border-l border-white/10 shadow-2xl xl:shadow-none
            transform transition-transform duration-300 ease-in-out
            ${isActivityOpen ? 'translate-x-0' : 'translate-x-full'}
            xl:relative xl:translate-x-0
        `}>
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-white/10">
                <h2 className="text-xs sm:text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400" /> Room Activity
                </h2>
                <button 
                    onClick={() => setIsActivityOpen(false)} 
                    className="xl:hidden text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-2 sm:space-y-2.5 custom-scrollbar pr-1">
                {notifications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center mt-8 opacity-50 gap-2">
                        <Activity className="w-6 h-6 text-gray-600" />
                        <p className="text-gray-500 text-[10px] sm:text-xs font-medium text-center">Waiting for activity...</p>
                    </div>
                ) : (
                    notifications.map((note, index) => {
                        const isTraffic = note.startsWith('[TRAFFIC]');
                        const cleanNote = isTraffic ? note.replace('[TRAFFIC]', '').trim() : note;
                        return (
                            <div key={index} className={`flex items-start gap-2.5 text-[10px] sm:text-xs font-medium text-gray-350 bg-white/5 p-2.5 sm:p-3 rounded-lg border-l-2 hover:bg-white/[0.07] transition break-word ${
                                isTraffic 
                                ? 'border-emerald-500/65 bg-emerald-500/[0.02]' 
                                : 'border-blue-500/60'
                            }`}>
                                {isTraffic ? (
                                    <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                                ) : (
                                    <Bell className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                                )}
                                <span>{cleanNote}</span>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}