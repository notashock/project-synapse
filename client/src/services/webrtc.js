export class WebRTCManager {
    constructor(sessionId, username, stompClient, callbacks) {
        console.log("[RTC_TRACE] WebRTCManager instantiated:", { sessionId, username, stack: new Error().stack });
        this.sessionId = sessionId;
        this.username = username;
        this.stompClient = stompClient; 
        this.callbacks = callbacks; 
        this.peers = {}; 
        this.dataChannels = {}; 
        this.iceQueues = {}; // remoteUsername -> queue of candidates
        this.processedChunks = new Map(); // fileId -> Set of chunkIndexes
        this.forwardQueues = {}; // remoteUsername -> Array of ArrayBuffers
        this.deferredRemovals = new Set(); // Track pinned peers pending removal

        // Include public STUN servers to assist in NAT traversal/loopback while direct host connection is preferred
        this.configuration = { 
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ] 
        };
        
        this.fallbackTriggered = false;
        this.connectionTimeout = null;

        this.setupSignaling();

    }

    reconcileTopology(targets) {
        console.log(`[RTC_TRACE] Topology reconciliation initiated. Desired targets: [${targets.join(', ')}]`);
        const desiredPeers = new Set(targets);
        const currentPeers = Object.keys(this.peers);
        
        const peersToAdd = [];
        const peersToRemove = [];
        const peersToKeep = [];
        
        desiredPeers.forEach(peer => {
            const pc = this.peers[peer];
            if (pc && this.hasActiveConnection(pc)) {
                peersToKeep.push(peer);
            } else {
                peersToAdd.push(peer);
            }
        });
        
        currentPeers.forEach(peer => {
            if (!desiredPeers.has(peer)) {
                peersToRemove.push(peer);
            }
        });
        
        console.log("[RTC_TRACE] Topology reconciliation summary:", {
            currentPeers: currentPeers,
            desiredPeers: targets,
            peersToAdd: peersToAdd,
            peersToRemove: peersToRemove,
            peersToKeep: peersToKeep
        });
        
        if (peersToAdd.length === 0 && peersToRemove.length === 0) {
            console.log(`[RTC_TRACE] Ignoring duplicate ASSIGN_PEERS event. Topology unchanged. Targets: [${targets.join(', ')}]`);
            return;
        }

        // 1. Cancel any deferred removal if the peer is back in desired targets
        peersToKeep.forEach(peer => {
            if (this.deferredRemovals.has(peer)) {
                console.log(`[RTC_TRACE] Pinned peer ${peer} is back in the desired topology. Cancelling deferred removal.`);
                this.deferredRemovals.delete(peer);
            }
        });
        
        // 2. Process removals (check pinning)
        peersToRemove.forEach(peer => {
            const isPinned = this.callbacks.isPeerConnectionPinned && this.callbacks.isPeerConnectionPinned(peer);
            if (isPinned) {
                console.log(`[RTC_TRACE] Deferring removal of pinned peer connection: ${peer}`);
                this.deferredRemovals.add(peer);
            } else {
                console.log(`[RTC_TRACE] Closing connection to unpinned peer: ${peer}`);
                this.closeConnection(peer);
            }
        });
        
        // 3. Process additions
        peersToAdd.forEach(peer => {
            console.log(`[RTC_TRACE] Initiating connection to peer: ${peer}`);
            this.initiateConnection(peer);
        });
    }

    processDeferredRemovals() {
        console.log(`[RTC_TRACE] Processing deferred removals. Current deferred: [${Array.from(this.deferredRemovals).join(', ')}]`);
        
        // Use standard iteration to modify Set safely
        const toRemove = [];
        this.deferredRemovals.forEach(peer => {
            const isPinned = this.callbacks.isPeerConnectionPinned && this.callbacks.isPeerConnectionPinned(peer);
            if (!isPinned) {
                toRemove.push(peer);
            } else {
                console.log(`[RTC_TRACE] Pinned peer ${peer} is still active in transfers. Retention remains.`);
            }
        });

        toRemove.forEach(peer => {
            console.log(`[RTC_TRACE] Pinned peer ${peer} is no longer active in transfers. Executing deferred removal.`);
            this.deferredRemovals.delete(peer);
            this.closeConnection(peer);
        });
    }

    async initiateConnection(remoteUsername) {
        console.log(`[RTC_TRACE] initiateConnection() called for peer: ${remoteUsername}`);
        const existingPc = this.peers[remoteUsername];
        
        if (existingPc) {
            if (this.hasActiveConnection(existingPc)) {
                console.log(`[RTC_TRACE] Ignore duplicate createPeerConnection request for: ${remoteUsername} (Connection already active/healthy. State: ${existingPc.connectionState})`);
                return;
            }
            if (existingPc.isNegotiating) {
                console.log(`[RTC_TRACE] Ignore duplicate createPeerConnection request for: ${remoteUsername} (Connection is already negotiating)`);
                return;
            }
            if (existingPc.reconnectPending) {
                console.log(`[RTC_TRACE] Ignore duplicate createPeerConnection request for: ${remoteUsername} (Reconnect is already pending)`);
                return;
            }
        }
        
        await this.createPeerConnection(remoteUsername, true);
    }

    hasActiveConnection(pc) {
        if (!pc) return false;
        const state = pc.connectionState;
        const iceState = pc.iceConnectionState;
        return state === 'new' || state === 'connected' || state === 'connecting' || iceState === 'connected' || iceState === 'checking';
    }

    startConnectionTimer() {
        this.connectionTimeout = setTimeout(() => {
            if (!this.fallbackTriggered) {
                console.warn("WebRTC connection timed out. Triggering fallback.");
                this.triggerFallback();
            }
        }, 10000); // 10 second timeout for WebRTC
    }

    triggerFallback() {
        if (this.fallbackTriggered) return;
        this.fallbackTriggered = true;
        if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
        this.callbacks.onFallbackRequired();
    }

    getDetailedState() {
        const channels = {};
        for (const [user, channel] of Object.entries(this.dataChannels)) {
            channels[user] = channel.readyState;
        }
        return {
            peers: Object.keys(this.peers),
            channels: channels
        };
    }

    setupSignaling() {
        this.signalingSub = this.stompClient.subscribe(`/topic/session/${this.sessionId}/signal`, (msg) => {
            const data = JSON.parse(msg.body);
            
            // Ignore our own signals
            if (data.sender === this.username) return;

            // Ignore signals not targeted to us
            if (data.targetUsername && data.targetUsername !== this.username) return;

            this.handleSignal(data);
        });
    }

    sendSignal(data) {
        this.stompClient.send(`/app/session/${this.sessionId}/signal`, {}, JSON.stringify(data));
    }

    isLocalIP(candidateString) {
        // In local sharing sessions, all host candidates and STUN candidates are welcomed to maximize P2P success rate
        return true;
    }

    async handleSignal(data) {
        const remoteUser = data.sender;
        const polite = this.username < remoteUser; // Deterministic tie-breaker

        // 1. Handle ICE Candidate Racing
        if (data.type === 'candidate') {
            const pc = this.peers[remoteUser];
            if (!pc) {
                if (data.candidate && this.isLocalIP(data.candidate.candidate)) {
                    console.log(`Queued early candidate for user: ${remoteUser}`);
                    const candidate = new RTCIceCandidate(data.candidate);
                    this.iceQueues[remoteUser] = this.iceQueues[remoteUser] || [];
                    this.iceQueues[remoteUser].push(candidate);
                }
                return;
            }
            try {
                if (data.candidate && this.isLocalIP(data.candidate.candidate)) {
                    const candidate = new RTCIceCandidate(data.candidate);
                    if (pc.remoteDescription) {
                        await pc.addIceCandidate(candidate).catch(e => console.warn("Failed to add candidate:", e));
                    } else {
                        console.log(`Remote description not set yet; queuing candidate for ${remoteUser}`);
                        this.iceQueues[remoteUser] = this.iceQueues[remoteUser] || [];
                        this.iceQueues[remoteUser].push(candidate);
                    }
                }
            } catch (err) {
                console.error(`[RTC_TRACE] Error handling candidate signal from ${remoteUser}:`, err);
            }
            return;
        }

        // 2. Accept Inbound Offers (MESH_OFFER or offer)
        if (data.type === 'MESH_OFFER' || data.type === 'offer') {
            let pc = this.peers[remoteUser];
            
            // Check collision (glare)
            const collision = pc && (pc.signalingState !== "stable" || pc.makingOffer);
            
            const ignoreOffer = !polite && collision;
            if (pc) {
                pc.ignoreOffer = ignoreOffer;
            }
            
            if (ignoreOffer) {
                console.log(`[RTC_TRACE] Impolite glare collision resolution: Ignoring incoming offer from ${remoteUser}`);
                return;
            }
            
            if (collision && polite) {
                console.log(`[RTC_TRACE] Polite glare collision resolution: Rolling back local offer to apply remote offer from ${remoteUser}`);
                try {
                    await pc.setLocalDescription({ type: "rollback" });
                } catch (err) {
                    console.error(`[RTC_TRACE] Error during polite rollback for ${remoteUser}:`, err);
                }
            }
            
            if (!pc) {
                console.log(`Accepting inbound connection from: ${remoteUser}`);
                // Responder NEVER passes true for initiator
                pc = await this.createPeerConnection(remoteUser, false);
            }
            
            try {
                if (data.offer) {
                    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    this.sendSignal({ 
                        type: 'answer', 
                        answer: answer, 
                        sender: this.username, 
                        targetUsername: remoteUser 
                    });
                    
                    // Apply queued ICE candidates
                    if (this.iceQueues[remoteUser]) {
                        console.log(`Applying queued candidates for ${remoteUser}`);
                        for (const candidate of this.iceQueues[remoteUser]) {
                            await pc.addIceCandidate(candidate).catch(e => console.warn("Failed to add queued candidate:", e));
                        }
                        this.iceQueues[remoteUser] = [];
                    }
                } else if (data.type === 'MESH_OFFER') {
                    // Fallback poke handling if MESH_OFFER doesn't contain the SDP
                    await this.createPeerConnection(remoteUser, true);
                }
            } catch (e) {
                console.error("Failed to handle inbound offer:", e);
            }
            return;
        }

        // 3. Handle Answers
        if (data.type === 'answer') {
            const pc = this.peers[remoteUser];
            if (!pc) {
                console.warn(`Ignoring unhandled answer for unassigned peer:`, remoteUser);
                return;
            }
            
            try {
                console.log("Setting remote description (answer) from:", remoteUser);
                pc.isSettingRemoteAnswerPending = true;
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                pc.isSettingRemoteAnswerPending = false;
                
                // Apply queued ICE candidates
                if (this.iceQueues[remoteUser]) {
                    console.log(`Applying queued candidates for ${remoteUser}`);
                    for (const candidate of this.iceQueues[remoteUser]) {
                        await pc.addIceCandidate(candidate).catch(e => console.warn("Failed to add queued candidate:", e));
                    }
                    this.iceQueues[remoteUser] = [];
                }
            } catch (e) {
                console.error("Error handling answer:", e);
                pc.isSettingRemoteAnswerPending = false;
            }
            return;
        }
    }



    closeConnection(remoteUsername) {
        if (this.peers[remoteUsername]) {
            const pc = this.peers[remoteUsername];
            if (pc.handshakeTimeout) clearTimeout(pc.handshakeTimeout);
            try { pc.close(); } catch (e) {}
            delete this.peers[remoteUsername];
            delete this.dataChannels[remoteUsername];
            delete this.iceQueues[remoteUsername];
            this.deferredRemovals.delete(remoteUsername);
            console.log(`Explicitly closed and severed WebRTC connection for dropped user: ${remoteUsername}`);
            
            // Explicitly notify backend graph healer
            if (this.stompClient && this.stompClient.connected) {
                this.stompClient.send(`/app/session/${this.sessionId}/topology/report-drop`, {}, JSON.stringify({
                    reportingUser: this.username,
                    droppedUser: remoteUsername
                }));
            }
        }
    }

    async createPeerConnection(remoteUsername, isInitiator = false) {
        console.log(`[RTC_TRACE] createPeerConnection() called for peer: ${remoteUsername}, isInitiator: ${isInitiator}`);
        console.log("Creating RTCPeerConnection for remoteUsername:", remoteUsername, "initiator:", isInitiator);
        if (this.peers[remoteUsername]) {
            const oldPc = this.peers[remoteUsername];
            if (oldPc.handshakeTimeout) clearTimeout(oldPc.handshakeTimeout);
            try { oldPc.close(); } catch (e) { /* ignore */ }
        }
        const pc = new RTCPeerConnection(this.configuration);
        this.peers[remoteUsername] = pc;
        this.iceQueues[remoteUsername] = this.iceQueues[remoteUsername] || [];

        // Track lifecycle states for incremental reconciliation and race avoidance
        pc.isNegotiating = true;
        pc.reconnectPending = false;
        pc.makingOffer = false;
        pc.ignoreOffer = false;
        pc.isSettingRemoteAnswerPending = false;

        // Universal handshake timeout: every node polices its own dead connections
        pc.handshakeTimeout = setTimeout(() => {
            if (pc.connectionState !== 'connected') {
                console.warn(`[RTC_TRACE] Handshake timeout for ${remoteUsername}. Closing stale connection.`);
                pc.isNegotiating = false;
                this.closeConnection(remoteUsername);
            }
        }, 15000);

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`[RTC_TRACE] ICE Candidate generated for peer: ${remoteUsername}, candidate: ${event.candidate.candidate}`);
            }
            if (event.candidate && this.isLocalIP(event.candidate.candidate)) {
                this.sendSignal({ 
                    type: 'candidate', 
                    candidate: event.candidate, 
                    sender: this.username, 
                    targetUsername: remoteUsername
                });
            }
        };

        pc.onconnectionstatechange = () => {
            console.log(`[RTC_TRACE] RTCPeerConnection connectionState change for peer: ${remoteUsername} -> ${pc.connectionState}`);
            console.log(`WebRTC Connection state for ${remoteUsername}: ${pc.connectionState}`);
            if (pc.connectionState === 'connected') {
                console.log("WebRTC Connected securely over local network!");
                pc.isNegotiating = false;
                if (pc.handshakeTimeout) {
                    clearTimeout(pc.handshakeTimeout);
                    pc.handshakeTimeout = null;
                }
                if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
            } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                console.warn(`WebRTC connection state is ${pc.connectionState} for: ${remoteUsername}. Cleaning up stale connection.`);
                pc.isNegotiating = false;
                if (pc.handshakeTimeout) {
                    clearTimeout(pc.handshakeTimeout);
                    pc.handshakeTimeout = null;
                }
                try { pc.close(); } catch (e) { /* ignore */ }
                if (this.peers[remoteUsername] === pc) {
                    delete this.peers[remoteUsername];
                    delete this.dataChannels[remoteUsername];
                    // Trigger peer dropped callback for DAG self-healing
                    if (this.callbacks.onPeerConnectionDropped) {
                        this.callbacks.onPeerConnectionDropped(remoteUsername);
                    }
                }
            }
        };

        // Pure Asymmetrical Initiator Logic
        if (isInitiator) {
            console.log("Data Channel CREATED by initiator for:", remoteUsername);
            // Initiator creates the data channel
            const dc = pc.createDataChannel('synapse-data', { negotiated: false });
            this.setupDataChannel(dc, remoteUsername);
            
            try {
                pc.makingOffer = true;
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                this.sendSignal({ 
                    type: 'offer', 
                    offer: offer, 
                    sender: this.username, 
                    targetUsername: remoteUsername 
                });
            } catch (err) {
                console.error(`[RTC_TRACE] Error creating offer for ${remoteUsername}:`, err);
            } finally {
                pc.makingOffer = false;
            }
        } else {
            console.log("Waiting for ondatachannel event from initiator.");
            // Peer waits for data channel
            pc.ondatachannel = (event) => {
                console.log("Received data channel from initiator for:", remoteUsername);
                this.setupDataChannel(event.channel, remoteUsername);
            };
        }
        return pc;
    }

    setupDataChannel(dc, remoteUsername) {
        dc.binaryType = 'arraybuffer';
        console.log(`Explicitly setting binaryType to 'arraybuffer' for: ${remoteUsername}`);
        dc.bufferedAmountLowThreshold = 262144; // 256KB threshold
        this.dataChannels[remoteUsername] = dc;
        this.forwardQueues[remoteUsername] = [];

        dc.onbufferedamountlow = () => {
            const queue = this.forwardQueues[remoteUsername];
            if (queue && queue.length > 0) {
                while (queue.length > 0 && dc.bufferedAmount <= 1048576) {
                    const chunk = queue.shift();
                    try {
                        dc.send(chunk);
                    } catch (e) {
                        console.error("Error flushing backpressure queue:", e);
                    }
                }
            }
        };

        dc.onopen = () => {
            console.log(`[RTC_TRACE] Data Channel onopen for peer: ${remoteUsername}`);
            console.log("Data Channel OPENED for [" + remoteUsername + "]. ReadyState: " + dc.readyState);
            if (this.joinInterval) {
                clearInterval(this.joinInterval);
                this.joinInterval = null;
            }
            // Remove isHost restriction and make the message neutral
            this.stompClient.send(`/topic/session/${this.sessionId}/presence`, {}, `[TRAFFIC] WebRTC channel established between @${this.username} and @${remoteUsername}.`);
            if (this.callbacks.onPeerConnected) {
                this.callbacks.onPeerConnected(remoteUsername);
            }
            if (this.callbacks.onDataChannelOpen) {
                this.callbacks.onDataChannelOpen(remoteUsername);
            }
        };

        dc.onclose = () => {
            console.log(`[RTC_TRACE] Data Channel onclose for peer: ${remoteUsername}`);
            console.log("Data Channel CLOSED for [" + remoteUsername + "]");
            if (this.callbacks.onDataChannelClosed) {
                this.callbacks.onDataChannelClosed(remoteUsername);
            }
        };

        dc.onerror = (error) => {
            console.log(`[RTC_TRACE] Data Channel onerror for peer: ${remoteUsername}, error:`, error);
            console.log("Data Channel ERROR for [" + remoteUsername + "]: " + error);
            if (this.callbacks.onDataChannelClosed) {
                this.callbacks.onDataChannelClosed(remoteUsername);
            }
        };

        dc.onmessage = (event) => {
            if (typeof event.data === 'string') {
                const parsed = JSON.parse(event.data);
                parsed.sender = remoteUsername;
                
                if (parsed.streamData) {
                    if (parsed.type === 'END' || parsed.type === 'START') {
                        if (!this.processedChunks.has(parsed.fileId)) {
                            this.processedChunks.set(parsed.fileId, new Set());
                        }
                        const chunkSet = this.processedChunks.get(parsed.fileId);
                        if (chunkSet.has(parsed.type)) return;
                        chunkSet.add(parsed.type);

                        // Only consume if we are the destination of the stream
                        const isTarget = !parsed.targetUsername || parsed.targetUsername === this.username;
                        if (isTarget) {
                            this.callbacks.onFileChunk(parsed);
                        } else {
                            console.log(`[Data Plane] Relay node ${this.username}: Intermediate peer forwarding control signal ${parsed.type} without consuming.`);
                        }

                        if (parsed.routingPath) {
                            const pathArray = parsed.routingPath.split(',');
                            const myIndex = pathArray.indexOf(this.username);
                            if (myIndex !== -1 && myIndex < pathArray.length - 1) {
                                const nextUser = pathArray[myIndex + 1];
                                this.sendDataToPeer(nextUser, parsed);
                            }
                        }
                    } else {
                        // For other stream data types, only consume if target
                        const isTarget = !parsed.targetUsername || parsed.targetUsername === this.username;
                        if (isTarget) {
                            this.callbacks.onFileChunk(parsed);
                        }
                    }
                } else {
                    this.callbacks.onMessage(parsed);
                }
            } else {
                // It is binary data (ArrayBuffer)
                console.log("Data Channel MESSAGE RECEIVED from [" + remoteUsername + "]. Byte length: " + event.data.byteLength);
                console.log(`[Data Plane] Raw binary message received on data channel. Byte length: ${event.data.byteLength}`);
                const unpacked = unpackBinaryChunk(event.data);
                console.log(`[Data Plane] Unpacked binary chunk: fileId=${unpacked.fileId}, chunkIndex=${unpacked.chunkIndex}, originalSender=${unpacked.originalSenderUsername}, target=${unpacked.targetUsername}`);
                
                // Phase 3: Forwarding Interceptor Loop Prevention
                const fileId = unpacked.fileId;
                const chunkIndex = unpacked.chunkIndex;
                if (!this.processedChunks.has(fileId)) {
                    this.processedChunks.set(fileId, new Set());
                }
                const chunkSet = this.processedChunks.get(fileId);
                
                if (chunkSet.has(chunkIndex)) {
                    console.log(`[Data Plane] Interceptor blocking loop for chunk ${chunkIndex} of file ${fileId}`);
                    return; // Drop immediately to prevent loops
                }
                chunkSet.add(chunkIndex);
                
                // Consume only if we are the destination of the chunk
                const isTarget = !unpacked.targetUsername || unpacked.targetUsername === this.username;
                if (isTarget) {
                    unpacked.sender = remoteUsername;
                    this.callbacks.onFileChunk(unpacked);
                } else {
                    console.log(`[Data Plane] Relay node ${this.username}: Intermediate peer forwarding chunk ${chunkIndex} without consuming.`);
                }
                
                // Forward chunk to next hop if there is a routing path and we are not the final target
                if (unpacked.routingPath) {
                    const pathArray = unpacked.routingPath.split(',');
                    const myIndex = pathArray.indexOf(this.username);
                    if (myIndex !== -1 && myIndex < pathArray.length - 1) {
                        const nextUser = pathArray[myIndex + 1];
                        console.log(`[Data Plane] Directed Routing chunk ${chunkIndex} to ${nextUser}`);
                        this.sendDataToPeer(nextUser, event.data);
                    }
                }
            }
        };
    }

    broadcastData(data, excludeUsername = null) {
        let sentCount = 0;
        let totalCount = 0;
        Object.keys(this.dataChannels).forEach(username => {
            if (username !== excludeUsername) {
                totalCount++;
                const dc = this.dataChannels[username];
                if (dc.readyState === 'open') {
                    try {
                        dc.send(data);
                        sentCount++;
                    } catch (e) {
                        console.error("Failed to send broadcast over data channel to:", username, e);
                    }
                }
            }
        });
        const expectedPeersCount = Object.keys(this.dataChannels).filter(u => u !== excludeUsername).length;
        if (expectedPeersCount > 0) {
            return sentCount > 0;
        }
        return true;
    }

    broadcastBinaryData(arrayBuffer, excludeUsername = null) {
        let sentCount = 0;
        let totalCount = 0;
        Object.keys(this.dataChannels).forEach(username => {
            if (username !== excludeUsername) {
                totalCount++;
                const dc = this.dataChannels[username];
                console.log(`Attempting to send chunk to ${username}. Channel state: ${dc.readyState}. Payload size: ${arrayBuffer.byteLength} bytes.`);
                if (dc.readyState !== 'open') {
                    console.warn(`WARNING: Attempted to send data to ${username} while channel state is ${dc.readyState}. Data dropped.`);
                } else {
                    try {
                        dc.send(arrayBuffer);
                        sentCount++;
                    } catch (e) {
                        console.error("Failed to send broadcast binary over data channel to:", username, e);
                    }
                }
            }
        });
        const expectedPeersCount = Object.keys(this.peers).filter(u => u !== excludeUsername).length;
        if (expectedPeersCount > 0) {
            return sentCount > 0;
        }
        return true;
    }

    sendData(dataObj) {
        const dataStr = JSON.stringify(dataObj);
        // Universal DAG Routing: Broadcast to all actively connected peers
        return this.broadcastData(dataStr);
    }

    sendDataToPeer(targetUsername, data) {
        const isBinary = data instanceof ArrayBuffer;
        if (isBinary) {
            // Unpack header to read routing metadata
            let nextHop = targetUsername;
            if (!nextHop) {
                try {
                    const unpacked = unpackBinaryChunk(data);
                    if (unpacked.routingPath) {
                        const pathArray = unpacked.routingPath.split(',');
                        const myIndex = pathArray.indexOf(this.username);
                        if (myIndex !== -1 && myIndex < pathArray.length - 1) {
                            nextHop = pathArray[myIndex + 1];
                            console.log(`[RTC_TRACE] Resolved next hop ${nextHop} from routing path: ${unpacked.routingPath}`);
                        }
                    } else if (unpacked.targetUsername) {
                        // If no path but direct target is specified, try sending to them
                        nextHop = unpacked.targetUsername;
                    }
                } catch (e) {
                    console.error("[RTC_TRACE] Failed to unpack binary chunk for next-hop lookup:", e);
                }
            }
            
            if (!nextHop) {
                console.warn("[RTC_TRACE] sendDataToPeer: No next hop could be resolved for binary chunk. Dropping.");
                return false;
            }
            
            const dc = this.dataChannels[nextHop];
            const payloadSize = data.byteLength;
            console.log(`[RTC_TRACE] Attempting to send binary chunk to next hop ${nextHop}. Channel state: ${dc ? dc.readyState : 'missing'}. Payload size: ${payloadSize} bytes.`);
            
            if (!dc || dc.readyState !== 'open') {
                console.warn(`[RTC_TRACE] WARNING: Attempted to send data to next hop ${nextHop} while channel state is ${dc ? dc.readyState : 'missing'}. Data dropped.`);
                return false;
            }

            try {
                dc.send(data);
                return true;
            } catch (e) {
                console.error(`[RTC_TRACE] Failed to send binary data to next hop ${nextHop}:`, e);
                return false;
            }
        }

        // Text / Control messages (broadcast if targetUsername is falsy, otherwise unicast)
        if (!targetUsername) {
            return this.sendData(data);
        }

        const dc = this.dataChannels[targetUsername];
        const payloadSize = typeof data === 'string' ? data.length : JSON.stringify(data).length;
        console.log(`Attempting to send text message to ${targetUsername}. Channel state: ${dc ? dc.readyState : 'missing'}. Payload size: ${payloadSize} bytes.`);
        
        if (!dc || dc.readyState !== 'open') {
            console.warn(`WARNING: Attempted to send data to ${targetUsername} while channel state is ${dc ? dc.readyState : 'missing'}. Data dropped.`);
            return false;
        }

        try {
            const payload = typeof data === 'string' ? data : JSON.stringify(data);
            dc.send(payload);
            return true;
        } catch (e) {
            console.error("Failed to send data over data channel to target:", targetUsername, e);
            return false;
        }
    }

    handlePeerLeave(username) {
        const pc = this.peers[username];
        if (pc) {
            try { pc.close(); } catch (e) { /* ignore */ }
            delete this.peers[username];
        }
        delete this.dataChannels[username];
        delete this.iceQueues[username];
    }

    teardown(reason = "cleanup/unmount") {
        console.log(`[RTC_TRACE] WebRTCManager teardown() called. Reason: ${reason}. Stack:`, new Error().stack);
        if (this.signalingSub) {
            try { this.signalingSub.unsubscribe(); } catch(e) {}
            this.signalingSub = null;
        }
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }
        
        Object.keys(this.peers).forEach(username => {
            const pc = this.peers[username];
            if (pc) {
                try { pc.close(); } catch (e) { /* ignore */ }
            }
        });
        
        Object.values(this.dataChannels).forEach(dc => {
            try { dc.close(); } catch (e) { /* ignore */ }
        });

        this.peers = {};
        this.dataChannels = {};
        this.iceQueues = {};
        this.forwardQueues = {};
        this.processedChunks = new Map();
        
        console.log("WebRTC state completely torn down.");
    }

    disconnect() {
        this.teardown("disconnect wrapper");
    }

    async getWebRTCAchievementBytes() {
        let totalBytes = 0;
        try {
            for (const pc of Object.values(this.peers)) {
                if (pc.connectionState === 'connected') {
                    const stats = await pc.getStats();
                    stats.forEach(report => {
                        if (report.type === 'data-channel') {
                            totalBytes += (report.bytesSent || 0) + (report.bytesReceived || 0);
                        }
                    });
                }
            }
        } catch (e) {
            console.error("Failed to query RTCPeerConnection stats:", e);
        }
        return totalBytes;
    }
}

