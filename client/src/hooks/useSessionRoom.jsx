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

    useEffect(() => {
        if (!user?.username) return;

        let isMounted = true;
        const base = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';
        const wsUrl = base.endsWith('/') ? `${base}ws-placement` : `${base}/ws-placement`;
        
        const socket = new SockJS(wsUrl);
        const stompClient = Stomp.over(socket);
        stompClient.debug = null; 
        stompClientRef.current = stompClient;

        stompClient.connect({}, () => {
            if (!isMounted) return stompClient.disconnect();
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
                // Safety check: Backend interceptor should block this, but we double-check
                if (data.sender === user?.username) return;

                if (data.type === 'START') {
                    incomingFilesRef.current[data.fileId] = { metadata: data, chunks: [] };
                    toast(`Incoming file: ${data.fileName}`, { icon: '⬇️' });
                    setIncomingTransfers(prev => ({
                        ...prev, [data.fileId]: { ...data, progress: 0 }
                    }));
                } 
                else if (data.type === 'CHUNK') {
                    if (incomingFilesRef.current[data.fileId]) {
                        incomingFilesRef.current[data.fileId].chunks[data.chunkIndex] = data.data;
                        const total = incomingFilesRef.current[data.fileId].metadata.totalChunks;
                        setIncomingTransfers(prev => {
                            if (!prev[data.fileId]) return prev;
                            return {
                                ...prev,
                                [data.fileId]: { ...prev[data.fileId], progress: Math.round((data.chunkIndex / total) * 100) }
                            };
                        });
                    }
                } 
                else if (data.type === 'END') {
                    const fileData = incomingFilesRef.current[data.fileId];
                    if (fileData) {
                        try {
                            const base64String = fileData.chunks.join('');
                            const byteCharacters = atob(base64String);
                            const byteNumbers = new Array(byteCharacters.length);
                            for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
                            const byteArray = new Uint8Array(byteNumbers);
                            const blob = new Blob([byteArray], { type: fileData.metadata.fileType });
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
        });

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
        // Ultra-fast WebSocket Chat Routing
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

        stompClientRef.current.send(`/app/session/${sessionId}/stream`, {}, JSON.stringify({ type: 'START', ...metadata }));

        let offset = 0; let chunkIndex = 0;
        const reader = new FileReader();

        reader.onload = function(event) {
            const bytes = new Uint8Array(event.target.result);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
            
            stompClientRef.current.send(`/app/session/${sessionId}/stream`, {}, JSON.stringify({
                type: 'CHUNK', fileId, chunkIndex, data: window.btoa(binary)
            }));
            
            offset += CHUNK_SIZE; chunkIndex++;
            setUploadProgress(Math.round((chunkIndex / totalChunks) * 100));

            if (offset < file.size) {
                readNextChunk();
            } else {
                stompClientRef.current.send(`/app/session/${sessionId}/stream`, {}, JSON.stringify({ type: 'END', fileId }));
                
                // Add file to local UI instantly since the backend blocks the echo broadcast
                const fileUrl = URL.createObjectURL(file);
                setSharedFiles((prev) => [...prev, { ...metadata, url: fileUrl }]);
                
                toast.success("File shared successfully!");
                setIsUploading(false); setUploadProgress(0);
            }
        };
        
        reader.onerror = function() { 
            toast.error("Error reading file."); 
            setIsUploading(false); setUploadProgress(0);
        };
        
        const readNextChunk = () => reader.readAsArrayBuffer(file.slice(offset, offset + CHUNK_SIZE));
        readNextChunk();
    };

    return {
        user, isConnected, isLeaving, 
        notifications, chatMessages, sharedFiles, incomingTransfers,
        isUploading, uploadProgress, chatEndRef,
        handleSendMessage, handleFileUpload, handleLeaveSession
    };
};