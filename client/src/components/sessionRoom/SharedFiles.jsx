export default function SharedFiles({ sessionData }) {
    const { 
        user, isConnected, sharedFiles, incomingTransfers, 
        isUploading, uploadProgress, handleFileUpload 
    } = sessionData;

    const onFileChange = (e) => {
        if (e.target.files[0]) handleFileUpload(e.target.files[0]);
        e.target.value = null; 
    };

    return (
        <div className="flex-1 lg:w-1/2 bg-gray-800 rounded-lg p-3 sm:p-4 border border-gray-700 flex flex-col shadow-inner min-h-0">
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-700 shrink-0">
                <h2 className="text-xs sm:text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                    <span className="text-blue-400">📁</span> Shared Files
                </h2>
                
                {isUploading ? (
                    <div className="relative overflow-hidden w-24 sm:w-32 h-6 sm:h-8 rounded bg-gray-700 border border-gray-600 flex items-center justify-center">
                        <div 
                            className="absolute left-0 top-0 bottom-0 bg-blue-600 transition-all duration-200 ease-out" 
                            style={{ width: `${uploadProgress}%` }}
                        />
                        <span className="relative z-10 text-[10px] sm:text-xs text-white font-bold drop-shadow-md">
                            Uploading {uploadProgress}%
                        </span>
                    </div>
                ) : (
                    <label className={`px-2 sm:px-4 py-1 sm:py-1.5 rounded text-[10px] sm:text-xs font-bold transition flex items-center gap-1 sm:gap-2 ${
                        !isConnected 
                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
                        : 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer shadow-lg'
                    }`}>
                        Share File
                        <input type="file" className="hidden" onChange={onFileChange} disabled={!isConnected} />
                    </label>
                )}
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {sharedFiles.length === 0 && Object.keys(incomingTransfers).length === 0 ? (
                    <div className="h-full flex items-center justify-center"><p className="text-gray-500 text-xs italic">No files shared yet.</p></div>
                ) : (
                    <>
                        {Object.values(incomingTransfers).map((file) => (
                            <div key={file.fileId} className="flex justify-between items-center bg-gray-700/50 px-3 py-2.5 rounded border border-blue-500/30">
                                <div className="flex items-center gap-3 overflow-hidden w-full">
                                    <span className="text-xl animate-bounce">⬇️</span>
                                    <div className="truncate flex-1">
                                        <p className="text-xs sm:text-sm font-bold text-gray-200 truncate">{file.fileName}</p>
                                        <p className="text-[9px] sm:text-[10px] text-gray-400 font-semibold mt-0.5">
                                            Incoming from <span className="text-blue-300">@{file.sender}</span>
                                        </p>
                                    </div>
                                    <div className="w-16 sm:w-24 bg-gray-800 h-3 sm:h-4 rounded overflow-hidden ml-2 border border-gray-600 shrink-0 relative flex justify-center items-center">
                                        <div className="absolute left-0 top-0 bottom-0 bg-blue-500 transition-all duration-200" style={{ width: `${file.progress}%` }}></div>
                                        <span className="text-[8px] sm:text-[9px] relative z-10 font-bold drop-shadow-md">{file.progress}%</span>
                                    </div>
                                </div>
                            </div>
                        ))}

                        {sharedFiles.map((file, index) => {
                            const isSender = file.sender === user?.username;
                            return (
                                <div key={index} className="flex justify-between items-center bg-gray-700/50 px-3 py-2.5 rounded">
                                    <div className="flex items-center gap-3 overflow-hidden w-full">
                                        <span className="text-xl">📄</span>
                                        <div className="truncate flex-1">
                                            <p className="text-xs sm:text-sm font-bold text-gray-200 truncate">{file.fileName}</p>
                                            <p className="text-[9px] sm:text-[10px] text-gray-400 font-semibold mt-0.5">
                                                {isSender ? <span className="text-green-400">Sent by you</span> : <>From <span className="text-blue-300">@{file.sender}</span></>}
                                                <span className="mx-1.5 text-gray-500">•</span> 
                                                {(file.fileSize / 1024).toFixed(1)} KB
                                            </p>
                                        </div>
                                        {isSender ? (
                                            <span className="text-[9px] sm:text-[10px] font-bold text-gray-500 uppercase tracking-wider px-2 sm:px-3 py-1 ml-2 shrink-0 border border-gray-600 rounded bg-gray-800">Your File</span>
                                        ) : (
                                            <a href={file.url} download={file.fileName} className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 sm:px-3 sm:py-1.5 rounded text-[10px] sm:text-xs font-bold transition shrink-0 ml-2 shadow">Download</a>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </>
                )}
            </div>
        </div>
    );
}