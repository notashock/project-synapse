package com.college.placementhub.service;

import com.college.placementhub.dto.ChatMessage;
import com.college.placementhub.model.Session;
import com.college.placementhub.model.SessionStatus;
import com.college.placementhub.repository.SessionRepository;
import com.college.placementhub.repository.SharedFileRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j // Asynchronous, highly optimized logging
@Service
@RequiredArgsConstructor // Native constructor injection (No reflection)
public class SessionService {

    private final SimpMessagingTemplate template;
    private final SharedFileRepository sharedFileRepository;
    private final SessionRepository sessionRepository;
    
    // Tracks active sockets per user per session (sessionId -> (username -> socketId))
    private final Map<String, Map<String, String>> sessionUserSockets = new ConcurrentHashMap<>();
    
    // Tracks empty session timestamps for eviction sweeping
    private final Map<String, Long> emptySessionTimestamps = new ConcurrentHashMap<>();

    // Tracks DAG edges (sessionId -> (username -> List of assigned target usernames))
    private final Map<String, Map<String, java.util.List<String>>> meshEdges = new ConcurrentHashMap<>();

    // Tracks TRUE active WebRTC DataChannels (sessionId -> (username -> Set of connected usernames))
    private final Map<String, Map<String, java.util.Set<String>>> actualMeshEdges = new ConcurrentHashMap<>();

    // Tracks active file transfers (sessionId -> Set of active transfers)
    private final Map<String, java.util.Set<ActiveTransfer>> activeTransferEdges = new ConcurrentHashMap<>();

    // Tracks file ownership (sessionId -> (fileId -> (username -> FileOwnership)))
    private final Map<String, Map<String, Map<String, com.college.placementhub.model.FileOwnership>>> ownershipRegistry = new ConcurrentHashMap<>();