export function packBinaryChunk(fileId, originalSenderUsername, chunkIndex, totalChunks, fileSize, chunkArrayBuffer, targetUsername = '', routingPath = '') {
    const encoder = new TextEncoder();
    const fileIdBytes = encoder.encode(fileId);
    const senderBytes = encoder.encode(originalSenderUsername);
    const targetBytes = encoder.encode(targetUsername || '');
    const pathBytes = encoder.encode(routingPath || '');
    
    // chunkIndex(4), totalChunks(4), fileSize(8), fileIdLength(4), senderLength(4), targetLength(4), pathLength(4)
    const headerMetaLength = 32;
    const headerLength = headerMetaLength + fileIdBytes.length + senderBytes.length + targetBytes.length + pathBytes.length;
    
    const packetBuffer = new ArrayBuffer(headerLength + chunkArrayBuffer.byteLength);
    const view = new DataView(packetBuffer);
    
    view.setUint32(0, chunkIndex, true);
    view.setUint32(4, totalChunks, true);
    view.setFloat64(8, fileSize, true);
    view.setUint32(16, fileIdBytes.length, true);
    view.setUint32(20, senderBytes.length, true);
    view.setUint32(24, targetBytes.length, true);
    view.setUint32(28, pathBytes.length, true);
    
    const uint8Packet = new Uint8Array(packetBuffer);
    let offset = headerMetaLength;
    
    uint8Packet.set(fileIdBytes, offset); offset += fileIdBytes.length;
    uint8Packet.set(senderBytes, offset); offset += senderBytes.length;
    uint8Packet.set(targetBytes, offset); offset += targetBytes.length;
    uint8Packet.set(pathBytes, offset); offset += pathBytes.length;
    
    uint8Packet.set(new Uint8Array(chunkArrayBuffer), offset);
    
    return packetBuffer;
}

