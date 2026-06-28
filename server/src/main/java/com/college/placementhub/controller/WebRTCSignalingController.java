package com.college.placementhub.controller;

import com.college.placementhub.model.Session;
import com.college.placementhub.model.SessionStatus;
import com.college.placementhub.service.SessionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.util.Map;

@Slf4j
@Controller
@RequiredArgsConstructor
public class WebRTCSignalingController {

    private final SimpMessagingTemplate template;
    private final SessionService sessionService;

    @MessageMapping("/session/{sessionId}/signal")
    public void relayWebRTCSignal(
            @DestinationVariable String sessionId,
            @Payload Map<String, Object> signalData,
            SimpMessageHeaderAccessor headerAccessor
    ) {
        Session session = sessionService.getSessionDetails(sessionId);
        if (session != null) {
            if (!session.isLocal() && headerAccessor.getUser() == null) {
                log.warn("Blocked WebRTC signal: Unauthenticated user attempted to signal to cloud session {}.", sessionId);
                return;
            }
            // Include sender socket ID so clients can distinguish messages
            String senderSocketId = headerAccessor.getSessionId();
            Map<String, Object> headers = Map.of("senderSocketId", senderSocketId);
            
            template.convertAndSend("/topic/session/" + sessionId + "/signal", signalData, headers);
            log.debug("Relayed WebRTC signal in session {}: {}", sessionId, signalData.get("type"));
        } else {
            log.warn("Blocked WebRTC signal: Session {} is inactive.", sessionId);
        }
    }

    @MessageMapping("/session/{sessionId}/heartbeat")
    public void handleHeartbeat(@DestinationVariable String sessionId, SimpMessageHeaderAccessor headerAccessor) {
        Session session = sessionService.getSessionDetails(sessionId);
        if (session != null) {
            sessionService.keepAlive(sessionId);
        }
    }

    @MessageMapping("/session/{sessionId}/request-chunks")
    public void requestMissingChunks(@DestinationVariable String sessionId, @Payload Map<String, Object> payload) {
        Session session = sessionService.getSessionDetails(sessionId);
        if (session != null && session.getStatus() == SessionStatus.ACTIVE) {
            template.convertAndSend("/topic/session/" + sessionId + "/request-chunks", payload);
        }
    }

    @MessageMapping("/session/{sessionId}/chunk-error")
    public void reportChunkError(@DestinationVariable String sessionId, @Payload Map<String, Object> payload) {
        Session session = sessionService.getSessionDetails(sessionId);
        if (session != null && session.getStatus() == SessionStatus.ACTIVE) {
            template.convertAndSend("/topic/session/" + sessionId + "/chunk-error", payload);
        }
    }

    @MessageMapping("/session/{sessionId}/topology/request")
    public void requestTopology(@DestinationVariable String sessionId, @Payload Map<String, String> payload, SimpMessageHeaderAccessor headerAccessor) {
        String username = payload.get("username");
        String socketId = headerAccessor.getSessionId();
        if (username != null && socketId != null) {
            sessionService.notifyTopology(sessionId, username, socketId);
        }
    }

    @MessageMapping("/session/{sessionId}/topology/report-drop")
    public void reportTopologyDrop(@DestinationVariable String sessionId, @Payload Map<String, String> payload) {
        String reportingUser = payload.get("reportingUser");
        String droppedUser = payload.get("droppedUser");
        if (reportingUser != null && droppedUser != null) {
            sessionService.handlePeerDrop(sessionId, reportingUser, droppedUser);
        }
    }

    @MessageMapping("/session/{sessionId}/topology/report-open")
    public void reportDataChannelOpen(@DestinationVariable String sessionId, @Payload Map<String, String> payload) {
        String reportingUser = payload.get("reportingUser");
        String targetUser = payload.get("targetUser");
        if (reportingUser != null && targetUser != null) {
            sessionService.handleDataChannelOpen(sessionId, reportingUser, targetUser);
        }
    }

    @MessageMapping("/session/{sessionId}/topology/report-close")
    public void reportDataChannelClose(@DestinationVariable String sessionId, @Payload Map<String, String> payload) {
        String reportingUser = payload.get("reportingUser");
        String targetUser = payload.get("targetUser");
        if (reportingUser != null && targetUser != null) {
            sessionService.handleDataChannelClose(sessionId, reportingUser, targetUser);
        }
    }

    @MessageMapping("/session/{sessionId}/verify-path")
    public void verifyPath(@DestinationVariable String sessionId, @Payload Map<String, String> payload) {
        String sender = payload.get("sender");
        String target = payload.get("target");
        String fileId = payload.get("fileId");
        if (sender != null && target != null && fileId != null) {
            sessionService.verifyPath(sessionId, sender, target, fileId);
        }
    }

    @MessageMapping("/session/{sessionId}/topology/sync")
    public void syncTopology(@DestinationVariable String sessionId, @Payload Map<String, Object> payload) {
        String reportingUser = (String) payload.get("reportingUser");
        @SuppressWarnings("unchecked")
        java.util.List<String> activePeers = (java.util.List<String>) payload.get("activePeers");
        if (reportingUser != null && activePeers != null) {
            sessionService.syncTopology(sessionId, reportingUser, activePeers);
        }
    }
}
