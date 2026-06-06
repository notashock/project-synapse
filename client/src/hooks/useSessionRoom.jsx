import { useEffect, useState, useRef, useContext, useCallback } from 'react';
import SockJS from 'sockjs-client';
import Stomp from 'stompjs';
import toast from 'react-hot-toast';
import api from '../services/api';
import { AuthContext } from '../context/AuthContext';
import * as db from '../services/db';

export const useSessionRoom = (sessionId, navigate, isLocal, trainerUsername) => {
    const { user, guestUsername } = useContext(AuthContext);
    const currentUser = user?.username || guestUsername;

    // Data States
    const [notifications, setNotifications] = useState([]);
    const [chatMessages, setChatMessages] = useState([]);
    const [sharedFiles, setSharedFiles] = useState([]);
    
    // Status & Loading States
    const [isConnected, setIsConnected] = useState(false);
    const [isLeaving, setIsLeaving] = useState(false);
    
    // Detailed Progress States
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [incomingTransfers, setIncomingTransfers] = useState({}); 

    // Refs
    const chatEndRef = useRef(null);
    const stompClientRef = useRef(null);
    const webrtcManagerRef = useRef(null);
    const [connectionType, setConnectionType] = useState(isLocal ? 'webrtc' : 'server');
    const activeUploadsRef = useRef({}); // Stores fileId -> { file, aborted, reader }

    // Helper to stream chunks starting from specific index (enables resume/concurrency)
    const streamFileFromChunk = useCallback((fileId, startChunkIndex) => {
        const uploadObj = activeUploadsRef.current[fileId];
        if (!uploadObj) return;

        uploadObj.aborted = true;
        if (uploadObj.reader) {
            try { uploadObj.reader.abort(); } catch { /* ignore */ }
        }

        const { file } = uploadObj;
        const CHUNK_SIZE = 1048576; // 1MB chunks
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        
        uploadObj.aborted = false;
        const reader = new FileReader();
        uploadObj.reader = reader;

        let chunkIndex = startChunkIndex;
        let offset = chunkIndex * CHUNK_SIZE;

        reader.onload = function(event) {
            if (uploadObj.aborted) return;

            const dataUrl = event.target.result;
            const base64Data = dataUrl.split(',')[1];

            if (connectionType === 'webrtc' && webrtcManagerRef.current) {
                webrtcManagerRef.current.sendData({
                    streamData: true,
                    type: 'CHUNK',
                    fileId, chunkIndex, data: base64Data, fileName: '', fileType: '', fileSize: file.size, sender: currentUser, totalChunks
                });
            } else if (stompClientRef.current && stompClientRef.current.connected) {
                stompClientRef.current.send(`/app/session/${sessionId}/stream`, {}, JSON.stringify({
                    type: 'CHUNK',
                    fileId,
                    chunkIndex,
                    data: base64Data,
                    fileName: '',
                    fileType: '',
                    fileSize: file.size,
                    sender: currentUser,
                    totalChunks: totalChunks
                }));
            }

            offset += CHUNK_SIZE;
            chunkIndex++;

            setUploadProgress(Math.round((chunkIndex / totalChunks) * 100));

            if (offset < file.size) {
                if (!uploadObj.aborted) {
                    // Yield execution to the main thread / browser event loop to keep UI smooth
                    setTimeout(readNextChunk, 10);
                }
            } else {
                if (connectionType === 'webrtc' && webrtcManagerRef.current) {
                    webrtcManagerRef.current.sendData({
                        streamData: true,
                        type: 'END',
                        fileId, chunkIndex: 0, data: '', fileName: '', fileType: '', fileSize: file.size, sender: currentUser, totalChunks
                    });
                } else if (stompClientRef.current && stompClientRef.current.connected) {
                    stompClientRef.current.send(`/app/session/${sessionId}/stream`, {}, JSON.stringify({
                        type: 'END',
                        fileId,
                        chunkIndex: 0,
                        data: '',
                        fileName: '',
                        fileType: '',
                        fileSize: file.size,
                        sender: currentUser,
                        totalChunks: totalChunks
                    }));
                }
                toast.success(`File shared completely!`);
                setIsUploading(false);
                setUploadProgress(0);
            }
        };

        reader.onerror = function() {
            if (!uploadObj.aborted) {
                toast.error("Error reading file.");
                setIsUploading(false);
                setUploadProgress(0);
            }
        };

        const readNextChunk = () => {
            if (uploadObj.aborted) return;
            reader.readAsDataURL(file.slice(offset, offset + CHUNK_SIZE));
        };

        readNextChunk();
    }, [sessionId, currentUser, connectionType]);

    // Restore completed files from DB and request missing files from server sync
    const syncFilesWithServer = useCallback(async (stompClient) => {
        try {
            // 1. Fetch truth from server
            const res = await api.get(`/sessions/${sessionId}/files`);
            const serverFiles = res.data; // Array of SharedFile metadata
            
            // 2. Load completed blobs from local IndexedDB
            const loadedSharedFiles = [];
            
            for (const serverFile of serverFiles) {
                const localMetadata = await db.getFileMetadata(serverFile.fileId);
                const localBlobInfo = await db.getFileBlob(serverFile.fileId);
                
                if (localBlobInfo && localBlobInfo.blob) {
                    // We already have the complete file locally
                    const fileUrl = URL.createObjectURL(localBlobInfo.blob);
                    loadedSharedFiles.push({ ...serverFile, url: fileUrl });
                } else if (serverFile.sender !== currentUser) {
                    // We don't have it, and we didn't send it. We need to request it.
                    // Check if we have partial chunks
                    let nextExpectedIndex = 0;
                    if (localMetadata) {
                        const existingChunks = await db.getAllFileChunks(serverFile.fileId);
                        while (existingChunks.find(c => c.chunkIndex === nextExpectedIndex)) {
                            nextExpectedIndex++;
                        }
                    } else {
                        // Initialize metadata in DB for tracking progress
                        await db.saveFileMetadata({ ...serverFile, status: 'downloading' });
                    }

                    // Set initial progress in UI
                    setIncomingTransfers(prev => ({
                        ...prev, 
                        [serverFile.fileId]: { 
                            ...serverFile, 
                            progress: Math.round((nextExpectedIndex / serverFile.totalChunks) * 100) 
                        }
                    }));

                    toast(`Syncing missing file: ${serverFile.fileName}...`);
                    
                    if (connectionType === 'webrtc' && webrtcManagerRef.current) {
                        webrtcManagerRef.current.sendData({
                            streamData: true,
                            type: 'RESUME_REQUEST', fileId: serverFile.fileId, chunkIndex: nextExpectedIndex, sender: currentUser,
                            fileName: serverFile.fileName || '', fileType: serverFile.fileType || '', fileSize: serverFile.fileSize || 0, totalChunks: serverFile.totalChunks || 0, data: ''
                        });
                    } else if (stompClient && stompClient.connected) {
                        stompClient.send(`/app/session/${sessionId}/stream`, {}, JSON.stringify({
                            type: 'RESUME_REQUEST',
                            fileId: serverFile.fileId,
                            chunkIndex: nextExpectedIndex,
                            sender: currentUser,
                            fileName: serverFile.fileName || '',
                            fileType: serverFile.fileType || '',
                            fileSize: serverFile.fileSize || 0,
                            totalChunks: serverFile.totalChunks || 0,
                            data: ''
                        }));
                    }
                }
            }
            
            setSharedFiles(loadedSharedFiles);
            
        } catch (err) {
            console.error("Failed to sync session files:", err);
            toast.error("Failed to sync files with server.");
        }
    }, [sessionId, currentUser, connectionType]);

    useEffect(() => {
        if (!currentUser) return;

        let isMounted = true;
        let socket = null;
        let stompClient = null;
        let reconnectTimeout = null;

        const base = import.meta.env.VITE_API_BASE_URL || 'http://192.168.1.12:8080';
        const wsUrl = base.endsWith('/') ? `${base}ws-placement` : `${base}/ws-placement`;
        
        const connect = () => {
            if (!isMounted) return;
            
            socket = new SockJS(wsUrl);
            stompClient = Stomp.over(socket);
            stompClient.debug = null; 
            stompClientRef.current = stompClient;

            stompClient.connect({}, 
                () => {
                    if (!isMounted) {
                        stompClient.disconnect();
                        return;
                    }
                    setIsConnected(true);

                    // Sync files once connected
                    syncFilesWithServer(stompClient);

                    // Extract chunk handler for reuse in WebRTC
                    const handleIncomingFileChunk = async (data) => {
                        if (data.type === 'RESUME_REQUEST') {
                            let uploadObj = activeUploadsRef.current[data.fileId];
                            if (!uploadObj) {
                                // Reconstruct File reference from local IndexedDB if we are the sender
                                const localMetadata = await db.getFileMetadata(data.fileId);
                                const localBlobInfo = await db.getFileBlob(data.fileId);
                                if (localMetadata && localBlobInfo && localBlobInfo.blob && localMetadata.sender === currentUser) {
                                    activeUploadsRef.current[data.fileId] = {
                                        file: new File([localBlobInfo.blob], localMetadata.fileName, { type: localMetadata.fileType }),
                                        aborted: false,
                                        reader: null
                                    };
                                    uploadObj = activeUploadsRef.current[data.fileId];
                                }
                            }

                            if (uploadObj) {
                                toast(`Resuming "${uploadObj.file.name || 'file'}" transfer from chunk ${data.chunkIndex}...`);
                                streamFileFromChunk(data.fileId, data.chunkIndex);
                            }
                            return;
                        }

                        if (data.sender === currentUser) return;

                        // Avoid processing stream chunks if we already completed this file
                        const localMetadata = await db.getFileMetadata(data.fileId);
                        if (localMetadata && localMetadata.status === 'completed') {
                            return;
                        }

                        if (data.type === 'START') {
                            // Initialize local DB tracking
                            await db.saveFileMetadata({ ...data, status: 'downloading' });
                            toast(`Incoming file: ${data.fileName}`);
                            setIncomingTransfers(prev => ({
                                ...prev, [data.fileId]: { ...data, progress: 0 }
                            }));
                        } 
                        else if (data.type === 'CHUNK') {
                            const binaryStr = window.atob(data.data);
                            const bytes = new Uint8Array(binaryStr.length);
                            for (let i = 0; i < binaryStr.length; i++) {
                                bytes[i] = binaryStr.charCodeAt(i);
                            }
                            
                            await db.saveFileChunk(data.fileId, data.chunkIndex, bytes);
                            
                            setIncomingTransfers(prev => {
                                const currentFile = prev[data.fileId] || {
                                    fileId: data.fileId,
                                    fileName: data.fileName || 'Incoming File',
                                    fileSize: data.fileSize || 0,
                                    sender: data.sender,
                                    totalChunks: data.totalChunks || 1
                                };
                                
                                const total = currentFile.totalChunks || data.totalChunks || 1;
                                const progress = Math.min(100, Math.round(((data.chunkIndex + 1) / total) * 100));
                                
                                return {
                                    ...prev,
                                    [data.fileId]: { 
                                        ...currentFile, 
                                        progress 
                                    }
                                };
                            });
                        } 
                        else if (data.type === 'END') {
                            const metadata = await db.getFileMetadata(data.fileId);
                            if (metadata) {
                                try {
                                    const allChunks = await db.getAllFileChunks(data.fileId);
                                    const blobParts = allChunks.map(c => c.data);
                                    const blob = new Blob(blobParts, { type: metadata.fileType });
                                    
                                    await db.saveFileBlob(data.fileId, blob);
                                    await db.saveFileMetadata({ ...metadata, status: 'completed' });
                                    
                                    const fileUrl = URL.createObjectURL(blob);
                                    setSharedFiles((prev) => {
                                        if (prev.some(f => f.fileId === metadata.fileId)) return prev;
                                        return [...prev, { ...metadata, url: fileUrl }];
                                    });
                                    toast.success(`Ready: ${metadata.fileName}`);
                                } catch (e) {
                                    console.error("Assembly error", e);
                                    toast.error(`Transfer of ${metadata.fileName} was corrupted.`);
                                } finally {
                                    setIncomingTransfers(prev => {
                                        const newState = { ...prev };
                                        delete newState[data.fileId];
                                        return newState;
                                    });
                                }
                            }
                        }
                    };

                    // 1. Presence Listener
                    stompClient.subscribe(`/topic/session/${sessionId}/presence`, (message) => {
                        const payload = message.body;
                        if (payload === "SESSION_TERMINATED") {
                            toast.error("Session ended by trainer.", { duration: 5000 });
                            navigate('/dashboard'); 
                        } else {
                            setNotifications((prev) => [...prev, payload]);
                        }
                    });

                    // 2. Chat Listener
                    stompClient.subscribe(`/topic/session/${sessionId}/chat`, (message) => {
                        setChatMessages((prev) => [...prev, JSON.parse(message.body)]);
                    });

                    // 3. File Relay Listener
                    stompClient.subscribe(`/topic/session/${sessionId}/file-stream`, async (message) => {
                        handleIncomingFileChunk(JSON.parse(message.body));
                    });

                    // 4. Initialize WebRTC if local
                    if (isLocal) {
                        import('../services/webrtc').then(({ WebRTCManager }) => {
                            const isHost = currentUser === trainerUsername;
                            webrtcManagerRef.current = new WebRTCManager(sessionId, currentUser, isHost, stompClient, {
                                onMessage: (parsed) => setChatMessages(prev => [...prev, parsed]),
                                onFileChunk: (parsed) => handleIncomingFileChunk(parsed),
                                onFallbackRequired: () => {
                                    if (connectionType !== 'server') {
                                        setConnectionType('server');
                                        toast.error('Local network unstable. Switched to secure server relay.', { duration: 5000 });
                                    }
                                }
                            });
                        });
                    }
                },
                () => {
                    setIsConnected(false);
                    if (isMounted) {
                        toast.error("WebSocket connection lost. Retrying in 5 seconds...");
                        reconnectTimeout = setTimeout(connect, 5000);
                    }
                }
            );
        };

        connect();

        const handleUnload = () => { 
            const token = localStorage.getItem('token');
            const apiUrl = base.endsWith('/') ? `${base}api` : `${base}/api`;
            fetch(`${apiUrl}/sessions/leave/${sessionId}`, {
                method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, keepalive: true 
            }).catch(() => {});
        };
        window.addEventListener('beforeunload', handleUnload);

        return () => {
            isMounted = false;
            window.removeEventListener('beforeunload', handleUnload);
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            if (webrtcManagerRef.current) {
                webrtcManagerRef.current.disconnect();
            }
            if (stompClientRef.current) {
                if (stompClientRef.current.connected) stompClientRef.current.disconnect();
                else socket.close(); 
            }
            if (!isLeaving) api.post(`/sessions/leave/${sessionId}`).catch(() => {});
        };
    }, [sessionId, navigate, isLeaving, currentUser, streamFileFromChunk, syncFilesWithServer, isLocal, trainerUsername, connectionType]);

    const handleLeaveSession = useCallback(async () => {
        if (isLeaving) return;
        setIsLeaving(true);
        toast('Disconnecting and cleaning up...');
        try { 
            await api.post(`/sessions/leave/${sessionId}`); 
            // Cleanup indexedDB to save user space
            await db.clearSessionFiles();
        } 
        catch { /* ignore */ } finally { navigate('/dashboard'); }
    }, [isLeaving, sessionId, navigate]);

    const handleSendMessage = (messageText) => {
        if (!messageText.trim() || !isConnected) return;
        
        const payload = {
            sender: currentUser,
            content: messageText
        };

        if (connectionType === 'webrtc' && webrtcManagerRef.current) {
            webrtcManagerRef.current.sendData(payload);
            setChatMessages((prev) => [...prev, payload]);
        } else if (stompClientRef.current && stompClientRef.current.connected) {
            stompClientRef.current.send(`/app/session/${sessionId}/chat.send`, {}, JSON.stringify(payload));
        }
    };

    const handleFileUpload = async (file) => {
        if (!file || !stompClientRef.current || isUploading) return;
        
        setIsUploading(true);
        setUploadProgress(0); 
        
        const fileId = Math.random().toString(36).substring(7);
        const CHUNK_SIZE = 1048576; // 1MB chunks
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        const metadata = { fileId, fileName: file.name, fileType: file.type, fileSize: file.size, sender: currentUser, totalChunks };

        // Save immediately to DB as completed since we are the sender
        await db.saveFileMetadata({ ...metadata, status: 'completed' });
        await db.saveFileBlob(fileId, file);

        activeUploadsRef.current[fileId] = { file, aborted: false, reader: null };

        // Broadcast START event
        if (connectionType === 'webrtc' && webrtcManagerRef.current) {
            webrtcManagerRef.current.sendData({ streamData: true, type: 'START', ...metadata });
        } else if (stompClientRef.current && stompClientRef.current.connected) {
            stompClientRef.current.send(`/app/session/${sessionId}/stream`, {}, JSON.stringify({ type: 'START', ...metadata }));
        }

        const fileUrl = URL.createObjectURL(file);
        setSharedFiles((prev) => {
            if (prev.some(f => f.fileId === metadata.fileId)) return prev;
            return [...prev, { ...metadata, url: fileUrl }];
        });

        streamFileFromChunk(fileId, 0);
    };

    return {
        user, isConnected, isLeaving, 
        notifications, chatMessages, sharedFiles, incomingTransfers,
        isUploading, uploadProgress, chatEndRef,
        handleSendMessage, handleFileUpload, handleLeaveSession
    };
};
