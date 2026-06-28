package com.college.placementhub.controller;

import com.college.placementhub.model.Session;
import com.college.placementhub.service.SessionService;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.stereotype.Controller;

@Controller
@RequiredArgsConstructor
public class LiveChatController {

    private final SessionService sessionService;

    // We use .send to differentiate the incoming request from the /topic broadcast
    @MessageMapping("/session/{sessionId}/chat.send")
    public void handleChatMessage(
            @DestinationVariable String sessionId, 
            @Payload ChatMessagePayload payload,
            SimpMessageHeaderAccessor headerAccessor
    ) {
        Session session = sessionService.getSessionDetails(sessionId);
        if (session != null) {
            if (!session.isLocal() && headerAccessor.getUser() == null) {
                return; // Block unauthenticated chat on cloud sessions
            }
            sessionService.broadcastChatMessage(sessionId, payload.sender(), payload.content());
        }
    }

    // A lightweight Record just for receiving the WS payload
    public record ChatMessagePayload(String sender, String content) {}
}