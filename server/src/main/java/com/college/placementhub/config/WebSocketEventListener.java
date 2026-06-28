package com.college.placementhub.config;

import com.college.placementhub.service.SessionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.util.Map;

@Component
@RequiredArgsConstructor
@Slf4j
public class WebSocketEventListener {

    private final SessionService sessionService;

    @EventListener
    public void handleWebSocketDisconnectListener(SessionDisconnectEvent event) {
        StompHeaderAccessor headerAccessor = StompHeaderAccessor.wrap(event.getMessage());
        Map<String, Object> sessionAttributes = headerAccessor.getSessionAttributes();
        if (sessionAttributes != null) {
            String username = (String) sessionAttributes.get("username");
            String sessionId = (String) sessionAttributes.get("sessionId");
            String socketId = (String) sessionAttributes.get("socketId");
            if (username != null && sessionId != null) {
                log.info("WebSocket disconnect detected for user: {} in session: {}", username, sessionId);
                if (socketId != null) {
                    sessionService.unregisterUserSocket(sessionId, username, socketId);
                }
                
                // Only leave the session logically if they have no other active sockets mapped
                // This prevents state-loss during micro-drops where a new socket connects before the old socket disconnects
                if (sessionService.getUserSocket(sessionId, username) == null) {
                    sessionService.leaveSession(sessionId, username);
                    sessionService.healMesh(sessionId, username);
                }
            }
        }
    }
}
