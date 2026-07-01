import { useEffect, useState, useRef, useContext, useCallback } from 'react';
import SockJS from 'sockjs-client';
import Stomp from 'stompjs';
import toast from 'react-hot-toast';
import api from '../services/api';
import { AuthContext } from '../context/AuthContext';
import * as db from '../services/db';
import { WebRTCManager, packBinaryChunk } from '../services/webrtc';

const formatFileSize = (bytes) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

export const useSessionRoom = (sessionId, navigate, isLocal, hostUsername) => {
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
    const [uploadTransfers, setUploadTransfers] = useState({}); // fileId -> { fileName, progress, fileSize }
    const [incomingTransfers, setIncomingTransfers] = useState({});
    const [activePeers, setActivePeers] = useState([]);

    // Refs
    const chatEndRef = useRef(null);
    const stompClientRef = useRef(null);
    const webrtcManagerRef = useRef(null);
    const [connectionType, setConnectionType] = useState(isLocal ? 'webrtc' : 'server');
    const connectionTypeRef = useRef(connectionType);
    const activeUploadsRef = useRef({}); // Stores fileId -> { file, aborted, reader }
    const processedStartEventsRef = useRef(new Set());
    const activeTransfersRef = useRef(new Set());
    const reportedMilestonesRef = useRef({});
    const [connectionError, setConnectionError] = useState(null);
    const activeUploadCountRef = useRef(0);
    const activeDownloadCountRef = useRef(0);
    const uploadQueueRef = useRef([]); // [{ fileId, requester, targetSocketId }]
    const pendingRequestsRef = useRef({});
    const pendingTransfersRef = useRef(new Map()); // WebRTC Path Verification tracking
    const pendingResendsRef = useRef(new Map()); // Phase 5 Jitter Timeouts: fileId_chunkIndex -> timeoutId
    const pendingAssembliesRef = useRef(new Set()); // Phase 5 Post-Recovery Assemblies: fileId
    const pendingMeshSearchesRef = useRef(new Map()); // DAG Recursion tracking: key -> { peersRemaining: Set, originalRequester: string }
    const [transferStatuses, setTransferStatuses] = useState({}); // fileId -> string status
    const processQueueRef = useRef(null);

    const activeUploadKeysRef = useRef(new Set()); // Tracks active/queued uploads: fileId_requester
    const activeDownloadKeysRef = useRef(new Set()); // Tracks active/queued downloads: fileId_currentUser
    const sentStartEventsRef = useRef(new Set()); // Tracks sent START events: fileId_targetUsername
    const pathRetryTimeoutsRef = useRef(new Map()); // Tracks path-verified timeouts: fileId -> timeoutId
    const transferLifecycleRef = useRef(new Map()); // Tracks state: 'queued'|'handshaking'|'path-verifying'|'streaming'|'recovering'
    const sentBusySignalsRef = useRef(new Set()); // Tracks sent busy signals: fileId
    const activeRoutingPathsRef = useRef(new Map()); // transferKey -> routingPath
    const lastReportedIncomingProgressRef = useRef(new Map()); // fileId -> percentage

        const syncInProgressRef = useRef(false);
    const syncRequestedAgainRef = useRef(false);

    const incomingTransfersRef = useRef(incomingTransfers);
    const sharedFilesRef = useRef(sharedFiles);
    
        useEffect(() => { incomingTransfersRef.current = incomingTransfers; }, [incomingTransfers]);
    useEffect(() => { sharedFilesRef.current = sharedFiles; }, [sharedFiles]);

    const isLocalRef = useRef(isLocal);
    const hostUsernameRef = useRef(hostUsername);
    const navigateRef = useRef(navigate);
    const isLeavingRef = useRef(isLeaving);
    const guestUsernameRef = useRef(guestUsername);
    const currentUserRef = useRef(currentUser);
    
    useEffect(() => { isLocalRef.current = isLocal; }, [isLocal]);
    useEffect(() => { hostUsernameRef.current = hostUsername; }, [hostUsername]);
    useEffect(() => { navigateRef.current = navigate; }, [navigate]);
    useEffect(() => { isLeavingRef.current = isLeaving; }, [isLeaving]);
    useEffect(() => { guestUsernameRef.current = guestUsername; }, [guestUsername]);
    useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);

    const activeActivityStartEventsRef = useRef(new Set()); // Tracks sent transfer-activity START events by fileId

    const cleanupUploadState = useCallback((fileId, requester) => {
        if (!fileId || !requester) return;
        const transferKey = `${fileId}_${requester}`;
        console.log(`[RTC_TRACE] Centralized upload cleanup triggered for key: ${transferKey}`);
        
        activeUploadKeysRef.current.delete(transferKey);
        sentStartEventsRef.current.delete(transferKey);
        transferLifecycleRef.current.delete(transferKey);
        pendingTransfersRef.current.delete(fileId);
        activeRoutingPathsRef.current.delete(transferKey);
        
        const pathTimeout = pathRetryTimeoutsRef.current.get(fileId);
        if (pathTimeout) {
            clearTimeout(pathTimeout);
            pathRetryTimeoutsRef.current.delete(fileId);
        }
        
        // Find and abort any active uploads for this key
        let hasRemaining = false;
        for (const key of activeUploadKeysRef.current) {
            if (key !== transferKey && key.startsWith(`${fileId}_`)) {
                hasRemaining = true;
                break;
            }
        }
        const hasQueued = uploadQueueRef.current.some(q => q.fileId === fileId);

        const uploadKeys = [`${fileId}_${requester}`];
        if (!hasRemaining && !hasQueued) {
            uploadKeys.push(fileId);
        }

        uploadKeys.forEach(k => {
            const uploadObj = activeUploadsRef.current[k];
            if (uploadObj) {
                uploadObj.aborted = true;
                if (uploadObj.reader) {
                    try { uploadObj.reader.abort(); } catch {}
                }
                delete activeUploadsRef.current[k];
            }
        });

        // Delete from activeActivityStartEventsRef if no active upload keys remain for this fileId
        let hasActiveUploads = false;
        activeUploadKeysRef.current.forEach((val, key) => {
            if (key.startsWith(`${fileId}_`)) {
                hasActiveUploads = true;
            }
        });
        if (!hasActiveUploads) {
            activeActivityStartEventsRef.current.delete(fileId);
            console.log(`[RTC_TRACE] Cleared activeActivityStartEventsRef for fileId: ${fileId}`);
        }
        
        activeUploadCountRef.current = 0;
        if (processQueueRef.current) processQueueRef.current();

        if (webrtcManagerRef.current) {
            webrtcManagerRef.current.processDeferredRemovals();
        }
    }, []);

    const cleanupDownloadState = useCallback((fileId) => {
        if (!fileId) return;
        const downloadKey = `${fileId}_${currentUser}`;
        console.log(`[RTC_TRACE] Centralized download cleanup triggered for key: ${downloadKey}`);
        
        activeDownloadKeysRef.current.delete(downloadKey);
        transferLifecycleRef.current.delete(downloadKey);
        sentBusySignalsRef.current.delete(fileId);
        activeRoutingPathsRef.current.delete(downloadKey);
        
        setIncomingTransfers(prev => {
            const next = { ...prev };
            delete next[fileId];
            if (Object.keys(next).length === 0) {
                clearTimeout(window.__synapse_transfer_completion_timeout);
                window.__synapse_transfer_completion_timeout = setTimeout(() => {
                    toast.success("All pending files received successfully!");
                    if (stompClientRef.current && stompClientRef.current.connected) {
                        stompClientRef.current.send(`/topic/session/${sessionId}/transfer-activity`, {}, JSON.stringify({
                            type: 'CONFIRM_ALL_RECEIVED',
                            receiver: currentUser
                        }));
                    }
                }, 0);
            }
            return next;
        });
        
        pendingAssembliesRef.current.delete(fileId);
        lastReportedIncomingProgressRef.current.delete(fileId);
        
        // Clear any pending resend timeout for this fileId
        pendingResendsRef.current.forEach((timeoutId, key) => {
            if (key.startsWith(`${fileId}_`)) {
                clearTimeout(timeoutId);
                pendingResendsRef.current.delete(key);
            }
        });
        
        activeDownloadCountRef.current = 0;

        if (webrtcManagerRef.current) {
            webrtcManagerRef.current.processDeferredRemovals();
        }
    }, [currentUser, sessionId]);

    const initiateTransferRequest = useCallback(async (requests) => {
        const validRequests = [];
        for (const req of requests) {
            const transferKey = `${req.fileId}_${currentUser}`;
            const currentState = transferLifecycleRef.current.get(transferKey);

            if (currentState && ['queued', 'handshaking', 'path-verifying', 'streaming', 'recovering'].includes(currentState)) {
                console.log(`[RTC_TRACE] initiateTransferRequest: Request for ${transferKey} suppressed (current state: ${currentState})`);
                continue;
            }

            transferLifecycleRef.current.set(transferKey, 'handshaking');
            activeDownloadKeysRef.current.add(transferKey);

            // Find contiguous chunks to determine where to resume
            let startChunkIndex = req.startChunkIndex;
            if (startChunkIndex === undefined) {
                startChunkIndex = 0;
                const fileMeta = await db.getFileMetadata(req.fileId);
                if (fileMeta && fileMeta.totalChunks) {
                    for (let i = 0; i < fileMeta.totalChunks; i++) {
                        const chunk = await db.getFileChunk(req.fileId, i);
                        if (chunk && chunk.data) {
                            startChunkIndex = i + 1;
                        } else {
                            break;
                        }
                    }
                }
            }

            validRequests.push({
                ...req,
                startChunkIndex
            });
        }

        if (validRequests.length > 0 && stompClientRef.current && stompClientRef.current.connected) {
            console.log("[RTC_TRACE] Sending centralized TRANSFER_REQUEST via stomp client:", {
                requests: validRequests,
                requester: guestUsername || currentUser
            });
            stompClientRef.current.send(`/app/session/${sessionId}/transfer-request`, {}, JSON.stringify({
                requests: validRequests,
                requester: guestUsername || currentUser
            }));
        }
    }, [currentUser, sessionId, guestUsername]);

        const transitionToRecovering = useCallback((fileId, requester, isUpload) => {
        const transferKey = `${fileId}_${requester}`;
        console.log(`[RTC_TRACE] Transitioning transfer ${transferKey} to RECOVERING state. isUpload: ${isUpload}`);
        
        if (isUpload) {
            const uploadKeys = [`${fileId}_${requester}`];
            uploadKeys.forEach(k => {
                const uploadObj = activeUploadsRef.current[k];
                if (uploadObj) {
                    uploadObj.aborted = true;
                    if (uploadObj.reader) {
                        try { uploadObj.reader.abort(); } catch {}
                    }
                    delete activeUploadsRef.current[k];
                }
            });
            activeUploadKeysRef.current.add(transferKey);
            transferLifecycleRef.current.set(transferKey, 'recovering');
            
            if (stompClientRef.current && stompClientRef.current.connected) {
                stompClientRef.current.send(`/topic/session/${sessionId}/transfer-activity`, {}, JSON.stringify({ type: 'END', fileId }));
            }
            
            activeUploadCountRef.current = 0;
            if (processQueueRef.current) processQueueRef.current();
        } else {
            activeDownloadKeysRef.current.add(transferKey);
            transferLifecycleRef.current.set(transferKey, 'recovering');
            setTransferStatuses(prev => ({ ...prev, [fileId]: 'Recovering...' }));
            activeDownloadCountRef.current = 0;
        }
    }, []);

    const handleTransitionTransfersToRecovering = useCallback((peerUsername) => {
        console.log(`[RTC_TRACE] Transitioning active transfers for dropped peer ${peerUsername} to recovering.`);
        
        // Uploads
        activeUploadKeysRef.current.forEach((val, key) => {
            if (key.endsWith(`_${peerUsername}`)) {
                const [fileId] = key.split('_');
                transitionToRecovering(fileId, peerUsername, true);
            } else {
                // Check if the dropped peer was an intermediate hop in the routing path of this upload
                const routingPath = activeRoutingPathsRef.current.get(key);
                if (routingPath) {
                    const pathArray = routingPath.split(',');
                    if (pathArray.includes(peerUsername)) {
                        const [fileId, requester] = key.split('_');
                        console.log(`[RTC_TRACE] Active upload path ${routingPath} was broken by dropped intermediate peer ${peerUsername}. Suspending transfer.`);
                        transitionToRecovering(fileId, requester, true);
                    }
                }
            }
        });
        
        // Downloads
        activeDownloadKeysRef.current.forEach((val, key) => {
            const [fileId] = key.split('_');
            const file = incomingTransfersRef.current[fileId] || sharedFilesRef.current.find(f => f.fileId === fileId);
            if (file) {
                if (file.sender === peerUsername) {
                    transitionToRecovering(fileId, peerUsername, false);
                } else {
                    // Check if the dropped peer was an intermediate hop in the routing path of this download
                    const routingPath = activeRoutingPathsRef.current.get(key);
                    if (routingPath) {
                        const pathArray = routingPath.split(',');
                        if (pathArray.includes(peerUsername)) {
                            console.log(`[RTC_TRACE] Active download path ${routingPath} was broken by dropped intermediate peer ${peerUsername}. Suspending transfer.`);
                            transitionToRecovering(fileId, file.sender, false);
                        }
                    }
                }
            }
        });
        
        // Waiting for chunks / assemblies
        pendingAssembliesRef.current.forEach(fileId => {
            const file = incomingTransfersRef.current[fileId] || sharedFilesRef.current.find(f => f.fileId === fileId);
            if (file) {
                if (file.sender === peerUsername) {
                    transitionToRecovering(fileId, peerUsername, false);
                } else {
                    const transferKey = `${fileId}_${currentUserRef.current}`;
                    const routingPath = activeRoutingPathsRef.current.get(transferKey);
                    if (routingPath) {
                        const pathArray = routingPath.split(',');
                        if (pathArray.includes(peerUsername)) {
                            transitionToRecovering(fileId, file.sender, false);
                        }
                    }
                }
            }
        });
    }, [transitionToRecovering]);

    const handleTransitionTransfersToRecoveringRef = useRef(handleTransitionTransfersToRecovering);
    useEffect(() => { handleTransitionTransfersToRecoveringRef.current = handleTransitionTransfersToRecovering; }, [handleTransitionTransfersToRecovering]);

    const getTransferDiagnosticMeta = useCallback(() => ({
        activePeers: webrtcManagerRef.current ? Object.keys(webrtcManagerRef.current.peers) : [],
        pendingTransfers: Array.from(pendingTransfersRef.current.keys()),
        uploadCount: activeUploadCountRef.current,
        downloadCount: activeDownloadCountRef.current,
        activeTransfers: Array.from(activeTransfersRef.current)
    }), []);

    // Periodic Mesh Maintenance Loop
    useEffect(() => {
        if (!isLocal) return; // Only run in WebRTC mode

        const syncInterval = setInterval(() => {
            if (stompClientRef.current && stompClientRef.current.connected && webrtcManagerRef.current) {
                // Collect fully open active peers
                const activePeers = [];
                const channels = webrtcManagerRef.current.dataChannels;
                for (const peer in channels) {
                    if (channels[peer] && channels[peer].readyState === 'open') {
                        activePeers.push(peer);
                    }
                }

                stompClientRef.current.send(`/app/session/${sessionId}/topology/sync`, {}, JSON.stringify({
                    reportingUser: currentUser,
                    activePeers: activePeers
                }));
            }
        }, 15000); // Sync every 15 seconds

        return () => clearInterval(syncInterval);
    }, [isLocal, sessionId, currentUser]);

    const retrySyncFile = useCallback(async (fileId) => {
        const file = incomingTransfers[fileId] || sharedFiles.find(f => f.fileId === fileId);
        if (!file) {
            toast.error("File details not found.");
            return;
        }
        try {
            let startChunkIndex = 0;
            const fileMeta = await db.getFileMetadata(fileId);
            if (fileMeta && fileMeta.totalChunks) {
                // Find contiguous chunks to determine where to resume
                for (let i = 0; i < fileMeta.totalChunks; i++) {
                    const chunk = await db.getFileChunk(fileId, i);
                    if (chunk && chunk.data) {
                        startChunkIndex = i + 1;
                    } else {
                        break;
                    }
                }
            }

            if (startChunkIndex === fileMeta?.totalChunks) {
                toast("File is already fully downloaded!");
                return;
            }

            // For manual retry, we explicitly delete active keys to allow clean restart
            const downloadKey = `${file.fileId}_${currentUser}`;
            activeDownloadKeysRef.current.delete(downloadKey);
            transferLifecycleRef.current.delete(downloadKey);
            sentBusySignalsRef.current.delete(file.fileId);

            toast(`Re-requesting sync of "${file.fileName}" from chunk ${startChunkIndex}...`);
            setTransferStatuses(prev => ({ ...prev, [fileId]: 'Requested...' }));

            initiateTransferRequest([{ fileId: file.fileId, sender: file.sender, startChunkIndex }]);
        } catch (err) {
            console.error("Failed to retry sync file:", err);
            toast.error("Failed to raise sync request.");
        }
    }, [sessionId, incomingTransfers, sharedFiles, guestUsername, currentUser]);

    useEffect(() => {
        connectionTypeRef.current = connectionType;
    }, [connectionType]);

    useEffect(() => {
        if (isLocal) {
            setConnectionType('webrtc');
        } else {
            setConnectionType('server');
        }
    }, [isLocal]);
    // Helper to stream chunks starting from specific index (enables resume/concurrency)
    const processNextUploadQueueItem = useCallback((cmd = null) => {
        let request = cmd;
        if (!request) {
            if (uploadQueueRef.current.length === 0) {
                activeUploadCountRef.current = 0;
                return;
            }
            request = uploadQueueRef.current.shift();
        }

        activeUploadCountRef.current = 1;

        const deadlockTimeout = setTimeout(() => {
            console.warn(`Handshake timeout for file ${request.fileId}. Dropping request and moving to next.`);
            transitionToRecovering(request.fileId, request.requester, true);
        }, 5000);

        pendingRequestsRef.current[`${request.fileId}_sender`] = deadlockTimeout;

        if (stompClientRef.current && stompClientRef.current.connected) {
            console.log("[RTC_TRACE] Sending READY_SIGNAL:", {
                fileId: request.fileId,
                targetSocketId: request.targetSocketId,
                requester: request.requester,
                startChunkIndex: request.startChunkIndex,
                sender: currentUser,
                meta: getTransferDiagnosticMeta()
            });
            stompClientRef.current.send(`/topic/session/${sessionId}/transfer-commands/${request.requester}`, {}, JSON.stringify({
                type: 'READY_SIGNAL',
                fileId: request.fileId,
                targetSocketId: request.targetSocketId,
                requester: request.requester,
                startChunkIndex: request.startChunkIndex,
                sender: currentUser
            }));
        }
    }, [sessionId, currentUser]);

    useEffect(() => {
        processQueueRef.current = processNextUploadQueueItem;
    }, [processNextUploadQueueItem]);

    const streamFileFromChunk = useCallback(async (fileId, startChunkIndex, targetSocketId = null, targetUsername = null, requestId = null, routingPath = null) => {
        const uploadKey = targetSocketId ? `${fileId}_${targetSocketId}` : (targetUsername ? `${fileId}_${targetUsername}` : fileId);
        let uploadObj = activeUploadsRef.current[uploadKey];

        if (!uploadObj) {
            let baseUpload = activeUploadsRef.current[fileId];
            if (!baseUpload) {
                // Recover dynamically from local IndexedDB if missing in cache
                const localMetadata = await db.getFileMetadata(fileId);
                const localBlobInfo = await db.getFileBlob(fileId);
                if (localMetadata && localBlobInfo && localBlobInfo.blob && localMetadata.status === 'completed') {
                    baseUpload = {
                        file: new File([localBlobInfo.blob], localMetadata.fileName, { type: localMetadata.fileType }),
                        aborted: false,
                        reader: null
                    };
                    activeUploadsRef.current[fileId] = baseUpload;
                }
            }
            if (!baseUpload) return;
            uploadObj = {
                file: baseUpload.file,
                aborted: false,
                reader: null
            };
            activeUploadsRef.current[uploadKey] = uploadObj;
        } else {
            uploadObj.aborted = true;
            if (uploadObj.reader) {
                try { uploadObj.reader.abort(); } catch { /* ignore */ }
            }
            uploadObj = { file: uploadObj.file, aborted: false, reader: null };
            activeUploadsRef.current[uploadKey] = uploadObj;
        }

        const { file } = uploadObj;
        const connType = connectionTypeRef.current;
        const isWebRTC = connType === 'webrtc' && webrtcManagerRef.current;

        if (isWebRTC && !targetUsername) {
            console.log("[RTC_TRACE] streamFileFromChunk: Push/broadcast streaming skipped in WebRTC mode. Awaiting pull request from receivers.");
            return;
        }

        const transferKey = `${fileId}_${targetUsername || 'all'}`;
        if (targetUsername) {
            transferLifecycleRef.current.set(transferKey, 'streaming');
            if (routingPath) {
                activeRoutingPathsRef.current.set(transferKey, routingPath);
            }
        }
                if (startChunkIndex === 0 && stompClientRef.current && stompClientRef.current.connected) {
            if (!sentStartEventsRef.current.has(transferKey)) {
                sentStartEventsRef.current.add(transferKey);
                reportedMilestonesRef.current[fileId] = 0;
                const fileSizeStr = formatFileSize(file.size);
                const targetStr = targetUsername ? `@${targetUsername}` : 'all connected peers';
                const connModeStr = isWebRTC ? 'WebRTC' : 'server relay';
                stompClientRef.current.send(`/topic/session/${sessionId}/presence`, {}, `[TRAFFIC] Started ${connModeStr} transfer of "${file.name}" (${fileSizeStr}) from @${currentUser} to ${targetStr}`);
            }
            
            if (!activeActivityStartEventsRef.current.has(fileId)) {
                activeActivityStartEventsRef.current.add(fileId);
                stompClientRef.current.send(`/topic/session/${sessionId}/transfer-activity`, {}, JSON.stringify({
                    type: 'START',
                    fileId
                }));
                console.log(`[RTC_TRACE] Dispatched transfer-activity START event for fileId: ${fileId}`);
            }
        }

        let endedNormally = false;

        let nextHop = targetUsername;
        if (isWebRTC && targetUsername && routingPath) {
            const pathArray = routingPath.split(',');
            const myIndex = pathArray.indexOf(currentUser);
            if (myIndex !== -1 && myIndex < pathArray.length - 1) {
                nextHop = pathArray[myIndex + 1];
            }
        }
        console.log(`[RTC_TRACE] streamFileFromChunk: resolved routingPath=${routingPath}, target=${targetUsername}, nextHop=${nextHop}`);

        try {
            if (isWebRTC && targetUsername) {
                let dc = webrtcManagerRef.current.dataChannels[nextHop];
                let retries = 0;

                const safePeers = (webrtcManagerRef.current && webrtcManagerRef.current.peers) || {};
                const hasTargetPeer = !!safePeers[nextHop];
                const expectedPeers = Object.keys(safePeers).length;

                // If they are a leaf node or the next hop peer doesn't exist in our routing table, bypass abort
                if (expectedPeers > 0 && hasTargetPeer) {
                    // Wait up to 15 seconds for the WebRTC connection to negotiate and the data channel to open
                    while ((!dc || dc.readyState !== 'open') && retries < 150) {
                        if (uploadObj.aborted) {
                            console.log(`[RTC_TRACE] streamFileFromChunk: aborting during connection wait for next hop ${nextHop}`);
                            return;
                        }
                        await new Promise(r => setTimeout(r, 100));
                        dc = webrtcManagerRef.current.dataChannels[nextHop];
                        retries++;
                    }
                    if (!dc || dc.readyState !== 'open') {
                        console.warn(`WebRTC channel for next hop ${nextHop} (routing to ${targetUsername}) never opened. Aborting transfer.`);
                        toast.error("WebRTC connection failed to open in time.");
                        uploadObj.aborted = true;
                        endedNormally = false;
                        return;
                    }
                }
            } else if (isWebRTC && !targetUsername) {
                // Broadcast mode: Wait up to 15 seconds for AT LEAST ONE data channel to open
                let retries = 0;
                while (retries < 150) {
                    if (uploadObj.aborted) return;

                    const safeDataChannels = (webrtcManagerRef.current && webrtcManagerRef.current.dataChannels) || {};
                    const safePeers = (webrtcManagerRef.current && webrtcManagerRef.current.peers) || {};

                    const anyOpen = Object.values(safeDataChannels).some(dc => dc.readyState === 'open');
                    const expectedPeers = Object.keys(safePeers).length;

                    if (anyOpen || expectedPeers === 0) break;
                    await new Promise(r => setTimeout(r, 100));
                    retries++;
                }

                const finalDataChannels = (webrtcManagerRef.current && webrtcManagerRef.current.dataChannels) || {};
                const finalPeers = (webrtcManagerRef.current && webrtcManagerRef.current.peers) || {};

                const anyOpen = Object.values(finalDataChannels).some(dc => dc.readyState === 'open');
                const expectedPeers = Object.keys(finalPeers).length;

                if (!anyOpen && expectedPeers > 0) {
                    console.warn(`WebRTC broadcast channels never opened. Aborting transfer.`);
                    toast.error("WebRTC connection failed to open in time.");
                    uploadObj.aborted = true;
                    endedNormally = false;
                    return;
                }
            }

            // Dynamic Chunk Sizes: 250KB for WebRTC (leaves room for header to avoid max-message-size errors), 64KB for STOMP
            const CHUNK_SIZE = isWebRTC ? 256000 : 65536;
            const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
            const BLOCK_SIZE = 16777216; // 16MB blocks

            let currentChunkIndex = startChunkIndex;

            const getNextChunkIndex = () => {
                if (currentChunkIndex < totalChunks) {
                    return currentChunkIndex++;
                }
                return null;
            };

            const getActiveDataChannels = () => {
                if (!webrtcManagerRef.current) return [];
                if (nextHop) {
                    const dc = webrtcManagerRef.current.dataChannels[nextHop];
                    return dc ? [dc] : [];
                }
                return Object.values(webrtcManagerRef.current.dataChannels);
            };

            const convertToBase64 = (arrayBuffer) => {
                const bytes = new Uint8Array(arrayBuffer);
                let binary = '';
                const len = bytes.byteLength;
                const chunk = 8192;
                for (let i = 0; i < len; i += chunk) {
                    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
                }
                return window.btoa(binary);
            };

            let activeBlockPromise = null;
            let activeBlockStart = -1;
            let activeBlockEnd = -1;

            const loadBlockForOffset = (currentOffset) => {
                const blockIndex = Math.floor(currentOffset / BLOCK_SIZE);
                const blockStart = blockIndex * BLOCK_SIZE;
                const blockEnd = Math.min(file.size, blockStart + BLOCK_SIZE);

                if (blockStart === activeBlockStart && blockEnd === activeBlockEnd && activeBlockPromise) {
                    return { promise: activeBlockPromise, start: activeBlockStart };
                }

                activeBlockStart = blockStart;
                activeBlockEnd = blockEnd;
                const blockSlice = file.slice(blockStart, blockEnd);
                activeBlockPromise = blockSlice.arrayBuffer();
                return { promise: activeBlockPromise, start: activeBlockStart };
            };

            let lastReportedProgress = -1;
            const updateProgress = (percentage) => {
                if (percentage === lastReportedProgress) return;
                lastReportedProgress = percentage;
                setUploadTransfers(prev => ({
                    ...prev,
                    [fileId]: {
                        fileId,
                        fileName: file.name,
                        fileSize: file.size,
                        progress: percentage
                    }
                }));
            };

            const sendWorker = async () => {
                console.log(`[RTC_TRACE] sendWorker spawned for fileId: ${fileId}. Current chunkIndex: ${currentChunkIndex}`);
                while (true) {
                    if (uploadObj.aborted) {
                        console.log(`[RTC_TRACE] sendWorker exited early because uploadObj.aborted is true.`);
                        return;
                    }

                    // WebRTC backpressure check
                    if (isWebRTC) {
                        const activeChannels = getActiveDataChannels();
                        const bufferLimit = 1048576; // 1MB buffer limit

                        while(true) {
                            if (uploadObj.aborted) {
                                console.log(`[RTC_TRACE] sendWorker exited early during backpressure loop because uploadObj.aborted is true.`);
                                return;
                            }
                            const blocked = activeChannels.some(dc => dc.readyState === 'open' && dc.bufferedAmount > bufferLimit);
                            if (!blocked) break;
                            await new Promise(r => setTimeout(r, 10));
                        }
                    }

                    const chunkIndex = getNextChunkIndex();
                    if (chunkIndex === null) {
                        console.log(`[RTC_TRACE] sendWorker finished sending all chunks successfully (chunkIndex is null).`);
                        return;
                    }

                    const offset = chunkIndex * CHUNK_SIZE;

                    let blockBuffer;
                    let blockStart;
                    try {
                        const blockInfo = loadBlockForOffset(offset);
                        blockBuffer = await blockInfo.promise;
                        blockStart = blockInfo.start;
                    } catch (e) {
                        console.error("[RTC_TRACE] Error reading file block at offset:", offset, e);
                        toast.error("Error reading file block.");
                        uploadObj.aborted = true;
                        setUploadTransfers(prev => {
                            const next = { ...prev };
                            delete next[fileId];
                            return next;
                        });
                        console.log(`[RTC_TRACE] sendWorker exited early due to file read error.`);
                        return;
                    }

                    const relativeOffset = offset - blockStart;
                    const chunkData = blockBuffer.slice(relativeOffset, relativeOffset + CHUNK_SIZE);

                    if (isWebRTC) {
                        const packet = packBinaryChunk(fileId, file.sender || currentUser, chunkIndex, totalChunks, file.size, chunkData, targetUsername, routingPath);
                        
                        if (chunkIndex === startChunkIndex) {
                            console.log(`[RTC_TRACE] First sendDataToPeer() invocation. Target: ${targetUsername}, Next hop: ${nextHop}. Packet size: ${packet.byteLength} bytes.`);
                        }

                        // Send directly to resolved nextHop!
                        const success = webrtcManagerRef.current ? webrtcManagerRef.current.sendDataToPeer(nextHop, packet) : false;

                        if (!success) {
                            console.warn(`[RTC_TRACE] WebRTC send failed for chunk ${chunkIndex} of file ${fileId} to next hop ${nextHop}. Triggering auto-recovery path verification.`);
                            uploadObj.aborted = true;
                            
                            // Suspend current transfer state
                            const transferKey = `${fileId}_${targetUsername || 'all'}`;
                            transferLifecycleRef.current.set(transferKey, 'path-verifying');
                            
                            // Queue the transfer for pre-flight path verification starting from the failed chunk
                            pendingTransfersRef.current.set(fileId, {
                                targetUser: targetUsername,
                                startChunkIndex: chunkIndex,
                                targetSocketId: targetSocketId,
                                requester: targetUsername
                            });

                            // Request a new path from the mesh router
                            if (stompClientRef.current && stompClientRef.current.connected) {
                                stompClientRef.current.send(`/app/session/${sessionId}/verify-path`, {}, JSON.stringify({
                                    sender: currentUser,
                                    target: targetUsername,
                                    fileId: fileId
                                }));
                            }
                            console.log(`[RTC_TRACE] sendWorker exited early due to sendDataToPeer failure.`);
                            return;
                        }
                    } else {
                        await sendViaStomp(chunkData, chunkIndex);
                    }

                    const progress = Math.round((chunkIndex / totalChunks) * 100);
                    if (progress !== lastReportedProgress || chunkIndex === totalChunks - 1) {
                        updateProgress(progress);

                        const milestone = Math.floor(progress / 25) * 25;
                        if (milestone > 0 && milestone < 100 && milestone !== reportedMilestonesRef.current[fileId]) {
                            reportedMilestonesRef.current[fileId] = milestone;
                            if (stompClientRef.current && stompClientRef.current.connected) {
                                const targetStr = targetUsername ? `@${targetUsername}` : 'all connected peers';
                                stompClientRef.current.send(`/topic/session/${sessionId}/presence`, {}, `[TRAFFIC] Transmitting "${file.name}" from @${currentUser} to ${targetStr}: ${milestone}%`);
                            }
                        }
                    }
                    if (chunkIndex % 20 === 0 || chunkIndex === totalChunks - 1) {
                        await new Promise(r => setTimeout(r, 0));
                    }
                }
            };

            const sendViaStomp = async (chunkData, chunkIndex) => {
                if (stompClientRef.current && stompClientRef.current.connected) {
                    const base64Data = convertToBase64(chunkData);
                    stompClientRef.current.send(`/app/session/${sessionId}/stream`, {}, JSON.stringify({
                        type: 'CHUNK',
                        fileId,
                        chunkIndex,
                        data: base64Data,
                        fileName: '',
                        fileType: '',
                        fileSize: file.size,
                        sender: currentUser,
                        targetUsername,
                        totalChunks: totalChunks
                    }));
                } else {
                    toast.error("Transfer failed: no connection available.");
                    uploadObj.aborted = true;
                    setUploadTransfers(prev => {
                        const next = { ...prev };
                        delete next[fileId];
                        return next;
                    });
                }
            };

            // Start worker pool (4 concurrent workers for WebRTC, 1 for STOMP)
            const CONCURRENCY = isWebRTC ? 4 : 1;
            const workers = Array.from({ length: CONCURRENCY }, () => sendWorker());
            await Promise.all(workers);

            // Send END event when all workers complete
            if (!uploadObj.aborted) {
                const currentConnType = connectionTypeRef.current;
                const currentIsWebRTC = currentConnType === 'webrtc';
                if (currentIsWebRTC && webrtcManagerRef.current) {
                    endedNormally = true;
                    const sendEnd = () => {
                        const success = webrtcManagerRef.current ? webrtcManagerRef.current.sendDataToPeer(nextHop, {
                            streamData: true,
                            type: 'END',
                            targetUsername,
                            routingPath,
                            fileId, chunkIndex: 0, data: '', fileName: '', fileType: '', fileSize: file.size, sender: currentUser, totalChunks
                        }) : false;
                        if (!success) {
                            setTimeout(sendEnd, 100);
                        } else {
                            if (!targetSocketId && !targetUsername) toast.success(`Shared: ${file.name}`);
                            setUploadTransfers(prev => {
                                const next = { ...prev };
                                delete next[fileId];
                                return next;
                            });
                            if (stompClientRef.current && stompClientRef.current.connected) {
                                const targetStr = targetUsername ? `@${targetUsername}` : 'all connected peers';
                                stompClientRef.current.send(`/topic/session/${sessionId}/presence`, {}, `[TRAFFIC] Completed WebRTC transfer of "${file.name}" from @${currentUser} to ${targetStr}`);
                                stompClientRef.current.send(`/topic/session/${sessionId}/transfer-activity`, {}, JSON.stringify({ type: 'END', fileId }));
                            }
                            if (requestId && stompClientRef.current && stompClientRef.current.connected) {
                                stompClientRef.current.send(`/app/session/${sessionId}/transfer-complete`, {}, JSON.stringify({ requestId }));
                            }
                        }
                    };
                    sendEnd();
                } else if (stompClientRef.current && stompClientRef.current.connected) {
                    endedNormally = true;
                    stompClientRef.current.send(`/app/session/${sessionId}/stream`, {}, JSON.stringify({
                        type: 'END',
                        fileId, chunkIndex: 0, data: '', fileName: '', fileType: '', fileSize: file.size, sender: currentUser, targetUsername, totalChunks
                    }));
                    if (!targetSocketId && !targetUsername) toast.success(`Shared: ${file.name}`);
                    setUploadTransfers(prev => {
                        const next = { ...prev };
                        delete next[fileId];
                        return next;
                    });
                    if (stompClientRef.current && stompClientRef.current.connected) {
                        const targetStr = targetUsername ? `@${targetUsername}` : 'all connected peers';
                        stompClientRef.current.send(`/topic/session/${sessionId}/presence`, {}, `[TRAFFIC] Completed server relay transfer of "${file.name}" from @${currentUser} to ${targetStr}`);
                        stompClientRef.current.send(`/topic/session/${sessionId}/transfer-activity`, {}, JSON.stringify({ type: 'END', fileId }));
                    }
                    if (requestId && stompClientRef.current && stompClientRef.current.connected) {
                        stompClientRef.current.send(`/app/session/${sessionId}/transfer-complete`, {}, JSON.stringify({ requestId }));
                    }
                }
            }
        } catch (e) {
            console.error("Error in streamFileFromChunk:", e);
        } finally {
            if (!endedNormally) {
                if (targetUsername) {
                    transitionToRecovering(fileId, targetUsername, true);
                } else {
                    activeUploadCountRef.current = 0;
                    if (processQueueRef.current) processQueueRef.current();
                }
            } else {
                if (targetUsername) {
                    cleanupUploadState(fileId, targetUsername);
                } else {
                    activeUploadCountRef.current = 0;
                    if (processQueueRef.current) processQueueRef.current();
                }
            }

            if (!endedNormally) {
                console.log("[RTC_TRACE] Transfer ABORT/FAIL:", {
                    fileId,
                    targetUsername,
                    meta: getTransferDiagnosticMeta()
                });
                setUploadTransfers(prev => {
                    const next = { ...prev };
                    delete next[fileId];
                    return next;
                });
                if (stompClientRef.current && stompClientRef.current.connected) {
                    const targetStr = targetUsername ? `@${targetUsername}` : 'all connected peers';
                    stompClientRef.current.send(`/topic/session/${sessionId}/presence`, {}, `[TRAFFIC] Failed/Aborted transfer of "${file.name}" from @${currentUser} to ${targetStr}`);
                    stompClientRef.current.send(`/topic/session/${sessionId}/transfer-activity`, {}, JSON.stringify({ type: 'END', fileId }));
                }
            }
        }
    }, [sessionId, currentUser]);

    // Restore completed files from DB and request missing files from server sync
    const syncFilesWithServer = useCallback(async (stompClient, source = "unknown") => {
        if (syncInProgressRef.current) {
            console.log(`[RTC_TRACE] syncFilesWithServer() queued (already in progress). Source: ${source}`);
            syncRequestedAgainRef.current = true;
            return;
        }
        syncInProgressRef.current = true;
        try {
            console.log(`[RTC_TRACE] syncFilesWithServer() triggered. Source: ${source}`);
            // 1. Fetch truth from server
            const res = await api.get(`/sessions/${sessionId}/files`);
            const serverFiles = res.data; // Array of SharedFile metadata

            // 2. Load completed blobs from local IndexedDB
            const loadedSharedFiles = [];
            const missingFiles = [];

            for (const serverFile of serverFiles) {
                const localBlobInfo = await db.getFileBlob(serverFile.fileId);

                if (localBlobInfo && localBlobInfo.blob) {
                    // We already have the complete file locally
                    const fileUrl = URL.createObjectURL(localBlobInfo.blob);
                    loadedSharedFiles.push({ ...serverFile, url: fileUrl });
                } else if (serverFile.sender !== currentUser) {
                    missingFiles.push(serverFile);
                }
            }

            setSharedFiles(loadedSharedFiles);

            if (missingFiles.length > 0) {
                // Initialize downloading status in DB for missing files
                for (const f of missingFiles) {
                    const localMetadata = await db.getFileMetadata(f.fileId);
                    if (!localMetadata) {
                        await db.saveFileMetadata({ ...f, status: 'downloading' });
                    }
                    setIncomingTransfers(prev => ({
                        ...prev,
                        [f.fileId]: {
                            ...f,
                            progress: 0
                        }
                    }));
                }

                // We want auto-sync to trigger the queueing handshake for new users
                const requestBody = missingFiles.map(f => ({ fileId: f.fileId, sender: f.sender }));
                initiateTransferRequest(requestBody);
            }

        } catch (err) {
            console.error("Failed to sync session files:", err);
            toast.error("Failed to sync files with server.");
        } finally {
            syncInProgressRef.current = false;
            if (syncRequestedAgainRef.current) {
                syncRequestedAgainRef.current = false;
                setTimeout(() => {
                    if (stompClientRef.current && stompClientRef.current.connected) {
                        syncFilesWithServer(stompClientRef.current, "coalesced queued execution");
                    }
                }, 0);
            }
        }
    }, [sessionId, currentUser, guestUsername]);

    const handleRetryConnection = useCallback(() => {
        setConnectionError(null);
        toast("Attempting to re-establish WebRTC connections...");
        if (stompClientRef.current && stompClientRef.current.connected) {
            if (currentUser !== hostUsername) {
                // Rely on backend's healMesh logic to detect and re-assign peers
                console.log("Guest requesting WebRTC retry. Waiting for ASSIGN_PEERS from Host/Backend...");
            } else {
                stompClientRef.current.send(`/topic/session/${sessionId}/presence`, {}, `${currentUser} has joined the session!`);
            }
            syncFilesWithServer(stompClientRef.current, "handleRetryConnection callback");
        }
    }, [sessionId, currentUser, hostUsername, syncFilesWithServer]);

    const deleteLeftUserFiles = useCallback(async (leftUser) => {
        try {
            const allFilesMeta = await db.getAllFilesMetadata();
            const leftUserFiles = allFilesMeta.filter(f => f.sender === leftUser);

            for (const fileMeta of leftUserFiles) {
                await db.deleteFileRecord(fileMeta.fileId);
                setSharedFiles(prev => prev.filter(f => f.fileId !== fileMeta.fileId));
                cleanupDownloadState(fileMeta.fileId);
            }

            // Also clean up active upload keys where leftUser was the requester
            activeUploadKeysRef.current.forEach((val, key) => {
                if (key.endsWith(`_${leftUser}`)) {
                    const [fileId] = key.split('_');
                    cleanupUploadState(fileId, leftUser);
                }
            });

            if (leftUserFiles.length > 0) {
                toast(`Cleaned up files shared by @${leftUser}`);
            }
        } catch (e) {
            console.error("Error cleaning up left user files:", e);
        }
    }, [currentUser, cleanupDownloadState, cleanupUploadState]);

    const handleIncomingFileChunk = useCallback(async (data) => {
        if (data.type === 'RESUME_REQUEST') {
            let uploadObj = activeUploadsRef.current[data.fileId];
            if (!uploadObj) {
                // Reconstruct File reference from local IndexedDB if we are the sender
                const localMetadata = await db.getFileMetadata(data.fileId);
                const localBlobInfo = await db.getFileBlob(data.fileId);
                if (localMetadata && localBlobInfo && localBlobInfo.blob && localMetadata.status === 'completed') {
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
                streamFileFromChunk(data.fileId, data.chunkIndex, data.senderSocketId, data.sender);
            }
            return;
        }

        if (data.sender === currentUser) return;
        if (data.targetUsername && data.targetUsername !== currentUser) return;

        // Avoid processing stream chunks if we already completed this file
        const localMetadata = await db.getFileMetadata(data.fileId);
        if (localMetadata && localMetadata.status === 'completed') {
            return;
        }

        if (data.type === 'START') {
            const downloadKey = `${data.fileId}_${currentUser}`;
            const isWebRTC = connectionTypeRef.current === 'webrtc' && webrtcManagerRef.current;
            if (!isWebRTC) {
                transferLifecycleRef.current.set(downloadKey, 'streaming');
            }
            if (data.routingPath) {
                activeRoutingPathsRef.current.set(downloadKey, data.routingPath);
            }
            console.log("[RTC_TRACE] Incoming transfer START event received:", {
                fileId: data.fileId,
                fileName: data.fileName,
                sender: data.sender,
                meta: getTransferDiagnosticMeta()
            });
            if (processedStartEventsRef.current.has(data.fileId)) return;
            processedStartEventsRef.current.add(data.fileId);

            const localMetadata = await db.getFileMetadata(data.fileId);
            if (localMetadata) return;

            // Initialize local DB tracking
            await db.saveFileMetadata({ ...data, status: 'downloading' });
            toast(`Incoming file: ${data.fileName}`);
            setIncomingTransfers(prev => ({
                ...prev, [data.fileId]: { ...data, progress: 0 }
            }));

            // Trigger automatic download/pull request in WebRTC mode
            if (isWebRTC) {
                console.log(`[RTC_TRACE] Auto-initiating pull request for shared file: ${data.fileId} from sender: ${data.sender}`);
                initiateTransferRequest([{ fileId: data.fileId, sender: data.sender }]);
            }
        }
        else if (data.type === 'CHUNK') {
            const downloadKey = `${data.fileId}_${currentUser}`;
            if (data.routingPath) {
                activeRoutingPathsRef.current.set(downloadKey, data.routingPath);
            }
            if (transferLifecycleRef.current.get(downloadKey) !== 'streaming') {
                transferLifecycleRef.current.set(downloadKey, 'streaming');
            }
            // Phase 5: Cancel Active Jitter Timeout if missing chunk arrives
            const jitterKey = `${data.fileId}_${data.chunkIndex}`;
            if (pendingResendsRef.current.has(jitterKey)) {
                clearTimeout(pendingResendsRef.current.get(jitterKey));
                pendingResendsRef.current.delete(jitterKey);
                console.log(`Jitter cancelled for ${jitterKey} (Chunk arrived!)`);
            }

            let bytes;
            if (data.isBinary) {
                bytes = data.data; // data is already a Uint8Array
            } else {
                const binaryStr = window.atob(data.data);
                bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) {
                    bytes[i] = binaryStr.charCodeAt(i);
                }
            }

            await db.saveFileChunk(data.fileId, data.chunkIndex, bytes);

            const total = data.totalChunks || 1;
            const progress = Math.min(100, Math.round(((data.chunkIndex + 1) / total) * 100));
            const lastPercent = lastReportedIncomingProgressRef.current.get(data.fileId);

            if (lastPercent === undefined || progress !== lastPercent || data.chunkIndex === total - 1 || data.chunkIndex === 0) {
                lastReportedIncomingProgressRef.current.set(data.fileId, progress);
                setIncomingTransfers(prev => {
                    const currentFile = prev[data.fileId];
                    return {
                        ...prev,
                        [data.fileId]: {
                            ...(currentFile || {
                                fileId: data.fileId,
                                fileName: data.fileName || 'Incoming File',
                                fileSize: data.fileSize || 0,
                                sender: data.sender,
                                totalChunks: total
                            }),
                            progress
                        }
                    };
                });
            }

            // Phase 5: Post-Recovery Hook
            if (pendingAssembliesRef.current.has(data.fileId)) {
                const metadata = await db.getFileMetadata(data.fileId);
                if (metadata) {
                    const allChunks = await db.getAllFileChunks(data.fileId);
                    if (allChunks.length === metadata.totalChunks) {
                        console.log(`Phase 5: Missing chunks recovered. Assembling file ${data.fileId}...`);
                        pendingAssembliesRef.current.delete(data.fileId);

                        try {
                            const blobParts = allChunks.map(c => c.data);
                            const mimeTypes = {
                                'txt': 'text/plain', 'pdf': 'application/pdf', 'png': 'image/png',
                                'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif',
                                'csv': 'text/csv', 'mp3': 'audio/mpeg', 'mp4': 'video/mp4',
                                'zip': 'application/zip', 'json': 'application/json', 'html': 'text/html',
                                'css': 'text/css', 'js': 'text/javascript', 'doc': 'application/msword',
                                'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                                'xls': 'application/vnd.ms-excel', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                            };
                            const ext = metadata.fileName ? metadata.fileName.split('.').pop().toLowerCase() : '';
                            const fileType = metadata.fileType || mimeTypes[ext] || 'application/octet-stream';
                            const blob = new Blob(blobParts, { type: fileType });

                            await db.saveFileBlob(data.fileId, blob);
                            await db.saveFileMetadata({ ...metadata, status: 'completed' });
                            await db.deleteFileChunks(data.fileId);

                            const fileUrl = URL.createObjectURL(blob);
                            setSharedFiles((prev) => {
                                if (prev.some(f => f.fileId === metadata.fileId)) return prev;
                                return [...prev, { ...metadata, url: fileUrl }];
                            });
                            
                            // Trigger Content-Aware Mesh Replication
                            if (stompClientRef.current && stompClientRef.current.connected) {
                                stompClientRef.current.send(`/app/session/${sessionId}/register-owner`, {}, JSON.stringify({
                                    username: currentUser,
                                    fileId: metadata.fileId,
                                    fileName: metadata.fileName,
                                    fileType: metadata.fileType,
                                    fileSize: metadata.fileSize,
                                    totalChunks: metadata.totalChunks,
                                    status: "COMPLETE"
                                }));
                            }

                            toast.success(`Ready: ${metadata.fileName}`);
                        } catch (e) {
                            console.error("Assembly error", e);
                            toast.error(`Transfer of ${metadata.fileName} was corrupted.`);
                        } finally {
                            cleanupDownloadState(data.fileId);
                        }
                    }
                }
            }
        }
        else if (data.type === 'END') {
            console.log("[RTC_TRACE] Incoming transfer END event received:", {
                fileId: data.fileId,
                meta: getTransferDiagnosticMeta()
            });
            const metadata = await db.getFileMetadata(data.fileId);
            if (metadata) {
                try {
                    const allChunks = await db.getAllFileChunks(data.fileId);

                    // Phase 5: Missing Chunk Validation
                    if (allChunks.length !== metadata.totalChunks) {
                        console.warn(`File ${metadata.fileId} incomplete. Have ${allChunks.length}/${metadata.totalChunks} chunks.`);
                        const presentChunks = new Set(allChunks.map(c => c.chunkIndex));
                        const missingChunks = [];
                        for (let i = 0; i < metadata.totalChunks; i++) {
                            if (!presentChunks.has(i)) missingChunks.push(i);
                        }

                        if (missingChunks.length > 0) {
                            pendingAssembliesRef.current.add(metadata.fileId); // Phase 5: Track incomplete files

                            // Phase 7: Debounce chunk requests to prevent STOMP flood
                            const now = Date.now();
                            const lastReq = pendingRequestsRef.current[`${metadata.fileId}_missing`] || 0;

                            if (now - lastReq > 4000) {
                                pendingRequestsRef.current[`${metadata.fileId}_missing`] = now;

                                // Escape render cycle and avoid STOMP flooding
                                setTimeout(() => {
                                    if (stompClientRef.current && stompClientRef.current.connected) {
                                        stompClientRef.current.send(`/app/session/${sessionId}/request-chunks`, {}, JSON.stringify({
                                            fileId: metadata.fileId,
                                            requester: currentUser,
                                            missingChunks: missingChunks
                                        }));
                                        toast(`Missing ${missingChunks.length} chunk(s) detected. Requesting self-heal...`);
                                    }
                                }, Math.random() * 500); // Slight random jitter to batch STOMP sends
                            }
                            return; // Abort stitching
                        }
                    }

                    const blobParts = allChunks.map(c => c.data);

                    const mimeTypes = {
                        'txt': 'text/plain', 'pdf': 'application/pdf', 'png': 'image/png',
                        'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif',
                        'csv': 'text/csv', 'mp3': 'audio/mpeg', 'mp4': 'video/mp4',
                        'zip': 'application/zip', 'json': 'application/json', 'html': 'text/html',
                        'css': 'text/css', 'js': 'text/javascript', 'doc': 'application/msword',
                        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        'xls': 'application/vnd.ms-excel', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    };
                    const ext = metadata.fileName ? metadata.fileName.split('.').pop().toLowerCase() : '';
                    const fileType = metadata.fileType || mimeTypes[ext] || 'application/octet-stream';

                    const blob = new Blob(blobParts, { type: fileType });

                    await db.saveFileBlob(data.fileId, blob);
                    await db.saveFileMetadata({ ...metadata, status: 'completed' });

                    // Garbage collection: delete the chunks now that the blob is successfully assembled
                    // to save IndexedDB quota
                    await db.deleteFileChunks(data.fileId);

                    const fileUrl = URL.createObjectURL(blob);
                    setSharedFiles((prev) => {
                        if (prev.some(f => f.fileId === metadata.fileId)) return prev;
                        return [...prev, { ...metadata, url: fileUrl }];
                    });
                    
                    // Trigger Content-Aware Mesh Replication
                    if (stompClientRef.current && stompClientRef.current.connected) {
                        stompClientRef.current.send(`/app/session/${sessionId}/register-owner`, {}, JSON.stringify({
                            username: currentUser,
                            fileId: metadata.fileId,
                            fileName: metadata.fileName,
                            fileType: metadata.fileType,
                            fileSize: metadata.fileSize,
                            totalChunks: metadata.totalChunks,
                            status: "COMPLETE"
                        }));
                    }

                    toast.success(`Ready: ${metadata.fileName}`);
                } catch (e) {
                    console.error("Assembly error", e);
                    toast.error(`Transfer of ${metadata.fileName} was corrupted.`);
                } finally {
                    cleanupDownloadState(data.fileId);
                }
            }
        }
    }, [currentUser, streamFileFromChunk, sessionId]);

    const streamFileFromChunkRef = useRef(streamFileFromChunk);
    const syncFilesWithServerRef = useRef(syncFilesWithServer);
    const handleIncomingFileChunkRef = useRef(handleIncomingFileChunk);
    const deleteLeftUserFilesRef = useRef(deleteLeftUserFiles);

    useEffect(() => { streamFileFromChunkRef.current = streamFileFromChunk; }, [streamFileFromChunk]);
    useEffect(() => { syncFilesWithServerRef.current = syncFilesWithServer; }, [syncFilesWithServer]);
    useEffect(() => { handleIncomingFileChunkRef.current = handleIncomingFileChunk; }, [handleIncomingFileChunk]);
    useEffect(() => { deleteLeftUserFilesRef.current = deleteLeftUserFiles; }, [deleteLeftUserFiles]);

    useEffect(() => {
        if (!currentUser) return;

        let isMounted = true;
        let socket = null;
        let stompClient = null;
        let reconnectTimeout = null;
        let heartbeatInterval = null;

        const base = import.meta.env.VITE_API_BASE_URL || 'http://192.168.1.19:8080';
        const wsUrl = base.endsWith('/') ? `${base}ws-placement` : `${base}/ws-placement`;

                const connect = () => {
            console.log("[RTC_TRACE] connect() function invoked.");
            if (!isMounted) return;

            // Check if we have active pinned connections
            let hasActivePinned = false;
            if (webrtcManagerRef.current) {
                if (webrtcManagerRef.current.peers) {
                    Object.keys(webrtcManagerRef.current.peers).forEach(peer => {
                        if (webrtcManagerRef.current.callbacks.isPeerConnectionPinned(peer)) {
                            hasActivePinned = true;
                        }
                    });
                }
            }

            if (!hasActivePinned) {
                activeUploadKeysRef.current.clear();
                activeDownloadKeysRef.current.clear();
                sentStartEventsRef.current.clear();
                transferLifecycleRef.current.clear();
                sentBusySignalsRef.current.clear();
                pathRetryTimeoutsRef.current.forEach(t => clearTimeout(t));
                pathRetryTimeoutsRef.current.clear();
                activeActivityStartEventsRef.current.clear();
                
                if (webrtcManagerRef.current) {
                    console.log("[RTC_TRACE] Reconnect safeguard: Tearing down existing WebRTCManager before STOMP reconnection.");
                    webrtcManagerRef.current.teardown("reconnect safeguard inside connect()");
                    webrtcManagerRef.current = null;
                    setActivePeers([]);
                }
            } else {
                console.log("[RTC_TRACE] Reconnect safeguard: Retaining existing WebRTCManager with active transfers during STOMP reconnection.");
            }
            
            socket = new SockJS(wsUrl);
            stompClient = Stomp.over(socket);
            stompClient.debug = null; 
            stompClientRef.current = stompClient;

            stompClient.connect({
                username: currentUser,
                sessionId: sessionId
            }, 
                () => {
                    console.log("[RTC_TRACE] STOMP connected successfully for user:", currentUser);
                    if (!isMounted) {
                        stompClient.disconnect();
                        return;
                    }
                    setIsConnected(true);

                    if (webrtcManagerRef.current) {
                        console.log("[RTC_TRACE] Re-wiring new STOMP client to existing WebRTCManager.");
                        webrtcManagerRef.current.stompClient = stompClient;
                    }

                    // Phase 4: Heartbeat Publisher
                    heartbeatInterval = setInterval(() => {
                        if (stompClient.connected) {
                            stompClient.send(`/app/session/${sessionId}/heartbeat`, {}, JSON.stringify({ username: currentUser }));
                        }
                    }, 60000);

                    // Discover ongoing transfers from other peers in the room
                    stompClient.send(`/topic/session/${sessionId}/transfer-activity`, {}, JSON.stringify({ type: 'INQUIRE' }));
                    setTimeout(() => {
                        if (isMounted && syncFilesWithServerRef.current) syncFilesWithServerRef.current(stompClient, "WebSocket initialization connect()");
                    }, 500);

                    // Synchronize File Ownership for Content-Aware Mesh
                    db.getAllFilesMetadata().then(files => {
                        if (isMounted && stompClient.connected) {
                            stompClient.send(`/app/session/${sessionId}/sync-ownership`, {}, JSON.stringify({
                                username: currentUser,
                                files: files.map(f => ({ fileId: f.fileId, totalChunks: f.totalChunks }))
                            }));
                        }
                    });

                    // 1. Presence Listener
                    stompClient.subscribe(`/topic/session/${sessionId}/presence`, (message) => {
                        const payload = message.body;
                        if (payload === "SESSION_TERMINATED") {
                            toast.error("Session ended by trainer.", { duration: 5000 });
                            navigateRef.current('/dashboard'); 
                        } else {
                            setNotifications((prev) => [...prev, payload]);

                            // Reconnect / clean up WebRTC connections on member updates
                            if (isLocalRef.current && webrtcManagerRef.current) {
                                // If a user leaves, clean up any stale WebRTC connections and delete their files
                                if (payload.includes(" has left the session.")) {
                                    const parts = payload.split(" has left the session.");
                                    if (parts.length > 0) {
                                        const leftUser = parts[0].trim();
                                        if (isLocalRef.current && webrtcManagerRef.current) {
                                            webrtcManagerRef.current.closeConnection(leftUser);
                                        }
                                        if (deleteLeftUserFilesRef.current) deleteLeftUserFilesRef.current(leftUser);

                                         // Prevent deadlocks if the user was actively transmitting
                                         db.getAllFilesMetadata().then(allFilesMeta => {
                                              allFilesMeta.filter(f => f.sender === leftUser).forEach(f => {
                                                  activeTransfersRef.current.delete(f.fileId);
                                                  transitionToRecovering(f.fileId, currentUser, false);
                                              });
                                              
                                              activeUploadKeysRef.current.forEach((val, key) => {
                                                  if (key.endsWith(`_${leftUser}`)) {
                                                      const [fileId] = key.split('_');
                                                      transitionToRecovering(fileId, leftUser, true);
                                                  }
                                              });
                                              
                                              if (activeTransfersRef.current.size === 0) {
                                                  if (syncFilesWithServerRef.current) syncFilesWithServerRef.current(stompClient);
                                              }
                                         }).catch(e => console.error("Error cleaning up left user active transfers:", e));
                                    }
                                }
                            }
                        }
                    });
                    // 1.5. Topology Routing Listener (Phase 2 Mesh Router)
                    stompClient.subscribe(`/topic/session/${sessionId}/topology/${currentUser}`, (message) => {
                        const payload = JSON.parse(message.body);
                        console.log("[RTC_TRACE] Topology routing event received (ASSIGN_PEERS):", payload);
                        if (payload.type === 'ASSIGN_PEERS') {
                            console.log("Mesh Router Assigned Peers:", payload.targets);

                                                        // Reconcile topology incrementally via connection lifecycle manager
                            if (isLocal && webrtcManagerRef.current) {
                                webrtcManagerRef.current.reconcileTopology(payload.targets || []);
                            }
                        }
                    });

                    // 2. Chat Listener
                    stompClient.subscribe(`/topic/session/${sessionId}/chat`, (message) => {
                        setChatMessages((prev) => [...prev, JSON.parse(message.body)]);
                    });

                    // 3. File Relay Listener
                    stompClient.subscribe(`/topic/session/${sessionId}/file-stream`, async (message) => {
                        if (handleIncomingFileChunkRef.current) handleIncomingFileChunkRef.current(JSON.parse(message.body));
                    });

                    // Phase 5: Self-Healing DAG Chunk Recovery Listener
                    stompClient.subscribe(`/topic/session/${sessionId}/request-chunks`, async (message) => {
                        const payload = JSON.parse(message.body);
                        if (!isLocal || !webrtcManagerRef.current || payload.requester === currentUser) return;

                        const fileMeta = await db.getFileMetadata(payload.fileId);
                        if (!fileMeta) return;

                        // Only the original sender processes the root STOMP request to start the DAG search
                        if (fileMeta.sender !== currentUser) return;

                        console.log(`Original Sender received STOMP request for missing chunks for ${payload.fileId}`);
                        const missingInDB = [];
                        for (const chunkIndex of payload.missingChunks) {
                            const chunkRecord = await db.getFileChunk(payload.fileId, chunkIndex);
                            if (chunkRecord && chunkRecord.data) {
                                const packed = packBinaryChunk(
                                    payload.fileId,
                                    fileMeta.sender,
                                    chunkIndex,
                                    fileMeta.totalChunks,
                                    fileMeta.fileSize || 0,
                                    chunkRecord.data
                                );
                                webrtcManagerRef.current.sendDataToPeer(null, packed);
                                console.log(`Phase 5: Original Sender resent recovered chunk ${chunkIndex} for ${payload.fileId}`);
                            } else {
                                missingInDB.push(chunkIndex);
                            }
                        }

                        if (missingInDB.length > 0) {
                            // Sender lacks the chunk. Initiate MESH_CHUNK_REQUEST DAG Backtracking
                            const activePeers = Object.keys(webrtcManagerRef.current.peers);
                            if (activePeers.length === 0) {
                                stompClient.send(`/app/session/${sessionId}/chunk-error`, {}, JSON.stringify({
                                    fileId: payload.fileId,
                                    requester: payload.requester,
                                    type: 'SENDER_NOT_FOUND',
                                    error: 'Original sender lost the file and has no mesh peers to query.'
                                }));
                                return;
                            }

                            console.log(`Original Sender lost chunks. Initiating DAG backtrack search for chunks:`, missingInDB);
                            const searchKey = `${payload.fileId}_${missingInDB.join(',')}`;
                            pendingMeshSearchesRef.current.set(searchKey, {
                                originalRequester: payload.requester,
                                peersRemaining: new Set(activePeers),
                                missingChunks: missingInDB
                            });

                            activePeers.forEach(peer => {
                                webrtcManagerRef.current.sendDataToPeer(peer, {
                                    type: 'MESH_CHUNK_REQUEST',
                                    fileId: payload.fileId,
                                    missingChunks: missingInDB,
                                    requester: currentUser,
                                    visited: [currentUser],
                                    searchKey: searchKey
                                });
                            });
                        }
                    });

                    // Edge Case 3: Chunk Error Corrupted File Listener
                    stompClient.subscribe(`/topic/session/${sessionId}/chunk-error`, (message) => {
                        const errorMsg = JSON.parse(message.body);
                        if (errorMsg.requester === currentUser) {
                            toast.error(`Transfer Corrupted: ${errorMsg.error}`);
                            cleanupDownloadState(errorMsg.fileId);
                            db.deleteFileRecord(errorMsg.fileId).catch(()=>console.error('Failed to cleanup corrupted file'));
                        }
                    });

                    // 4. Transfer Commands Listener
                    stompClient.subscribe(`/topic/session/${sessionId}/transfer-commands/${currentUser}`, async (message) => {
                        const cmd = JSON.parse(message.body);
                        console.log("[RTC_TRACE] Received transfer command signal:", { cmd, meta: getTransferDiagnosticMeta() });
                        
                        if (cmd.type === 'REPLICATE_REQUEST') {
                            console.log(`[REPLICATION] Received REPLICATE_REQUEST for file ${cmd.fileId}`);
                            initiateTransferRequest([{
                                fileId: cmd.fileId,
                                sender: "ReplicationSystem", // Logic will map to best owner anyway
                                startChunkIndex: 0
                            }]);
                            return;
                        }

                        if (cmd.type === 'TRANSFER_REQUEST' && (cmd.sender === currentUser || cmd.routedSender === currentUser)) {
                            const transferKey = `${cmd.fileId}_${cmd.requester}`;
                            if (activeUploadKeysRef.current.has(transferKey)) {
                                console.log(`[RTC_TRACE] Duplicate TRANSFER_REQUEST ignored for key: ${transferKey}`);
                                return;
                            }
                            activeUploadKeysRef.current.add(transferKey);

                            toast(`Transmission requested for "${cmd.fileId}" by @${cmd.requester}...`);

                            // Legacy signaling removed. Rely entirely on the backend ASSIGN_PEERS loop to handle disconnected targets.

                            let uploadObj = activeUploadsRef.current[cmd.fileId];
                            if (!uploadObj) {
                                // Reconstruct File reference from local IndexedDB if missing (e.g. after page reload)
                                const localMetadata = await db.getFileMetadata(cmd.fileId);
                                const localBlobInfo = await db.getFileBlob(cmd.fileId);
                                if (localMetadata && localBlobInfo && localBlobInfo.blob && localMetadata.status === 'completed') {
                                    activeUploadsRef.current[cmd.fileId] = {
                                        file: new File([localBlobInfo.blob], localMetadata.fileName, { type: localMetadata.fileType }),
                                        aborted: false,
                                        reader: null
                                    };
                                }
                            }

                            if (activeUploadCountRef.current > 0) {
                                const exists = uploadQueueRef.current.some(q => q.fileId === cmd.fileId && q.requester === cmd.requester);
                                if (!exists) uploadQueueRef.current.push(cmd);

                                console.log("[RTC_TRACE] Sending WAIT_SIGNAL:", { fileId: cmd.fileId, requester: cmd.requester, sender: currentUser, meta: getTransferDiagnosticMeta() });
                                stompClient.send(`/topic/session/${sessionId}/transfer-commands/${cmd.requester}`, {}, JSON.stringify({
                                    type: 'WAIT_SIGNAL',
                                    fileId: cmd.fileId,
                                    requester: cmd.requester,
                                    sender: currentUser
                                }));
                            } else {
                                if (processQueueRef.current) processQueueRef.current(cmd);
                            }
                        }
                        else if (cmd.type === 'WAIT_SIGNAL' && cmd.requester === currentUser) {
                            const downloadKey = `${cmd.fileId}_${currentUser}`;
                            transferLifecycleRef.current.set(downloadKey, 'queued');
                            setTransferStatuses(prev => ({ ...prev, [cmd.fileId]: 'Queued (Sender Busy)' }));
                        }
                        else if (cmd.type === 'READY_SIGNAL' && cmd.requester === currentUser) {
                            const downloadKey = `${cmd.fileId}_${currentUser}`;
                            // If we are already downloading this file, ignore duplicate READY_SIGNAL
                            if (activeDownloadCountRef.current > 0) {
                                const currentIncoming = Object.keys(incomingTransfers).includes(cmd.fileId) || transferStatuses[cmd.fileId] === 'Downloading';
                                if (currentIncoming) {
                                    console.log(`[RTC_TRACE] Ignored duplicate READY_SIGNAL for ongoing transfer: ${downloadKey}`);
                                    return;
                                }

                                if (sentBusySignalsRef.current.has(cmd.fileId)) {
                                    console.log(`[RTC_TRACE] Suppressed repeated BUSY_SIGNAL for fileId: ${cmd.fileId}`);
                                    return;
                                }
                                sentBusySignalsRef.current.add(cmd.fileId);

                                console.log("[RTC_TRACE] Sending BUSY_SIGNAL:", { fileId: cmd.fileId, targetSocketId: cmd.targetSocketId, requester: currentUser, sender: cmd.sender, meta: getTransferDiagnosticMeta() });
                                stompClient.send(`/topic/session/${sessionId}/transfer-commands/${cmd.sender}`, {}, JSON.stringify({
                                    type: 'BUSY_SIGNAL',
                                    fileId: cmd.fileId,
                                    targetSocketId: cmd.targetSocketId,
                                    requester: currentUser,
                                    sender: cmd.sender
                                }));
                            } else {
                                transferLifecycleRef.current.set(downloadKey, 'path-verifying');
                                activeDownloadCountRef.current = 1;
                                setTransferStatuses(prev => ({ ...prev, [cmd.fileId]: 'Downloading' }));
                                console.log("[RTC_TRACE] Sending TRANSFER_CONFIRMED:", { fileId: cmd.fileId, targetSocketId: cmd.targetSocketId, requester: currentUser, startChunkIndex: cmd.startChunkIndex, sender: cmd.sender, meta: getTransferDiagnosticMeta() });
                                stompClient.send(`/topic/session/${sessionId}/transfer-commands/${cmd.sender}`, {}, JSON.stringify({
                                    type: 'TRANSFER_CONFIRMED',
                                    fileId: cmd.fileId,
                                    targetSocketId: cmd.targetSocketId,
                                    requester: currentUser,
                                    startChunkIndex: cmd.startChunkIndex,
                                    sender: cmd.sender
                                }));
                            }
                        }
                        else if (cmd.type === 'BUSY_SIGNAL' && cmd.sender === currentUser) {
                            const timeoutId = pendingRequestsRef.current[`${cmd.fileId}_sender`];
                            if (timeoutId) {
                                clearTimeout(timeoutId);
                                delete pendingRequestsRef.current[`${cmd.fileId}_sender`];
                            }

                            uploadQueueRef.current.push(cmd);
                            activeUploadCountRef.current = 0;
                            if (processQueueRef.current) processQueueRef.current();
                        }
                        else if (cmd.type === 'TRANSFER_CONFIRMED' && cmd.sender === currentUser) {
                            const uploadKey = cmd.targetSocketId ? `${cmd.fileId}_${cmd.targetSocketId}` : `${cmd.fileId}_${cmd.requester}`;
                            const isAlreadyUploading = !!activeUploadsRef.current[uploadKey] || pendingTransfersRef.current.has(cmd.fileId);
                            if (isAlreadyUploading) {
                                console.log(`[RTC_TRACE] Ignored duplicate TRANSFER_CONFIRMED for uploadKey: ${uploadKey}`);
                                return;
                            }

                            const transferKey = `${cmd.fileId}_${cmd.requester}`;
                            transferLifecycleRef.current.set(transferKey, 'path-verifying');

                            if (pendingRequestsRef.current[`${cmd.fileId}_sender`]) {
                                clearTimeout(pendingRequestsRef.current[`${cmd.fileId}_sender`]);
                                delete pendingRequestsRef.current[`${cmd.fileId}_sender`];
                            }

                            // Pre-Flight Path Verification Queue
                            pendingTransfersRef.current.set(cmd.fileId, {
                                fileId: cmd.fileId,
                                targetSocketId: cmd.targetSocketId,
                                requester: cmd.requester,
                                targetUser: cmd.requester,
                                startChunkIndex: cmd.startChunkIndex
                            });

                            console.log("[RTC_TRACE] Initiating verify-path verification check:", {
                                sender: currentUser,
                                target: cmd.requester,
                                fileId: cmd.fileId,
                                meta: getTransferDiagnosticMeta()
                            });
                            stompClient.send(`/app/session/${sessionId}/verify-path`, {}, JSON.stringify({
                                sender: currentUser,
                                target: cmd.requester,
                                fileId: cmd.fileId
                            }));
                        }
                    });

                    // Pre-Flight Path Verification Listener
                    stompClient.subscribe(`/topic/session/${sessionId}/path-verified/${currentUser}`, (message) => {
                        const payload = JSON.parse(message.body);
                        const pendingTransfer = pendingTransfersRef.current.get(payload.fileId);
                        console.log("[RTC_TRACE] Received path-verified status event:", { payload, meta: getTransferDiagnosticMeta() });

                        if (payload.status === 'PATH_VERIFIED') {
                            const timeoutId = pathRetryTimeoutsRef.current.get(payload.fileId);
                            if (timeoutId) {
                                clearTimeout(timeoutId);
                                pathRetryTimeoutsRef.current.delete(payload.fileId);
                            }
                            if (pendingTransfer) {
                                pendingTransfersRef.current.delete(payload.fileId);
                                if (streamFileFromChunkRef.current) streamFileFromChunkRef.current(payload.fileId, pendingTransfer.startChunkIndex || 0, pendingTransfer.targetSocketId, pendingTransfer.requester, null, payload.routingPath);
                            }
                        } else if (payload.status === 'PATH_PENDING') {
                            toast("Establishing optimal mesh path...");
                            if (pendingTransfer && !pathRetryTimeoutsRef.current.has(payload.fileId)) {
                                const timeoutId = setTimeout(() => {
                                    pathRetryTimeoutsRef.current.delete(payload.fileId);
                                    if (pendingTransfersRef.current.has(payload.fileId) && stompClientRef.current && stompClientRef.current.connected) {
                                        stompClientRef.current.send(`/app/session/${sessionId}/verify-path`, {}, JSON.stringify({
                                            sender: currentUser,
                                            target: pendingTransfer.targetUser,
                                            fileId: payload.fileId
                                        }));
                                    }
                                }, 3000);
                                pathRetryTimeoutsRef.current.set(payload.fileId, timeoutId);
                            }
                        }
                    });

                    // 5. Transfer Status Listener
                    stompClient.subscribe(`/topic/session/${sessionId}/transfers`, async (message) => {
                        const status = JSON.parse(message.body);
                        if (status.type === 'QUEUE_IDLE') {
                            toast("WebRTC queue is idle. Syncing files...");
                            if (syncFilesWithServerRef.current) syncFilesWithServerRef.current(stompClient, "QUEUE_IDLE event");
                        }
                    });

                    // 6. Transfer Activity Listener
                    stompClient.subscribe(`/topic/session/${sessionId}/transfer-activity`, (message) => {
                        const activity = JSON.parse(message.body);
                        if (activity.type === 'START') {
                            activeTransfersRef.current.add(activity.fileId);
                        } else if (activity.type === 'END') {
                            const wasActive = activeTransfersRef.current.has(activity.fileId);
                            activeTransfersRef.current.delete(activity.fileId);
                            if (incomingTransfersRef.current[activity.fileId]) {
                                activeDownloadCountRef.current = 0;
                                setTransferStatuses(prev => {
                                    const next = { ...prev };
                                    delete next[activity.fileId];
                                    return next;
                                });
                            }
                            if (wasActive && activeTransfersRef.current.size === 0) {
                                toast("Session idle.");
                            }
                        } else if (activity.type === 'INQUIRE') {
                            Object.keys(activeUploadsRef.current).forEach(key => {
                                const upload = activeUploadsRef.current[key];
                                if (upload && !upload.aborted) {
                                    const baseFileId = key.split('_')[0];
                                    stompClient.send(`/topic/session/${sessionId}/transfer-activity`, {}, JSON.stringify({
                                        type: 'REPORT',
                                        fileId: baseFileId
                                    }));
                                }
                            });
                        } else if (activity.type === 'REPORT') {
                            activeTransfersRef.current.add(activity.fileId);
                                                } else if (activity.type === 'CONFIRM_ALL_RECEIVED') {
                            activeTransfersRef.current.clear();
                            toast.success(`All files received by @${activity.receiver}. WebRTC is now idle.`);
                        }
                    });
                },
                () => {
                    console.log("[RTC_TRACE] STOMP disconnect / connection loss callback triggered.");
                    setIsConnected(false);
                    if (heartbeatInterval) clearInterval(heartbeatInterval);
                    
                    let hasActivePinned = false;
                    if (webrtcManagerRef.current) {
                        if (webrtcManagerRef.current.peers) {
                            Object.keys(webrtcManagerRef.current.peers).forEach(peer => {
                                if (webrtcManagerRef.current.callbacks.isPeerConnectionPinned(peer)) {
                                    hasActivePinned = true;
                                }
                            });
                        }
                    }

                    if (!hasActivePinned) {
                        if (webrtcManagerRef.current) {
                            webrtcManagerRef.current.teardown("STOMP connection loss");
                            webrtcManagerRef.current = null;
                            setActivePeers([]);
                        }
                        activeUploadKeysRef.current.clear();
                        activeDownloadKeysRef.current.clear();
                        sentStartEventsRef.current.clear();
                        transferLifecycleRef.current.clear();
                        sentBusySignalsRef.current.clear();
                        pathRetryTimeoutsRef.current.forEach(t => clearTimeout(t));
                        pathRetryTimeoutsRef.current.clear();
                        activeActivityStartEventsRef.current.clear();
                    } else {
                        console.log("[RTC_TRACE] STOMP disconnected, but WebRTC has active pinned transfers. Retaining WebRTCManager.");
                    }

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
            const guestParam = guestUsernameRef.current ? `?guestUsername=${encodeURIComponent(guestUsernameRef.current)}` : '';
            fetch(`${apiUrl}/sessions/leave/${sessionId}${guestParam}`, {
                method: 'POST', headers: token ? { 'Authorization': `Bearer ${token}` } : {}, keepalive: true 
            }).catch(() => {});
        };
        window.addEventListener('beforeunload', handleUnload);

        return () => {
            console.log("[RTC_TRACE] WebSocket/Connect useEffect cleanup running. isLeaving:", isLeavingRef.current);
            isMounted = false;
            window.removeEventListener('beforeunload', handleUnload);
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            if (stompClientRef.current) {
                if (stompClientRef.current.connected) stompClientRef.current.disconnect();
                else socket.close(); 
            }
            if (!isLeavingRef.current) {
                const guestParam = guestUsernameRef.current ? `?guestUsername=${encodeURIComponent(guestUsernameRef.current)}` : '';
                api.post(`/sessions/leave/${sessionId}${guestParam}`).catch(() => {});
            }
            // Removed watchdog clearings
        };
    }, [sessionId, currentUser]);

        useEffect(() => {
        console.log("[RTC_TRACE] WebRTC effect mounted/re-run. isLocal:", isLocal, "isConnected:", isConnected);
        if (!currentUserRef.current) return;

        if (isLocal && isConnected && stompClientRef.current) {
            // Remove the isHost variable passing
            const webrtcManager = new WebRTCManager(sessionId, currentUserRef.current, stompClientRef.current, {
                onMessage: (parsed) => {
                    if (parsed.type === 'MESH_CHUNK_REQUEST') {
                        const handleMeshRequest = async () => {
                            const fileMeta = await db.getFileMetadata(parsed.fileId);
                            const missingInDB = [];
                            
                            if (fileMeta) {
                                for (const chunkIndex of parsed.missingChunks) {
                                    const chunkRecord = await db.getFileChunk(parsed.fileId, chunkIndex);
                                    if (chunkRecord && chunkRecord.data) {
                                        const packed = packBinaryChunk(
                                            parsed.fileId, 
                                            fileMeta.sender, 
                                            chunkIndex, 
                                            fileMeta.totalChunks, 
                                            fileMeta.fileSize || 0, 
                                            chunkRecord.data
                                        );
                                        webrtcManagerRef.current.sendDataToPeer(null, packed);
                                        console.log(`Phase 5: Mesh peer ${currentUserRef.current} served recovered chunk ${chunkIndex} for ${parsed.fileId}`);
                                    } else {
                                        missingInDB.push(chunkIndex);
                                    }
                                }
                            } else {
                                missingInDB.push(...parsed.missingChunks);
                            }

                            if (missingInDB.length > 0) {
                                const activePeers = Object.keys(webrtcManagerRef.current.peers).filter(p => !parsed.visited.includes(p));
                                if (activePeers.length === 0) {
                                    webrtcManagerRef.current.sendDataToPeer(parsed.sender, {
                                        type: 'MESH_CHUNK_NOT_FOUND',
                                        searchKey: parsed.searchKey,
                                        peer: currentUserRef.current
                                    });
                                    return;
                                }

                                pendingMeshSearchesRef.current.set(parsed.searchKey, {
                                    originalRequester: parsed.requester,
                                    parentPeer: parsed.sender,
                                    peersRemaining: new Set(activePeers),
                                    missingChunks: missingInDB
                                });

                                const nextVisited = [...parsed.visited, currentUserRef.current];
                                activePeers.forEach(peer => {
                                    webrtcManagerRef.current.sendDataToPeer(peer, {
                                        type: 'MESH_CHUNK_REQUEST',
                                        fileId: parsed.fileId,
                                        missingChunks: missingInDB,
                                        requester: parsed.requester,
                                        visited: nextVisited,
                                        searchKey: parsed.searchKey
                                    });
                                });
                            }
                        };
                        handleMeshRequest();
                    } else if (parsed.type === 'MESH_CHUNK_NOT_FOUND') {
                        const searchState = pendingMeshSearchesRef.current.get(parsed.searchKey);
                        if (searchState) {
                            searchState.peersRemaining.delete(parsed.peer);
                            if (searchState.peersRemaining.size === 0) {
                                pendingMeshSearchesRef.current.delete(parsed.searchKey);
                                if (searchState.parentPeer) {
                                    webrtcManagerRef.current.sendDataToPeer(searchState.parentPeer, {
                                        type: 'MESH_CHUNK_NOT_FOUND',
                                        searchKey: parsed.searchKey,
                                        peer: currentUserRef.current
                                    });
                                } else {
                                    const [fileId] = parsed.searchKey.split('_');
                                    if (stompClientRef.current && stompClientRef.current.connected) {
                                        stompClientRef.current.send(`/app/session/${sessionId}/chunk-error`, {}, JSON.stringify({
                                            fileId: fileId,
                                            requester: searchState.originalRequester,
                                            type: 'DAG_EXHAUSTED',
                                            error: 'Requested chunks were not found anywhere in the DAG mesh.'
                                        }));
                                    }
                                }
                            }
                        }
                    } else if (parsed.content) {
                        setChatMessages(prev => [...prev, parsed]);
                    }
                },
                onFileChunk: (parsed) => { if (handleIncomingFileChunkRef.current) handleIncomingFileChunkRef.current(parsed); },
                onPeerConnected: (remoteUsername) => {
                    console.log(`WebRTC peer connected: ${remoteUsername}. Triggering sync.`);
                    if (syncFilesWithServerRef.current) syncFilesWithServerRef.current(stompClientRef.current, "onPeerConnected callback for remote peer: " + remoteUsername);
                },
                onPeerConnectionDropped: (remoteUsername) => {
                    setActivePeers(prev => prev.filter(u => u !== remoteUsername));
                    console.warn(`WebRTC peer dropped: ${remoteUsername}. Reporting to mesh router for self-healing.`);
                    if (stompClientRef.current && stompClientRef.current.connected) {
                        stompClientRef.current.send(`/app/session/${sessionId}/topology/report-drop`, {}, JSON.stringify({ 
                            reportingUser: currentUserRef.current,
                            droppedUser: remoteUsername 
                        }));
                    }
                    if (handleTransitionTransfersToRecoveringRef.current) {
                        handleTransitionTransfersToRecoveringRef.current(remoteUsername);
                    }
                },
                onDataChannelOpen: (remoteUsername) => {
                    setActivePeers(prev => {
                        if (prev.includes(remoteUsername)) return prev;
                        return [...prev, remoteUsername];
                    });
                    if (stompClientRef.current && stompClientRef.current.connected) {
                        console.log(`[RTC_TRACE] Reporting topology open for targetUser: ${remoteUsername}`);
                        stompClientRef.current.send(`/app/session/${sessionId}/topology/report-open`, {}, JSON.stringify({ 
                            reportingUser: currentUserRef.current,
                            targetUser: remoteUsername 
                        }));
                        
                        // Auto-retry pending paths
                        pendingTransfersRef.current.forEach((transfer, fileId) => {
                            stompClientRef.current.send(`/app/session/${sessionId}/verify-path`, {}, JSON.stringify({
                                sender: currentUserRef.current,
                                target: transfer.targetUser,
                                fileId: fileId
                            }));
                        });

                        // Protocol-compliant automatic resumption of recovering downloads
                        Object.keys(incomingTransfersRef.current).forEach(async (fileId) => {
                            const transferKey = `${fileId}_${currentUserRef.current}`;
                            if (transferLifecycleRef.current.get(transferKey) === 'recovering') {
                                const file = incomingTransfersRef.current[fileId] || sharedFilesRef.current.find(f => f.fileId === fileId);
                                if (file && file.sender === remoteUsername) {
                                    console.log(`[RTC_TRACE] Auto-resuming download for file: ${fileId} from peer: ${remoteUsername} via chunk recovery`);
                                    
                                    // Transition state back to streaming
                                    transferLifecycleRef.current.set(transferKey, 'streaming');
                                    setTransferStatuses(prev => ({ ...prev, [fileId]: 'Resuming...' }));

                                    const fileMeta = await db.getFileMetadata(fileId);
                                    if (fileMeta && fileMeta.totalChunks) {
                                        const presentChunks = new Set();
                                        const allChunks = await db.getAllFileChunks(fileId);
                                        allChunks.forEach(c => presentChunks.add(c.chunkIndex));
                                        
                                        const missingChunks = [];
                                        for (let i = 0; i < fileMeta.totalChunks; i++) {
                                            if (!presentChunks.has(i)) {
                                                missingChunks.push(i);
                                            }
                                        }
                                        
                                        if (missingChunks.length > 0 && stompClientRef.current && stompClientRef.current.connected) {
                                            stompClientRef.current.send(`/app/session/${sessionId}/request-chunks`, {}, JSON.stringify({
                                                fileId: fileId,
                                                requester: currentUserRef.current,
                                                missingChunks: missingChunks
                                            }));
                                            console.log(`[RTC_TRACE] Sent request-chunks for missing chunks: ${missingChunks.length}`);
                                        }
                                    }
                                }
                            }
                        });
                    }
                },
                onDataChannelClosed: (remoteUsername) => {
                    setActivePeers(prev => prev.filter(u => u !== remoteUsername));
                    if (stompClientRef.current && stompClientRef.current.connected) {
                        console.log(`[RTC_TRACE] Reporting topology close for targetUser: ${remoteUsername}`);
                        stompClientRef.current.send(`/app/session/${sessionId}/topology/report-close`, {}, JSON.stringify({ 
                            reportingUser: currentUserRef.current,
                            targetUser: remoteUsername 
                        }));
                    }
                    if (handleTransitionTransfersToRecoveringRef.current) {
                        handleTransitionTransfersToRecoveringRef.current(remoteUsername);
                    }
                },
                onFallbackRequired: () => {
                    toast.warn("WebRTC connection unstable. Retrying connection...");
                },
                isPeerConnectionPinned: (peerUsername) => {
                    // Check active/queued uploads
                    let isPinned = false;
                    activeUploadKeysRef.current.forEach((val, key) => {
                        if (key.endsWith(`_${peerUsername}`)) {
                            const [fileId] = key.split('_');
                            const transferKey = `${fileId}_${peerUsername}`;
                            const state = transferLifecycleRef.current.get(transferKey);
                            if (state && ['queued', 'handshaking', 'path-verifying', 'streaming', 'recovering'].includes(state)) {
                                isPinned = true;
                            }
                        }
                    });
                    if (isPinned) return true;

                    // Check active/queued downloads
                    activeDownloadKeysRef.current.forEach((val, key) => {
                        const [fileId] = key.split('_');
                        const transferKey = `${fileId}_${currentUserRef.current}`;
                        const state = transferLifecycleRef.current.get(transferKey);
                        if (state && ['queued', 'handshaking', 'path-verifying', 'streaming', 'recovering'].includes(state)) {
                            const file = incomingTransfersRef.current[fileId] || sharedFilesRef.current.find(f => f.fileId === fileId);
                            if (file && file.sender === peerUsername) {
                                isPinned = true;
                            }
                        }
                    });
                    if (isPinned) return true;

                    // Check if waiting for chunks to assemble
                    pendingAssembliesRef.current.forEach(fileId => {
                        const file = incomingTransfersRef.current[fileId] || sharedFilesRef.current.find(f => f.fileId === fileId);
                        if (file && file.sender === peerUsername) {
                            isPinned = true;
                        }
                    });
                    if (isPinned) return true;

                    // Check if pre-flight path verification is active
                    pendingTransfersRef.current.forEach(transfer => {
                        if (transfer.targetUser === peerUsername || transfer.requester === peerUsername) {
                            isPinned = true;
                        }
                    });

                    return isPinned;
                }
            });
            webrtcManagerRef.current = webrtcManager;
            
            // Request Phase 2 Mesh Routing assignment ONLY after the manager is fully mounted
            stompClientRef.current.send(`/app/session/${sessionId}/topology/request`, {}, JSON.stringify({ username: currentUserRef.current }));

            return () => {
                console.log("[RTC_TRACE] WebRTC effect cleanup running.");
                webrtcManager.teardown("React effect unmount/cleanup callback");
                webrtcManagerRef.current = null;
                setActivePeers([]);
                activeUploadKeysRef.current.clear();
                activeDownloadKeysRef.current.clear();
                sentStartEventsRef.current.clear();
                transferLifecycleRef.current.clear();
                sentBusySignalsRef.current.clear();
                pathRetryTimeoutsRef.current.forEach(t => clearTimeout(t));
                pathRetryTimeoutsRef.current.clear();
            };
        }
    }, [isLocal, isConnected, sessionId]);

    const handleLeaveSession = useCallback(async () => {
        if (isLeaving) return;
        setIsLeaving(true);
        toast('Disconnecting and cleaning up...');
        try {
            const guestParam = guestUsername ? `?guestUsername=${encodeURIComponent(guestUsername)}` : '';
            await api.post(`/sessions/leave/${sessionId}${guestParam}`);
            // Cleanup indexedDB to save user space
            await db.clearSessionFiles();
        }
        catch { /* ignore */ } finally { navigate('/dashboard'); }
    }, [isLeaving, sessionId, navigate, guestUsername]);

    const handleSendMessage = (messageText) => {
        if (!messageText.trim() || !isConnected) return;

        const payload = {
            sender: currentUser,
            content: messageText
        };

        const connType = connectionTypeRef.current;
        if (connType === 'webrtc' && webrtcManagerRef.current) {
            webrtcManagerRef.current.sendData(payload);
            setChatMessages((prev) => [...prev, payload]);
        } else if (stompClientRef.current && stompClientRef.current.connected) {
            stompClientRef.current.send(`/app/session/${sessionId}/chat.send`, {}, JSON.stringify(payload));
        }
    };

    const handleFileUpload = async (file) => {
        if (!file || !stompClientRef.current) return;

        const fileId = Math.random().toString(36).substring(7);
        const connType = connectionTypeRef.current;
        const isWebRTC = connType === 'webrtc' && webrtcManagerRef.current;
        const CHUNK_SIZE = isWebRTC ? 256000 : 65536; // 250KB for WebRTC, 64KB for STOMP
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        const metadata = { fileId, fileName: file.name, fileType: file.type, fileSize: file.size, sender: currentUser, totalChunks };

        setUploadTransfers(prev => ({
            ...prev,
            [fileId]: { fileId, fileName: file.name, fileSize: file.size, progress: 0 }
        }));

        // Save immediately to DB as completed since we are the sender
        await db.saveFileMetadata({ ...metadata, status: 'completed' });
        await db.saveFileBlob(fileId, file);

        activeUploadsRef.current[fileId] = { file, aborted: false, reader: null };

        // Broadcast START event
        // 1. Always save metadata to DB by sending START via STOMP
        if (stompClientRef.current && stompClientRef.current.connected) {
            stompClientRef.current.send(`/app/session/${sessionId}/stream`, {}, JSON.stringify({ type: 'START', ...metadata }));

            // Trigger Content-Aware Mesh Replication
            stompClientRef.current.send(`/app/session/${sessionId}/register-owner`, {}, JSON.stringify({
                username: currentUser,
                fileId: metadata.fileId,
                fileName: metadata.fileName,
                fileType: metadata.fileType,
                fileSize: metadata.fileSize,
                totalChunks: metadata.totalChunks,
                status: "COMPLETE"
            }));
        }

        // 2. Also broadcast START via WebRTC if we are in WebRTC mode
        if (isWebRTC) {
            webrtcManagerRef.current.sendData({ streamData: true, type: 'START', ...metadata });
        }

        const fileUrl = URL.createObjectURL(file);
        setSharedFiles((prev) => {
            if (prev.some(f => f.fileId === metadata.fileId)) return prev;
            return [...prev, { ...metadata, url: fileUrl }];
        });

        streamFileFromChunk(fileId, 0);
    };

    return {
        user, currentUser, isConnected, isLeaving,
        notifications, chatMessages, sharedFiles, incomingTransfers,
        uploadTransfers, chatEndRef,
        handleSendMessage, handleFileUpload, handleLeaveSession,
        connectionError, handleRetryConnection,
        retrySyncFile, transferStatuses, activePeers
    };
};

