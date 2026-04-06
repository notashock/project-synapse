import { useState, useEffect } from 'react';

export default function LiveChat({ sessionData }) {
    const { user, isConnected, chatMessages, isLeaving, chatEndRef, handleSendMessage } = sessionData;
    const [text, setText] = useState('');

    const onSubmit = (e) => {
        e.preventDefault();
        handleSendMessage(text);
        setText('');
    };

    useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages, chatEndRef]);

    return (
        <div className="flex-1 lg:w-1/2 bg-gray-800 rounded-lg p-3 sm:p-4 border border-gray-700 flex flex-col shadow-inner min-h-0">
            <div className="mb-3 pb-2 border-b border-gray-700 shrink-0">
                <h2 className="text-xs sm:text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                    <span className="text-blue-400">💬</span> Live Chat
                </h2>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                {chatMessages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center opacity-50">
                        <p className="text-xs sm:text-sm text-gray-400 font-semibold">Session chat is empty. Say hello!</p>
                    </div>
                ) : (
                    chatMessages.map((msg, index) => {
                        const isMe = msg.message === user?.username;
                        return (
                            <div key={index} className={`flex flex-col w-full ${isMe ? 'items-end' : 'items-start'}`}>
                                <span className={`text-[9px] sm:text-[10px] uppercase font-bold mb-0.5 px-1 ${isMe ? 'text-blue-400' : 'text-gray-400'}`}>
                                    {isMe ? 'You' : `@${msg.message}`}
                                </span>
                                <div className={`px-3 sm:px-4 py-2 rounded-2xl max-w-[85%] sm:max-w-[75%] shadow-md text-xs sm:text-sm break-words ${
                                    isMe ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-gray-700 text-gray-100 rounded-tl-none'
                                }`}>
                                    {msg.content}
                                </div>
                            </div>
                        );
                    })
                )}
                <div ref={chatEndRef} />
            </div>

            <form onSubmit={onSubmit} className="flex gap-2 sm:gap-3 shrink-0 pt-3 mt-2 border-t border-gray-700">
                <input
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={isConnected ? "Type a message..." : "Connecting..."}
                    className="flex-1 bg-gray-900 text-white rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-600 focus:outline-none focus:border-blue-500 disabled:opacity-50 text-xs sm:text-sm"
                    autoComplete="off"
                    disabled={!isConnected || isLeaving}
                />
                <button 
                    type="submit"
                    disabled={!text.trim() || !isConnected || isLeaving}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:text-gray-400 text-white px-4 py-2 sm:py-2.5 rounded-lg font-bold transition flex justify-center items-center text-xs sm:text-sm min-w-[60px] sm:min-w-[80px]"
                >
                    Send
                </button>
            </form>
        </div>
    );
}