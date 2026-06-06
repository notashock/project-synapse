import { useState, useEffect } from 'react';
import { MessageSquare, Send, Shield } from 'lucide-react';

export default function LiveChat({ sessionData, trainer }) {
    const { user, isConnected, chatMessages, isLeaving, chatEndRef, handleSendMessage } = sessionData;
    const [text, setText] = useState('');

    const onSubmit = (e) => {
        e.preventDefault();
        handleSendMessage(text);
        setText('');
    };

    useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages, chatEndRef]);

    return (
        <div className="flex-1 lg:w-1/2 bg-gray-800/60 backdrop-blur-sm rounded-xl p-3 sm:p-4 border border-white/10 flex flex-col shadow-inner min-h-0">
            <div className="mb-3 pb-2 border-b border-white/10 shrink-0">
                <h2 className="text-xs sm:text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-blue-400" /> Live Chat
                </h2>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                {chatMessages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center opacity-50 gap-2">
                        <MessageSquare className="w-8 h-8 text-gray-600" />
                        <p className="text-xs text-gray-400 font-medium">Session chat is empty. Say hello!</p>
                    </div>
                ) : (
                    chatMessages.map((msg, index) => {
                        const isMe = msg.sender === user?.username;
                        const isTrainer = msg.sender === trainer;
                        return (
                            <div key={index} className={`flex flex-col w-full ${isMe ? 'items-end' : 'items-start'}`}>
                                <span className={`text-[9px] sm:text-[10px] uppercase font-bold mb-0.5 px-1 flex items-center gap-1.5 ${isMe ? 'text-blue-400' : 'text-gray-400'}`}>
                                    {isMe ? 'You' : `@${msg.sender}`}
                                    {isTrainer && (
                                        <span className="flex items-center gap-0.5 text-[8px] bg-blue-500/10 border border-blue-500/30 text-blue-400 font-extrabold px-1 rounded uppercase tracking-wider">
                                            <Shield className="w-2.5 h-2.5" />
                                            Host
                                        </span>
                                    )}
                                </span>
                                <div className={`px-3 sm:px-4 py-2 rounded-2xl max-w-[85%] sm:max-w-[75%] shadow-md text-xs sm:text-sm break-words ${
                                    isMe 
                                    ? 'bg-blue-600 text-white rounded-tr-none shadow-[0_2px_8px_rgba(59,130,246,0.15)]' 
                                    : isTrainer
                                    ? 'bg-gray-750 border border-blue-500/10 text-blue-100 rounded-tl-none'
                                    : 'bg-gray-700 text-gray-100 rounded-tl-none'
                                }`}>
                                    {msg.content}
                                </div>
                            </div>
                        );
                    })
                )}
                <div ref={chatEndRef} />
            </div>

            <form onSubmit={onSubmit} className="flex gap-2 sm:gap-3 shrink-0 pt-3 mt-2 border-t border-white/10">
                <input
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={isConnected ? "Type a message..." : "Connecting..."}
                    className="flex-1 bg-gray-900/80 text-white rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 border border-white/10 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50 text-xs sm:text-sm placeholder-gray-500 transition"
                    autoComplete="off"
                    disabled={!isConnected || isLeaving}
                />
                <button 
                    type="submit"
                    disabled={!text.trim() || !isConnected || isLeaving}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-2 sm:px-4 sm:py-2.5 rounded-lg font-bold transition flex justify-center items-center gap-1.5 text-xs sm:text-sm min-w-[44px] sm:min-w-[80px] active:scale-95"
                >
                    <Send className="w-4 h-4" />
                    <span className="hidden sm:inline">Send</span>
                </button>
            </form>
        </div>
    );
}