import { FolderOpen, ArrowDownToLine, FileText, Upload, Download } from 'lucide-react';

const formatFileSize = (bytes) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

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
        <div className="flex-1 lg:w-1/2 bg-gray-800/60 backdrop-blur-sm rounded-xl p-3 sm:p-4 border border-white/10 flex flex-col shadow-inner min-h-0">
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-white/10 shrink-0">
                <h2 className="text-xs sm:text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-blue-400" /> Shared Files
                </h2>
                
                {isUploading ? (
                    <div className="relative overflow-hidden w-28 sm:w-36 h-7 sm:h-8 rounded-lg bg-gray-700 border border-gray-600 flex items-center justify-center">
                        <div 
                            className="absolute left-0 top-0 bottom-0 bg-linear-to-r from-blue-600 to-indigo-500 transition-all duration-500 ease-out" 
                            style={{ width: `${uploadProgress}%` }}
                        />
                        <span className="relative z-10 text-[10px] sm:text-xs text-white font-bold drop-shadow-md">
                            Uploading {uploadProgress}%
                        </span>
                    </div>
                ) : (
                    <label className={`px-3 sm:px-4 py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition flex items-center gap-1.5 ${
                        !isConnected 
                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
                        : 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer shadow-lg shadow-blue-600/20 active:scale-95'
                    }`}>
                        <Upload className="w-3.5 h-3.5" />
                        Share File
                        <input type="file" className="hidden" onChange={onFileChange} disabled={!isConnected} />
                    </label>
                )}
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {sharedFiles.length === 0 && Object.keys(incomingTransfers).length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center opacity-50 gap-2">
                        <FolderOpen className="w-8 h-8 text-gray-600" />
                        <p className="text-gray-500 text-xs font-medium">No files shared yet.</p>
                    </div>
                ) : (
                    <>
                        {Object.values(incomingTransfers).map((file) => (
                            <div key={file.fileId} className="flex items-center bg-blue-500/5 px-3 py-2.5 rounded-lg border border-blue-500/20 gap-3">
                                <ArrowDownToLine className="w-5 h-5 text-blue-400 animate-icon-pulse shrink-0" />
                                <div className="truncate flex-1 min-w-0">
                                    <p className="text-xs sm:text-sm font-bold text-gray-200 truncate">{file.fileName}</p>
                                    <p className="text-[9px] sm:text-[10px] text-gray-400 font-semibold mt-0.5">
                                        Incoming from <span className="text-blue-300">@{file.sender}</span>
                                    </p>
                                </div>
                                <div className="w-16 sm:w-24 bg-gray-800 h-3.5 sm:h-4 rounded-full overflow-hidden border border-gray-600 shrink-0 relative flex justify-center items-center">
                                    <div className="absolute left-0 top-0 bottom-0 bg-linear-to-r from-blue-500 to-indigo-500 transition-all duration-500 ease-out rounded-full" style={{ width: `${file.progress}%` }}></div>
                                    <span className="text-[8px] sm:text-[9px] relative z-10 font-bold drop-shadow-md">{file.progress}%</span>
                                </div>
                            </div>
                        ))}

                        {sharedFiles.map((file, index) => {
                            const isSender = file.sender === user?.username;
                            return (
                                <div key={index} className="flex items-center bg-gray-700/40 px-3 py-2.5 rounded-lg border border-white/5 hover:border-white/10 transition gap-3">
                                    <FileText className="w-5 h-5 text-gray-400 shrink-0" />
                                    <div className="truncate flex-1 min-w-0">
                                        <p className="text-xs sm:text-sm font-bold text-gray-200 truncate">{file.fileName}</p>
                                        <p className="text-[9px] sm:text-[10px] text-gray-400 font-semibold mt-0.5">
                                            {isSender ? <span className="text-emerald-400">Sent by you</span> : <>From <span className="text-blue-300">@{file.sender}</span></>}
                                            <span className="mx-1.5 text-gray-600">•</span> 
                                            {formatFileSize(file.fileSize)}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        {isSender && (
                                            <span className="hidden sm:inline text-[9px] font-bold text-blue-400 uppercase tracking-wider px-2 py-0.5 border border-blue-500/20 rounded-md bg-blue-500/10">You</span>
                                        )}
                                        <a href={file.url} download={file.fileName} className="bg-blue-600 hover:bg-blue-700 text-white p-1.5 sm:px-3 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition shadow-md active:scale-95 flex items-center gap-1.5">
                                            <Download className="w-3.5 h-3.5" />
                                            <span className="hidden sm:inline">Download</span>
                                        </a>
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