export function unpackBinaryChunk(packetArrayBuffer) {
    const view = new DataView(packetArrayBuffer);
    const chunkIndex = view.getUint32(0, true);
    const totalChunks = view.getUint32(4, true);
    const fileSize = view.getFloat64(8, true);
    const fileIdLength = view.getUint32(16, true);
    const senderLength = view.getUint32(20, true);
    const targetLength = view.getUint32(24, true);
    const pathLength = view.getUint32(28, true);
    
    const uint8Packet = new Uint8Array(packetArrayBuffer);
    const decoder = new TextDecoder();
    
    let offset = 32;
    const fileId = decoder.decode(uint8Packet.subarray(offset, offset + fileIdLength)); offset += fileIdLength;
    const originalSenderUsername = decoder.decode(uint8Packet.subarray(offset, offset + senderLength)); offset += senderLength;
    const targetUsername = targetLength > 0 ? decoder.decode(uint8Packet.subarray(offset, offset + targetLength)) : null; offset += targetLength;
    const routingPath = pathLength > 0 ? decoder.decode(uint8Packet.subarray(offset, offset + pathLength)) : null; offset += pathLength;
    
    const chunkData = uint8Packet.subarray(offset);
    
    return {
        isBinary: true,
        type: 'CHUNK',
        fileId,
        chunkIndex,
        totalChunks,
        fileSize,
        originalSenderUsername,
        targetUsername,
        routingPath,
        data: chunkData
    };
}
