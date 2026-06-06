import { useEffect, useState, useRef, useContext } from 'react';
import SockJS from 'sockjs-client';
import Stomp from 'stompjs';
import toast from 'react-hot-toast';
import api from '../services/api';
import { AuthContext } from '../context/AuthContext';

export const useSessionRoom = (sessionId, navigate) => {
    const { user } = useContext(AuthContext);

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
    const incomingFilesRef = useRef({});
    const activeUploadsRef = useRef({}); // Stores fileId -> { file, aborted, reader }

    // Helper to stream chunks starting from specific index (enables resume/concurrency)
    const streamFileFromChunk = (fileId, startChunkIndex) => {
        const uploadObj = activeUploadsRef.current[fileId];
        if (!uploadObj) return;

        // Cancel previous streaming reader if it is active for this file
        uploadObj.aborted = true;
        if (uploadObj.reader) {
            try {
                uploadObj.reader.abort();
            } catch (e) {}
        }

        const { file } = uploadObj;
        const CHUNK_SIZE = 16380;
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        
        // Reset states for this stream run
        uploadObj.aborted = false;
        const reader = new FileReader();
        uploadObj.reader = reader;

        let chunkIndex = startChunkIndex;
        let offset = chunkIndex * CHUNK_SIZE;

        reader.onload = function(event) {
            if (uploadObj.aborted) return;

            const dataUrl = event.target.result;
            const base64Data = dataUrl.split(',')[1];

            if (stompClientRef.current && stompClientRef.current.connected) {
                stompClientRef.current.send(`/app/session/${sessionId}/stream`, {}, JSON.stringify({
                    type: 'CHUNK',
                    fileId,
                    chunkIndex,
                    data: base64Data
                }));
            }

            offset += CHUNK_SIZE;
            chunkIndex++;

            // Update sender progress
            setUploadProgress(Math.round((chunkIndex / totalChunks) * 100));

            if (offset < file.size) {
                if (!uploadObj.aborted) {
                    readNextChunk();
                }
            } else {
                if (stompClientRef.current && stompClientRef.current.connected) {
                    stompClientRef.current.send(`/app/session/${sessionId}/stream`, {}, JSON.stringify({
                        type: 'END',
                        fileId
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
    };

    useEffect(() => {
        if (!user?.username) return;

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
                    stompClient.subscribe(`/topic/session/${sessionId}/file-stream`, (message) => {
                        const data = JSON.parse(message.body);

                        // If it's a resume request and we are the sender, handle it
                        if (data.type === 'RESUME_REQUEST') {
                            if (activeUploadsRef.current[data.fileId]) {
                                toast(`Resuming "${activeUploadsRef.current[data.fileId].file.name}" transfer from chunk ${data.chunkIndex}...`, { icon: '🔄' });
                                streamFileFromChunk(data.fileId, data.chunkIndex);
                            }
                            return;
                        }

                        // Safety check: Backend interceptor should block this, but we double-check
                        if (data.sender === user?.username) return;

                        if (data.type === 'START') {
                            // Only initialize state if we don't already have partial chunks cached
                            if (!incomingFilesRef.current[data.fileId]) {
                                incomingFilesRef.current[data.fileId] = { metadata: data, chunks: [] };
                            }
                            toast(`Incoming file: ${data.fileName}`, { icon: '⬇️' });
                            setIncomingTransfers(prev => ({
                                ...prev, [data.fileId]: { ...data, progress: prev[data.fileId]?.progress || 0 }
                            }));
                        } 
                        else if (data.type === 'CHUNK') {
                            if (incomingFilesRef.current[data.fileId]) {
                                const binaryStr = window.atob(data.data);
                                const bytes = new Uint8Array(binaryStr.length);
                                for (let i = 0; i < binaryStr.length; i++) {
                                    bytes[i] = binaryStr.charCodeAt(i);
                                }
                                incomingFilesRef.current[data.fileId].chunks[data.chunkIndex] = bytes;

                                const total = incomingFilesRef.current[data.fileId].metadata.totalChunks;
                                setIncomingTransfers(prev => {
                                    if (!prev[data.fileId]) return prev;
                                    // Count active loaded chunks to calculate actual progress (deduplicated)
                                    const loadedChunksCount = incomingFilesRef.current[data.fileId].chunks.filter(Boolean).length;
                                    return {
                                        ...prev,
                                        [data.fileId]: { ...prev[data.fileId], progress: Math.round((loadedChunksCount / total) * 100) }
                                    };
                                });
                            }
                        } 
                        else if (data.type === 'END') {
                            const fileData = incomingFilesRef.current[data.fileId];
                            if (fileData) {
                                try {
                                    const blob = new Blob(fileData.chunks, { type: fileData.metadata.fileType });
                                    const fileUrl = URL.createObjectURL(blob);
                                    
                                    setSharedFiles((prev) => [...prev, { ...fileData.metadata, url: fileUrl }]);
                                    toast.success(`Ready: ${fileData.metadata.fileName}`);
                                } catch (e) {
                                    toast.error(`Transfer of ${fileData.metadata.fileName} was corrupted.`);
                                } finally {
                                    delete incomingFilesRef.current[data.fileId];
                                    setIncomingTransfers(prev => {
                                        const newState = { ...prev };
                                        delete newState[data.fileId];
                                        return newState;
                                    });
                                }
                            }
                        }
                    });

                    // Auto-Resume Routine: Request missing chunks for any incomplete downloads
                    Object.keys(incomingFilesRef.current).forEach((fileId) => {
                        const fileData = incomingFilesRef.current[fileId];
                        if (fileData) {
                            let nextExpectedIndex = 0;
                            // Find the first index where chunk is missing
                            while (fileData.chunks[nextExpectedIndex] !== undefined) {
                                nextExpectedIndex++;
                            }
                            
                            stompClient.send(`/app/session/${sessionId}/stream`, {}, JSON.stringify({
                                type: 'RESUME_REQUEST',
                                fileId: fileId,
                                chunkIndex: nextExpectedIndex,
                                sender: user.username // Relayed to sender
                            }));

                            toast(`Reconnected. Resuming "${fileData.metadata.fileName}" from chunk ${nextExpectedIndex}...`, { icon: '🔄' });
                        }
                    });
                },
                (error) => {
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
            if (stompClientRef.current) {
                if (stompClientRef.current.connected) stompClientRef.current.disconnect();
                else socket.close(); 
            }
            if (!isLeaving) api.post(`/sessions/leave/${sessionId}`).catch(() => {});
        };
    }, [sessionId, navigate, isLeaving, user?.username]);

    const handleLeaveSession = async () => {
        if (isLeaving) return;
        setIsLeaving(true);
        toast('Disconnecting...', { icon: '👋' });
        try { await api.post(`/sessions/leave/${sessionId}`); } 
        catch (error) {} finally { navigate('/dashboard'); }
    };

    const handleSendMessage = (messageText) => {
        if (!messageText.trim() || !stompClientRef.current || !isConnected) return;
        
        const payload = {
            sender: user.username,
            content: messageText
        };
        stompClientRef.current.send(`/app/session/${sessionId}/chat.send`, {}, JSON.stringify(payload));
    };

    const handleFileUpload = (file) => {
        if (!file || !stompClientRef.current || isUploading) return;
        
        setIsUploading(true);
        setUploadProgress(0); 
        
        const fileId = Math.random().toString(36).substring(7);
        const CHUNK_SIZE = 16380; 
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        const metadata = { fileId, fileName: file.name, fileType: file.type, fileSize: file.size, sender: user.username, totalChunks };

        // Register in cache
        activeUploadsRef.current[fileId] = { file, aborted: false, reader: null };

        // Broadcast START event
        stompClientRef.current.send(`/app/session/${sessionId}/stream`, {}, JSON.stringify({ type: 'START', ...metadata }));

        // Add file to local UI instantly since the backend blocks the echo broadcast
        const fileUrl = URL.createObjectURL(file);
        setSharedFiles((prev) => [...prev, { ...metadata, url: fileUrl }]);

        // Begin streaming from chunk 0
        streamFileFromChunk(fileId, 0);
    };

    return {
        user, isConnected, isLeaving, 
        notifications, chatMessages, sharedFiles, incomingTransfers,
        isUploading, uploadProgress, chatEndRef,
        handleSendMessage, handleFileUpload, handleLeaveSession
    };
};
