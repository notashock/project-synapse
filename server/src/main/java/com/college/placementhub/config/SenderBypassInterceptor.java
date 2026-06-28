package com.college.placementhub.config;

import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.stereotype.Component;

@Component
public class SenderBypassInterceptor implements ChannelInterceptor {

    @org.springframework.beans.factory.annotation.Autowired
    @org.springframework.context.annotation.Lazy
    private com.college.placementhub.service.SessionService sessionService;

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = StompHeaderAccessor.wrap(message);

        if (StompCommand.CONNECT.equals(accessor.getCommand())) {
            String username = accessor.getFirstNativeHeader("username");
            String sessionId = accessor.getFirstNativeHeader("sessionId");
            String socketId = accessor.getSessionId();
            if (username != null && sessionId != null && socketId != null) {
                java.util.Map<String, Object> sessionAttributes = accessor.getSessionAttributes();
                if (sessionAttributes != null) {
                    sessionAttributes.put("username", username);
                    sessionAttributes.put("sessionId", sessionId);
                    sessionAttributes.put("socketId", socketId);
                }
                sessionService.registerUserSocket(sessionId, username, socketId);
            }
        }

        if (StompCommand.SEND.equals(accessor.getCommand())) {
            String destination = accessor.getDestination();
            if (destination != null && destination.contains("/transfer-activity")) {
                Object payload = message.getPayload();
                String json = null;
                if (payload instanceof byte[]) {
                    json = new String((byte[]) payload, java.nio.charset.StandardCharsets.UTF_8);
                } else if (payload instanceof String) {
                    json = (String) payload;
                }
                
                if (json != null) {
                    try {
                        String[] parts = destination.split("/");
                        if (parts.length >= 5) {
                            String sessionId = parts[3];
                            String type = null;
                            if (json.contains("\"type\"")) {
                                if (json.contains("\"START\"")) {
                                    type = "START";
                                } else if (json.contains("\"END\"")) {
                                    type = "END";
                                }
                            }
                            String fileId = extractJsonField(json, "fileId");
                            if (type != null && fileId != null) {
                                sessionService.handleTransferActivityEvent(sessionId, type, fileId);
                            }
                        }
                    } catch (Exception e) {
                        // Ignore parsing exceptions
                    }
                }
            }
        }

        // We only care about actual data payloads (MESSAGE commands) leaving the server
        if (StompCommand.MESSAGE.equals(accessor.getCommand())) {

            // Extract the tag we attached in the controller
            String senderSocketId = (String) accessor.getHeader("senderSocketId");

            // Get the socket ID of the person the server is currently trying to send this to
            String recipientSocketId = accessor.getSessionId();

            // If they match, abort the send! (Return null drops the message entirely)
            if (senderSocketId != null && senderSocketId.equals(recipientSocketId)) {
                return null;
            }
        }
        return message;
    }

    private String extractJsonField(String json, String field) {
        int index = json.indexOf("\"" + field + "\"");
        if (index == -1) return null;
        int colonIndex = json.indexOf(":", index);
        if (colonIndex == -1) return null;
        int startQuote = json.indexOf("\"", colonIndex);
        if (startQuote == -1) return null;
        int endQuote = json.indexOf("\"", startQuote + 1);
        if (endQuote == -1) return null;
        return json.substring(startQuote + 1, endQuote);
    }
}