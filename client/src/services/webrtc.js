export class WebRTCManager {
    constructor(sessionId, username, isHost, stompClient, callbacks) {
        this.sessionId = sessionId;
        this.username = username;
        this.isHost = isHost;
        this.stompClient = stompClient; 
        this.callbacks = callbacks; 
        this.peers = {}; 
        this.dataChannels = {}; 

        // Empty iceServers forces local network connection (no STUN/TURN)
        this.configuration = { iceServers: [] };
        
        this.fallbackTriggered = false;
        this.connectionTimeout = null;

        this.setupSignaling();

        if (!this.isHost) {
            this.startConnectionTimer();
            // Tell host we are here to get an offer
            setTimeout(() => {
                this.sendSignal({ type: 'JOIN_REQUEST', sender: this.username });
            }, 500);
        }
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

    setupSignaling() {
        this.signalingSub = this.stompClient.subscribe(`/topic/session/${this.sessionId}/signal`, (msg) => {
            const data = JSON.parse(msg.body);
            const senderSocketId = msg.headers.senderSocketId;
            
            // Ignore our own signals
            if (data.sender === this.username) return;

            this.handleSignal(data, senderSocketId);
        });
    }

    sendSignal(data) {
        this.stompClient.send(`/app/session/${this.sessionId}/signal`, {}, JSON.stringify(data));
    }

    isLocalIP(candidateString) {
        // Simple check to ensure we only accept local network IPs
        // Example candidate: "candidate:4234997325 1 udp 2043278322 192.168.1.5 50046 typ host"
        const ipRegex = /([0-9]{1,3}\.){3}[0-9]{1,3}/;
        const match = candidateString.match(ipRegex);
        if (match) {
            const ip = match[0];
            if (ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip) || ip === '127.0.0.1') {
                return true;
            }
        }
        return false;
    }

    async handleSignal(data, senderSocketId) {
        if (data.type === 'JOIN_REQUEST' && this.isHost) {
            await this.createPeerConnection(senderSocketId, data.sender);
            return;
        }

        if (!this.peers[senderSocketId] && !this.isHost && data.type === 'offer') {
             // Peer receiving offer from host
             await this.createPeerConnection(senderSocketId, data.sender);
        }

        const pc = this.peers[senderSocketId];
        if (!pc) return;

        try {
            if (data.type === 'offer') {
                await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                this.sendSignal({ type: 'answer', answer: answer, sender: this.username, targetSocketId: senderSocketId });
            } else if (data.type === 'answer') {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            } else if (data.type === 'candidate') {
                if (data.candidate && this.isLocalIP(data.candidate.candidate)) {
                    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                } else if (data.candidate) {
                    console.log("Ignored non-local ICE candidate:", data.candidate.candidate);
                }
            }
        } catch (e) {
            console.error("Error handling signal:", e);
            this.triggerFallback();
        }
    }

    async createPeerConnection(socketId, remoteUsername) {
        const pc = new RTCPeerConnection(this.configuration);
        this.peers[socketId] = pc;

        pc.onicecandidate = (event) => {
            if (event.candidate && this.isLocalIP(event.candidate.candidate)) {
                this.sendSignal({ type: 'candidate', candidate: event.candidate, sender: this.username, targetSocketId: socketId });
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected') {
                console.log("WebRTC Connected securely over local network!");
                if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
            } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                this.triggerFallback();
            }
        };

        if (this.isHost) {
            // Host creates the data channel
            const dc = pc.createDataChannel('synapse-data', { negotiated: false });
            this.setupDataChannel(dc, socketId);
            
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this.sendSignal({ type: 'offer', offer: offer, sender: this.username, targetSocketId: socketId });
        } else {
            // Peer waits for data channel
            pc.ondatachannel = (event) => {
                this.setupDataChannel(event.channel, socketId);
            };
        }
        return pc;
    }

    setupDataChannel(dc, socketId) {
        dc.binaryType = 'arraybuffer';
        this.dataChannels[socketId] = dc;

        dc.onopen = () => {
            console.log("Data channel open for", socketId);
        };

        dc.onmessage = (event) => {
            if (typeof event.data === 'string') {
                const parsed = JSON.parse(event.data);
                if (parsed.streamData) {
                    this.callbacks.onFileChunk(parsed);
                } else {
                    this.callbacks.onMessage(parsed);
                }
                
                // If Host, broadcast to other peers
                if (this.isHost) {
                    this.broadcastData(event.data, socketId);
                }
            } else {
                // Binary not used directly, we wrap in JSON for simplicity in this version
            }
        };
    }

    broadcastData(data, excludeSocketId = null) {
        Object.keys(this.dataChannels).forEach(id => {
            if (id !== excludeSocketId) {
                const dc = this.dataChannels[id];
                if (dc.readyState === 'open') {
                    dc.send(data);
                }
            }
        });
    }

    sendData(dataObj) {
        const dataStr = JSON.stringify(dataObj);
        if (this.isHost) {
            this.broadcastData(dataStr);
        } else {
            // Send to Host
            const hostIds = Object.keys(this.dataChannels);
            if (hostIds.length > 0) {
                const dc = this.dataChannels[hostIds[0]];
                if (dc.readyState === 'open') {
                    dc.send(dataStr);
                }
            }
        }
    }

    disconnect() {
        if (this.signalingSub) this.signalingSub.unsubscribe();
        if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
        Object.values(this.peers).forEach(pc => pc.close());
        this.peers = {};
        this.dataChannels = {};
    }
}
