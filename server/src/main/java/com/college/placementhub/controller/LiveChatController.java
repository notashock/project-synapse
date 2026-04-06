package com.college.placementhub.controller;

import com.college.placementhub.service.SessionService;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Controller;

@Controller
@RequiredArgsConstructor
public class LiveChatController {

    private final SessionService sessionService;

    // We use .send to differentiate the incoming request from the /topic broadcast
    @MessageMapping("/session/{sessionId}/chat.send")
    public void handleChatMessage(@DestinationVariable String sessionId, @Payload ChatMessagePayload payload) {
        sessionService.broadcastChatMessage(sessionId, payload.sender(), payload.content());
    }

    // A lightweight Record just for receiving the WS payload
    public record ChatMessagePayload(String sender, String content) {}
}