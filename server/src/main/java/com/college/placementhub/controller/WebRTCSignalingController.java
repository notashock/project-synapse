package com.college.placementhub.controller;

import com.college.placementhub.model.ActiveSession;
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
        ActiveSession session = sessionService.getSessionDetails(sessionId);
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
}