    public static record ActiveTransfer(
        String sessionId,
        String fileId,
        String sender,
        String target,
        long timestamp
    ) {
        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof ActiveTransfer that)) return false;
            return sessionId.equals(that.sessionId) &&
                   fileId.equals(that.fileId) &&
                   sender.equals(that.sender) &&
                   target.equals(that.target);
        }

        @Override
        public int hashCode() {
            return java.util.Objects.hash(sessionId, fileId, sender, target);
        }
    }

    public void registerActiveTransfer(String sessionId, String fileId, String sender, String target) {
        ActiveTransfer transfer = new ActiveTransfer(sessionId, fileId, sender, target, System.currentTimeMillis());
        activeTransferEdges.computeIfAbsent(sessionId, k -> ConcurrentHashMap.newKeySet()).add(transfer);
        log.info("[TRANSFER_REGISTRY] Registered active transfer: fileId={}, sender={}, target={} in session={}", fileId, sender, target, sessionId);
    }

    public void handleTransferActivityEvent(String sessionId, String type, String fileId, String uploader) {
        if ("START".equals(type)) {
            log.info("[TRANSFER_REGISTRY] Received START event for fileId={} by uploader={} in session={}", fileId, uploader, sessionId);
        } else if ("END".equals(type)) {
            java.util.Set<ActiveTransfer> transfers = activeTransferEdges.get(sessionId);
            if (transfers != null) {
                transfers.removeIf(t -> {
                    if (t.fileId().equals(fileId) && t.sender().equals(uploader)) {
                        decrementUploadLoad(sessionId, fileId, uploader);
                        return true;
                    }
                    return false;
                });
                log.info("[TRANSFER_REGISTRY] Deregistered active transfer for fileId={} by uploader={} in session={}", fileId, uploader, sessionId);
            }
        }
    }

    public void cleanUserTransfers(String sessionId, String username) {
        java.util.Set<ActiveTransfer> transfers = activeTransferEdges.get(sessionId);
        if (transfers != null) {
            boolean removed = transfers.removeIf(t -> t.sender().equals(username) || t.target().equals(username));
            if (removed) {
                log.info("[TRANSFER_REGISTRY] Cleaned active transfers involving user={} in session={}", username, sessionId);
            }
        }
    }

    public void cleanSessionTransfers(String sessionId) {
        activeTransferEdges.remove(sessionId);
        log.info("[TRANSFER_REGISTRY] Cleaned all active transfers for session={}", sessionId);
    }

    public void performTransferTimeoutSweep() {
        long now = System.currentTimeMillis();
        activeTransferEdges.forEach((sessionId, transfers) -> {
            boolean removed = transfers.removeIf(t -> (now - t.timestamp()) > 300000);
            if (removed) {
                log.info("[TRANSFER_REGISTRY] Swept timed out active transfers in session={}", sessionId);
            }
        });
    }

    public void registerUserSocket(String sessionId, String username, String socketId) {
        sessionUserSockets.computeIfAbsent(sessionId, k -> new ConcurrentHashMap<>()).put(username, socketId);
        emptySessionTimestamps.remove(sessionId);
        log.info("Registered socket ID {} for user {} in session {}", socketId, username, sessionId);
    }

    public void unregisterUserSocket(String sessionId, String username, String socketId) {
        Map<String, String> userSockets = sessionUserSockets.get(sessionId);
        if (userSockets != null) {
            userSockets.remove(username, socketId);
            if (userSockets.isEmpty()) {
                sessionUserSockets.remove(sessionId);
                emptySessionTimestamps.put(sessionId, System.currentTimeMillis());
            }
        }
        cleanUserTransfers(sessionId, username);
        
        // Reset their upload loads for all files in this session
        Map<String, Map<String, com.college.placementhub.model.FileOwnership>> sessionRegistry = ownershipRegistry.get(sessionId);
        if (sessionRegistry != null) {
            for (Map<String, com.college.placementhub.model.FileOwnership> fileRegistry : sessionRegistry.values()) {
                com.college.placementhub.model.FileOwnership ownership = fileRegistry.get(username);
                if (ownership != null) {
                    ownership.setUploadLoad(0);
                }
            }
        }
        
        log.info("Unregistered socket ID {} for user {} in session {}", socketId, username, sessionId);
    }

    public String getUserSocket(String sessionId, String username) {
        Map<String, String> userSockets = sessionUserSockets.get(sessionId);
        return userSockets != null ? userSockets.get(username) : null;
    }

    public Session createSession(String hostUsername, String sessionTitle, boolean isLocal) {
        String sessionId = UUID.randomUUID().toString();
        String joinCode = UUID.randomUUID().toString().substring(0, 6).toUpperCase();

        Session newSession = new Session(
                sessionId,
                sessionTitle,
                hostUsername,
                joinCode,
                System.currentTimeMillis(),
                isLocal,
                SessionStatus.ACTIVE
        );
        sessionRepository.save(newSession);

        emptySessionTimestamps.put(sessionId, System.currentTimeMillis());

        log.info("Live Session Created: {} | Title: {} | Code: {}", sessionId, sessionTitle, joinCode);
        return newSession;
    }

    public boolean joinSession(String sessionId, String username, String providedCode) {
        Session session = sessionRepository.findById(sessionId).orElse(null);
        if (session == null) {
            return false;
        }
        if (session.getStatus() == SessionStatus.INACTIVE) {
            throw new IllegalArgumentException("Session has expired");
        }
        if (!session.getJoinCode().equalsIgnoreCase(providedCode)) {
            throw new IllegalArgumentException("Invalid joining code. Access denied.");
        }

        if (session.getParticipants() != null) {
            session.getParticipants().add(username);
            sessionRepository.save(session);
        }

        log.info("{} has joined the session: {} (Mesh routing will be assigned upon STOMP connect)", username, sessionId);
        return true;
    }

    public boolean leaveSession(String sessionId, String username) {
        Session session = sessionRepository.findById(sessionId).orElse(null);
        if (session != null && session.getParticipants() != null && session.getParticipants().contains(username)) {
            session.getParticipants().remove(username);
            sessionRepository.save(session);
            template.convertAndSend("/topic/session/" + sessionId + "/presence", username + " has left the session.");

            // Clear the shared file metadata of the leaving user in this session
            sharedFileRepository.deleteBySessionIdAndSender(sessionId, username);

            cleanUserTransfers(sessionId, username);

            log.info("{} has left the session: {}, cleaned up their shared files and transfer requests.", username, sessionId);
            return true;
        }
        return false;
    }

    public void broadcastChatMessage(String sessionId, String sender, String content) {
        if (isValidSession(sessionId)) {
            ChatMessage msg = new ChatMessage(sender, content, System.currentTimeMillis());
            template.convertAndSend("/topic/session/" + sessionId + "/chat", msg);
        } else {
            throw new IllegalArgumentException("Cannot send message. Session has ended.");
        }
    }

    public boolean isValidSession(String sessionId) {
        Session session = sessionRepository.findById(sessionId).orElse(null);
        return session != null && session.getStatus() == SessionStatus.ACTIVE;
    }

    public boolean endSession(String sessionId, String reqUsername) {
        Session session = sessionRepository.findById(sessionId).orElse(null);
        if (session == null || session.getStatus() == SessionStatus.INACTIVE) {
            throw new IllegalArgumentException("Session Not Found or already terminated");
        }
        if (!session.getHostUsername().equals(reqUsername)) {
            log.warn("Unauthorized deletion attempted by {}", reqUsername);
            return false;
        }

        template.convertAndSend("/topic/session/" + sessionId + "/presence", "SESSION_TERMINATED");
        
        session.setStatus(SessionStatus.INACTIVE);
        sessionRepository.save(session);
        
        sessionUserSockets.remove(sessionId);
        emptySessionTimestamps.remove(sessionId);
        cleanSessionTransfers(sessionId);

        log.info("Live Session Ended: {} by {}", sessionId, reqUsername);
        return true;
    }

    public Session getSessionDetails(String sessionId) {
        Session session = sessionRepository.findById(sessionId).orElse(null);
        if (session != null && session.getStatus() == SessionStatus.INACTIVE) {
             throw new IllegalArgumentException("Session has expired");
        }
        return session;
    }

    public Session getSessionByJoinCode(String joinCode) {
        if (joinCode == null) return null;
        String normalized = joinCode.trim().toUpperCase();
        Session session = sessionRepository.findByJoinCode(normalized);
        if (session != null && session.getStatus() == SessionStatus.INACTIVE) {
             throw new IllegalArgumentException("Session has expired");
        }
        return session;
    }

    public Collection<Session> getAllActiveSessions() {
        return sessionRepository.findByStatus(SessionStatus.ACTIVE);
    }
    
    public Map<String, Long> getEmptySessionTimestamps() {
        return emptySessionTimestamps;
    }
    
    public Map<String, Map<String, String>> getSessionUserSockets() {
        return sessionUserSockets;
    }

    public void keepAlive(String sessionId) {
        if (emptySessionTimestamps.containsKey(sessionId)) {
            emptySessionTimestamps.remove(sessionId);
        }
        // Additional activity tracking can be logged here if necessary
        log.debug("Heartbeat received for session: {}", sessionId);
    }

    // --- Phase 2: Mesh Topology Routing ---

    /**
     * Assigns up to 3 random peers to the joining user from the currently active sockets.
     */
    public java.util.List<String> assignPeers(String sessionId, String username) {
        performTransferTimeoutSweep();

        Map<String, String> userSockets = sessionUserSockets.get(sessionId);
        if (userSockets == null || userSockets.isEmpty()) {
            return java.util.Collections.emptyList();
        }

        java.util.List<String> availablePeers = new java.util.ArrayList<>(userSockets.keySet());
        if (!availablePeers.contains(username)) {
            return java.util.Collections.emptyList();
        }

        // Retrieve current assignments for username
        Map<String, java.util.List<String>> assignedEdges = meshEdges.get(sessionId);
        java.util.List<String> currentTargets = (assignedEdges != null) ? assignedEdges.get(username) : null;

        // Identify pinned targets based on active transfers
        java.util.Set<ActiveTransfer> transfers = activeTransferEdges.getOrDefault(sessionId, java.util.Collections.emptySet());
        java.util.Set<String> pinnedTargets = new java.util.HashSet<>();
        for (ActiveTransfer transfer : transfers) {
            if (transfer.sender().equals(username) && userSockets.containsKey(transfer.target())) {
                pinnedTargets.add(transfer.target());
            } else if (transfer.target().equals(username) && userSockets.containsKey(transfer.sender())) {
                pinnedTargets.add(transfer.sender());
            }
        }

        java.util.List<String> retained = new java.util.ArrayList<>();
        
        // 1. Keep pinned targets first
        for (String target : pinnedTargets) {
            if (userSockets.containsKey(target) && !target.equals(username)) {
                retained.add(target);
            }
        }

        // 2. Keep other active current targets
        if (currentTargets != null) {
            for (String target : currentTargets) {
                if (userSockets.containsKey(target) && !target.equals(username) && !retained.contains(target)) {
                    retained.add(target);
                }
            }
        }

        // 3. Trim if over limit of 3, prioritizing pinned targets
        if (retained.size() > 3) {
            java.util.List<String> trimmed = new java.util.ArrayList<>();
            // Keep pinned first
            for (String target : retained) {
                if (pinnedTargets.contains(target) && trimmed.size() < 3) {
                    trimmed.add(target);
                }
            }
            // Keep non-pinned next
            for (String target : retained) {
                if (!pinnedTargets.contains(target) && trimmed.size() < 3) {
                    trimmed.add(target);
                }
            }
            
            // Log skipped removals for debugging
            for (String target : retained) {
                if (!trimmed.contains(target) && pinnedTargets.contains(target)) {
                    log.warn("[TRANSFER_REGISTRY] WARNING: Had to trim pinned target {} for user {} due to 3-edge limit!", target, username);
                } else if (!trimmed.contains(target)) {
                    log.info("[TRANSFER_REGISTRY] Trimmed non-pinned target {} for user {}", target, username);
                }
            }
            retained = trimmed;
        }

        // 4. Fill up to 3 incrementally if needed
        if (retained.size() < 3) {
            java.util.List<String> candidates = new java.util.ArrayList<>(userSockets.keySet());
            candidates.remove(username);
            candidates.removeAll(retained);
            
            java.util.Collections.shuffle(candidates);
            while (retained.size() < 3 && !candidates.isEmpty()) {
                retained.add(candidates.remove(0));
            }
        }

        // Tracing Logs
        java.util.List<String> added = new java.util.ArrayList<>(retained);
        if (currentTargets != null) {
            added.removeAll(currentTargets);
        }
        java.util.List<String> removed = new java.util.ArrayList<>();
        if (currentTargets != null) {
            removed.addAll(currentTargets);
            removed.removeAll(retained);
        }

        log.info("[RTC_TRACE] Recomputing topology for user: {} in session: {}", username, sessionId);
        log.info("[RTC_TRACE] Pinned edges for {}: {}", username, pinnedTargets);
        log.info("[RTC_TRACE] Current assigned targets for {}: {}", username, currentTargets);
        log.info("[RTC_TRACE] Retained targets for {}: {}", username, retained);
        log.info("[RTC_TRACE] Added targets for {}: {}", username, added);
        log.info("[RTC_TRACE] Removed targets for {}: {}", username, removed);

        return retained;
    }

    /**
     * Triggers the assignment of peers and sends a targeted STOMP message to the joining user.
     */
    public void notifyTopology(String sessionId, String joiningUsername, String socketId) {
        // Pre-Cleansing DAG
        Map<String, java.util.List<String>> sessionEdges = meshEdges.get(sessionId);
        if (sessionEdges != null) {
            sessionEdges.remove(joiningUsername);
            sessionEdges.forEach((user, targets) -> {
                java.util.List<String> oldTargetsCopy = new java.util.ArrayList<>(targets);
                if (targets.remove(joiningUsername)) {
                    log.info("Scrubbed lingering inbound reference to {} from user {}", joiningUsername, user);
                    
                    log.info("Self-Healing: User {} had their target list degraded during scrub. Reassigning peers.", user);
                    java.util.List<String> newTargets = assignPeers(sessionId, user);
                    sessionEdges.put(user, newTargets);
                    
                    if (!new java.util.HashSet<>(oldTargetsCopy).equals(new java.util.HashSet<>(newTargets))) {
                        Map<String, Object> payload = new java.util.HashMap<>();
                        payload.put("type", "ASSIGN_PEERS");
                        payload.put("targets", newTargets);
                        
                        String destination = "/topic/session/" + sessionId + "/topology/" + user;
                        template.convertAndSend(destination, payload);
                        log.info("Dispatched incremental ASSIGN_PEERS to user {} with targets: {}", user, newTargets);
                    } else {
                        log.info("No effective topology change for affected user {} after scrub. Skipping ASSIGN_PEERS.", user);
                    }
                }
            });
        }

        java.util.List<String> targets = assignPeers(sessionId, joiningUsername);
        
        meshEdges.computeIfAbsent(sessionId, k -> new ConcurrentHashMap<>())
                 .put(joiningUsername, targets);
        
        Map<String, Object> payload = new java.util.HashMap<>();
        payload.put("type", "ASSIGN_PEERS");
        payload.put("targets", targets);

        String destination = "/topic/session/" + sessionId + "/topology/" + joiningUsername;
        template.convertAndSend(destination, payload);
        
        log.info("Assigned peers {} to user {} in session {}", targets, joiningUsername, sessionId);
    }

    /**
     * Phase 5: Self-Healing Mesh
     * Detects if any users were targeting a disconnected peer and dynamically reassigns them new targets.
     */
    public void healMesh(String sessionId, String droppedUsername) {
        Map<String, java.util.List<String>> sessionEdges = meshEdges.get(sessionId);
        if (sessionEdges == null || sessionEdges.isEmpty()) return;

        Map<String, String> userSockets = sessionUserSockets.get(sessionId);
        if (userSockets == null || userSockets.isEmpty()) {
            meshEdges.remove(sessionId);
            return;
        }

        sessionEdges.forEach((activeUser, targets) -> {
            if (userSockets.containsKey(activeUser) && targets.contains(droppedUsername)) {
                log.info("Self-Healing: User {} was targeting dropped user {}. Reassigning peers.", activeUser, droppedUsername);
                java.util.List<String> oldTargetsCopy = new java.util.ArrayList<>(targets);
                
                // Get new assignments
                java.util.List<String> newTargets = assignPeers(sessionId, activeUser);
                sessionEdges.put(activeUser, newTargets);

                if (!new java.util.HashSet<>(oldTargetsCopy).equals(new java.util.HashSet<>(newTargets))) {
                    // Dispatch to stranded user
                    Map<String, Object> payload = new java.util.HashMap<>();
                    payload.put("type", "ASSIGN_PEERS");
                    payload.put("targets", newTargets);
                    
                    String destination = "/topic/session/" + sessionId + "/topology/" + activeUser;
                    template.convertAndSend(destination, payload);
                    log.info("Dispatched heal ASSIGN_PEERS to user {} with targets: {}", activeUser, newTargets);
                } else {
                    log.info("No effective topology change for user {} after heal. Skipping ASSIGN_PEERS.", activeUser);
                }
            }
        });
    }

    /**
     * Phase 5: Specific DAG Link Repair
     * Called when a client explicitly reports that their WebRTC connection to another peer dropped.
     */
    public void handlePeerDrop(String sessionId, String reportingUser, String droppedUser) {
        Map<String, java.util.List<String>> sessionEdges = meshEdges.get(sessionId);
        if (sessionEdges == null) return;

        java.util.List<String> targets = sessionEdges.get(reportingUser);
        if (targets != null && targets.contains(droppedUser)) {
            log.info("Self-Healing (Link Repair): Removed broken link from {} to {}", reportingUser, droppedUser);
            java.util.List<String> oldTargetsCopy = new java.util.ArrayList<>(targets);
            
            // Reassign a new set of peers for the reporting user to maintain DAG integrity
            java.util.List<String> newTargets = assignPeers(sessionId, reportingUser);
            sessionEdges.put(reportingUser, newTargets);

            if (!new java.util.HashSet<>(oldTargetsCopy).equals(new java.util.HashSet<>(newTargets))) {
                Map<String, Object> payload = new java.util.HashMap<>();
                payload.put("type", "ASSIGN_PEERS");
                payload.put("targets", newTargets);
                
                String destination = "/topic/session/" + sessionId + "/topology/" + reportingUser;
                template.convertAndSend(destination, payload);
                log.info("Dispatched link repair ASSIGN_PEERS to user {} with targets: {}", reportingUser, newTargets);
            } else {
                log.info("No effective topology change for user {} after link repair. Skipping ASSIGN_PEERS.", reportingUser);
            }
        }
    }

    public void handleDataChannelOpen(String sessionId, String reportingUser, String targetUser) {
        actualMeshEdges.computeIfAbsent(sessionId, k -> new ConcurrentHashMap<>())
                       .computeIfAbsent(reportingUser, k -> ConcurrentHashMap.newKeySet())
                       .add(targetUser);
        log.info("Actual Mesh updated: {} -> {} opened", reportingUser, targetUser);
    }

    public void handleDataChannelClose(String sessionId, String reportingUser, String targetUser) {
        Map<String, java.util.Set<String>> sessionEdges = actualMeshEdges.get(sessionId);
        if (sessionEdges != null) {
            java.util.Set<String> userEdges = sessionEdges.get(reportingUser);
            if (userEdges != null) {
                userEdges.remove(targetUser);
                log.info("Actual Mesh updated: {} -> {} closed", reportingUser, targetUser);
                
                // Mesh Integrity Watchdog: If user dropped to 0 edges, assign a new peer
                if (userEdges.isEmpty() && sessionUserSockets.containsKey(sessionId) && sessionUserSockets.get(sessionId).containsKey(reportingUser)) {
                    log.info("Watchdog: User {} has 0 active connections. Forcing mesh repair.", reportingUser);
                    
                    Map<String, java.util.List<String>> assigned = meshEdges.get(sessionId);
                    java.util.List<String> oldTargetsCopy = (assigned != null) ? assigned.get(reportingUser) : null;
                    if (oldTargetsCopy == null) {
                        oldTargetsCopy = new java.util.ArrayList<>();
                    } else {
                        oldTargetsCopy = new java.util.ArrayList<>(oldTargetsCopy);
                    }

                    java.util.List<String> newTargets = assignPeers(sessionId, reportingUser);
                    if (!newTargets.isEmpty()) {
                        meshEdges.computeIfAbsent(sessionId, k -> new ConcurrentHashMap<>())
                                 .put(reportingUser, newTargets);
                        
                        if (!new java.util.HashSet<>(oldTargetsCopy).equals(new java.util.HashSet<>(newTargets))) {
                            Map<String, Object> payload = new java.util.HashMap<>();
                            payload.put("type", "ASSIGN_PEERS");
                            payload.put("targets", newTargets);
                            template.convertAndSend("/topic/session/" + sessionId + "/topology/" + reportingUser, payload);
                            log.info("Dispatched watchdog repair ASSIGN_PEERS to user {} with targets: {}", reportingUser, newTargets);
                        } else {
                            log.info("No effective topology change for user {} after watchdog repair. Skipping ASSIGN_PEERS.", reportingUser);
                        }
                    }
                }
            }
        }
    }

    public void syncTopology(String sessionId, String reportingUser, java.util.List<String> activePeers) {
        Map<String, java.util.Set<String>> sessionEdges = actualMeshEdges.computeIfAbsent(sessionId, k -> new ConcurrentHashMap<>());
        
        // 1. Overwrite user's actual edges with absolute truth from client
        java.util.Set<String> newEdges = ConcurrentHashMap.newKeySet();
        newEdges.addAll(activePeers);
        sessionEdges.put(reportingUser, newEdges);
        log.info("Mesh Sync: {} reports active peers: {}", reportingUser, activePeers);
        
        // 2. Graph Healer: Check for isolation or fragmentation
        Map<String, String> userSockets = sessionUserSockets.get(sessionId);
        if (userSockets == null || userSockets.size() <= 1) return;
        
        java.util.Set<String> allUsers = new java.util.HashSet<>(userSockets.keySet());
        
        // Find connected components using BFS
        java.util.List<java.util.Set<String>> components = new java.util.ArrayList<>();
        java.util.Set<String> unvisited = new java.util.HashSet<>(allUsers);
        
        while (!unvisited.isEmpty()) {
            String startNode = unvisited.iterator().next();
            java.util.Set<String> component = new java.util.HashSet<>();
            java.util.Queue<String> queue = new java.util.LinkedList<>();
            
            queue.add(startNode);
            unvisited.remove(startNode);
            component.add(startNode);
            
            while (!queue.isEmpty()) {
                String current = queue.poll();
                // Check outgoing edges from 'current'
                java.util.Set<String> neighbors = sessionEdges.get(current);
                if (neighbors != null) {
                    for (String neighbor : neighbors) {
                        if (unvisited.contains(neighbor)) {
                            unvisited.remove(neighbor);
                            component.add(neighbor);
                            queue.add(neighbor);
                        }
                    }
                }
                
                // Check incoming edges to 'current' (since it's a bidirectional conceptual mesh)
                for (Map.Entry<String, java.util.Set<String>> entry : sessionEdges.entrySet()) {
                    if (entry.getValue().contains(current) && unvisited.contains(entry.getKey())) {
                        unvisited.remove(entry.getKey());
                        component.add(entry.getKey());
                        queue.add(entry.getKey());
                    }
                }
            }
            components.add(component);
        }
        
        // If graph is disjoint (more than 1 component), heal the mesh!
        if (components.size() > 1) {
            log.warn("Mesh Fragmented! Detected {} isolated components. Initiating graph heal.", components.size());
            
            // Bridge Component 0 to Component 1
            java.util.Set<String> compA = components.get(0);
            java.util.Set<String> compB = components.get(1);
            
            String bridgeNodeA = compA.iterator().next();
            String bridgeNodeB = compB.iterator().next();
            
            log.info("Healing mesh: Assigning {} to connect to {}", bridgeNodeA, bridgeNodeB);
            
            // Prevent duplicate assignments
            boolean alreadyAssigned = false;
            Map<String, java.util.List<String>> assigned = meshEdges.get(sessionId);
            if (assigned != null && assigned.containsKey(bridgeNodeA) && assigned.get(bridgeNodeA).contains(bridgeNodeB)) {
                alreadyAssigned = true;
            }
            
            if (!alreadyAssigned) {
                meshEdges.computeIfAbsent(sessionId, k -> new ConcurrentHashMap<>())
                         .computeIfAbsent(bridgeNodeA, k -> new java.util.ArrayList<>())
                         .add(bridgeNodeB);
                         
                Map<String, Object> payload = new java.util.HashMap<>();
                payload.put("type", "ASSIGN_PEERS");
                payload.put("targets", java.util.Collections.singletonList(bridgeNodeB));
                template.convertAndSend("/topic/session/" + sessionId + "/topology/" + bridgeNodeA, payload);
            }
        }
    }

    public void verifyPath(String sessionId, String sender, String target, String fileId) {
        registerActiveTransfer(sessionId, fileId, sender, target);
        Map<String, java.util.Set<String>> sessionEdges = actualMeshEdges.get(sessionId);
        boolean pathExists = false;
        Map<String, String> response = new java.util.HashMap<>();
        response.put("fileId", fileId);
        response.put("target", target);

        if (sessionEdges != null) {
            // BFS Search for shortest path
            java.util.Queue<String> queue = new java.util.LinkedList<>();
            java.util.Set<String> visited = new java.util.HashSet<>();
            java.util.Map<String, String> parentMap = new java.util.HashMap<>();
            
            queue.add(sender);
            visited.add(sender);
            
            while (!queue.isEmpty()) {
                String current = queue.poll();
                if (current.equals(target)) {
                    pathExists = true;
                    // Reconstruct path
                    java.util.List<String> pathList = new java.util.ArrayList<>();
                    String step = target;
                    while (step != null) {
                        pathList.add(step);
                        step = parentMap.get(step);
                    }
                    java.util.Collections.reverse(pathList);
                    response.put("routingPath", String.join(",", pathList));
                    break;
                }
                
                // Outgoing neighbors
                java.util.Set<String> neighbors = sessionEdges.get(current);
                if (neighbors != null) {
                    for (String neighbor : neighbors) {
                        if (!visited.contains(neighbor)) {
                            visited.add(neighbor);
                            parentMap.put(neighbor, current);
                            queue.add(neighbor);
                        }
                    }
                }

                // Incoming neighbors (undirected traversal)
                for (Map.Entry<String, java.util.Set<String>> entry : sessionEdges.entrySet()) {
                    String neighbor = entry.getKey();
                    if (entry.getValue().contains(current) && !visited.contains(neighbor)) {
                        visited.add(neighbor);
                        parentMap.put(neighbor, current);
                        queue.add(neighbor);
                    }
                }
            }
        }

        if (pathExists) {
            log.info("Path verified from {} to {}. Route: {}", sender, target, response.get("routingPath"));
            response.put("status", "PATH_VERIFIED");
        } else {
            log.warn("No path found from {} to {}. Initiating bridge assignment.", sender, target);
            response.put("status", "PATH_PENDING");
            
            // Assign bridge edge to sender (directly to target if possible)
            Map<String, String> userSockets = sessionUserSockets.get(sessionId);
            if (userSockets != null && userSockets.containsKey(target)) {
                // Prevent overlap check
                boolean alreadyAssigned = false;
                Map<String, java.util.List<String>> assigned = meshEdges.get(sessionId);
                if (assigned != null && assigned.containsKey(sender) && assigned.get(sender).contains(target)) {
                    alreadyAssigned = true;
                }
                
                if (!alreadyAssigned) {
                    java.util.List<String> oldTargetsCopy = new java.util.ArrayList<>();
                    if (assigned != null && assigned.containsKey(sender)) {
                        oldTargetsCopy.addAll(assigned.get(sender));
                    }
                    
                    meshEdges.computeIfAbsent(sessionId, k -> new ConcurrentHashMap<>())
                             .computeIfAbsent(sender, k -> new java.util.ArrayList<>())
                             .add(target);
                             
                    java.util.List<String> newTargets = meshEdges.get(sessionId).get(sender);

                    if (!new java.util.HashSet<>(oldTargetsCopy).equals(new java.util.HashSet<>(newTargets))) {
                        Map<String, Object> assignPayload = new java.util.HashMap<>();
                        assignPayload.put("type", "ASSIGN_PEERS");
                        assignPayload.put("targets", newTargets);
                        template.convertAndSend("/topic/session/" + sessionId + "/topology/" + sender, assignPayload);
                        log.info("Dispatched verifyPath bridge ASSIGN_PEERS to user {} with targets: {}", sender, newTargets);
                    }
                } else {
                    // Even if already assigned in meshEdges, if there is no actual open connection, re-dispatch ASSIGN_PEERS to trigger reconnect
                    boolean hasActualEdge = false;
                    if (sessionEdges != null) {
                        java.util.Set<String> outNeighbors = sessionEdges.get(sender);
                        if (outNeighbors != null && outNeighbors.contains(target)) {
                            hasActualEdge = true;
                        }
                        if (!hasActualEdge) {
                            java.util.Set<String> inNeighbors = sessionEdges.get(target);
                            if (inNeighbors != null && inNeighbors.contains(sender)) {
                                hasActualEdge = true;
                            }
                        }
                    }
                    if (!hasActualEdge && assigned != null && assigned.containsKey(sender)) {
                        java.util.List<String> targets = assigned.get(sender);
                        Map<String, Object> assignPayload = new java.util.HashMap<>();
                        assignPayload.put("type", "ASSIGN_PEERS");
                        assignPayload.put("targets", targets);
                        template.convertAndSend("/topic/session/" + sessionId + "/topology/" + sender, assignPayload);
                        log.info("Re-dispatched verifyPath bridge ASSIGN_PEERS to user {} with targets: {}", sender, targets);
                    }
                }
            }
        }
        template.convertAndSend("/topic/session/" + sessionId + "/path-verified/" + sender, response);
    }

    // --- Phase: Content-Aware Distributed Mesh ---

    public void registerOwnership(String sessionId, String fileId, String username, String status, int completedChunks) {
        Map<String, Map<String, com.college.placementhub.model.FileOwnership>> sessionRegistry = ownershipRegistry.computeIfAbsent(sessionId, k -> new ConcurrentHashMap<>());
        Map<String, com.college.placementhub.model.FileOwnership> fileRegistry = sessionRegistry.computeIfAbsent(fileId, k -> new ConcurrentHashMap<>());
        
        com.college.placementhub.model.FileOwnership ownership = fileRegistry.computeIfAbsent(username, k -> new com.college.placementhub.model.FileOwnership(username, status, completedChunks, System.currentTimeMillis(), 0));
        ownership.setTransferStatus(status);
        ownership.setCompletedChunks(completedChunks);
        ownership.setLastSeen(System.currentTimeMillis());
        
        log.info("[OWNERSHIP_REGISTRY] User {} registered as {} owner of file {} in session {}", username, status, fileId, sessionId);
    }

    public String getBestOwner(String sessionId, String fileId, java.util.Set<String> excludePeers) {
        Map<String, Map<String, com.college.placementhub.model.FileOwnership>> sessionRegistry = ownershipRegistry.get(sessionId);
        if (sessionRegistry == null) return null;
        
        Map<String, com.college.placementhub.model.FileOwnership> fileRegistry = sessionRegistry.get(fileId);
        if (fileRegistry == null) return null;

        Map<String, String> userSockets = sessionUserSockets.get(sessionId);
        if (userSockets == null) return null;

        String bestOwner = null;
        int minLoad = Integer.MAX_VALUE;

        for (Map.Entry<String, com.college.placementhub.model.FileOwnership> entry : fileRegistry.entrySet()) {
            String owner = entry.getKey();
            com.college.placementhub.model.FileOwnership ownership = entry.getValue();

            if ("COMPLETE".equals(ownership.getTransferStatus()) &&
                userSockets.containsKey(owner) &&
                (excludePeers == null || !excludePeers.contains(owner))) {
                
                if (ownership.getUploadLoad() < minLoad) {
                    minLoad = ownership.getUploadLoad();
                    bestOwner = owner;
                }
            }
        }
        return bestOwner;
    }

    public void incrementUploadLoad(String sessionId, String fileId, String username) {
        try {
            ownershipRegistry.get(sessionId).get(fileId).get(username).setUploadLoad(
                ownershipRegistry.get(sessionId).get(fileId).get(username).getUploadLoad() + 1
            );
        } catch (Exception e) {}
    }

    public void decrementUploadLoad(String sessionId, String fileId, String username) {
        try {
            int currentLoad = ownershipRegistry.get(sessionId).get(fileId).get(username).getUploadLoad();
            if (currentLoad > 0) {
                ownershipRegistry.get(sessionId).get(fileId).get(username).setUploadLoad(currentLoad - 1);
            }
        } catch (Exception e) {}
    }

    public void triggerReplication(String sessionId, String fileId, String fileName, long fileSize, String fileType, int totalChunks) {
        int RF = 3; // Configurable Replication Factor
        
        Map<String, Map<String, com.college.placementhub.model.FileOwnership>> sessionRegistry = ownershipRegistry.get(sessionId);
        if (sessionRegistry == null) return;
        Map<String, com.college.placementhub.model.FileOwnership> fileRegistry = sessionRegistry.get(fileId);
        if (fileRegistry == null) return;

        Map<String, String> userSockets = sessionUserSockets.get(sessionId);
        if (userSockets == null || userSockets.size() <= 1) return;

        int currentReplicaCount = 0;
        java.util.Set<String> currentOwners = new java.util.HashSet<>();
        
        for (Map.Entry<String, com.college.placementhub.model.FileOwnership> entry : fileRegistry.entrySet()) {
            if ("COMPLETE".equals(entry.getValue().getTransferStatus()) && userSockets.containsKey(entry.getKey())) {
                currentReplicaCount++;
                currentOwners.add(entry.getKey());
            }
        }

        if (currentReplicaCount < RF) {
            int deficit = RF - currentReplicaCount;
            log.info("[REPLICATION] File {} has {}/{} replicas. Deficit: {}", fileId, currentReplicaCount, RF, deficit);

            java.util.List<String> availablePeers = new java.util.ArrayList<>(userSockets.keySet());
            availablePeers.removeAll(currentOwners);
            java.util.Collections.shuffle(availablePeers);

            int replicationsTriggered = 0;
            for (String targetPeer : availablePeers) {
                if (replicationsTriggered >= deficit) break;

                Map<String, Object> replicatePayload = new java.util.HashMap<>();
                replicatePayload.put("type", "REPLICATE_REQUEST");
                replicatePayload.put("fileId", fileId);
                replicatePayload.put("fileName", fileName);
                replicatePayload.put("fileSize", fileSize);
                replicatePayload.put("fileType", fileType);
                replicatePayload.put("totalChunks", totalChunks);
                replicatePayload.put("targetPeer", targetPeer);

                template.convertAndSend("/topic/session/" + sessionId + "/transfer-commands/" + targetPeer, replicatePayload);
                log.info("[REPLICATION] Issued REPLICATE_REQUEST to {} for file {}", targetPeer, fileId);
                replicationsTriggered++;
            }
        }
    }
}