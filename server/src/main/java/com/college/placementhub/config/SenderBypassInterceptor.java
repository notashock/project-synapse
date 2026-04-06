package com.college.placementhub.config;

import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.stereotype.Component;

@Component
public class SenderBypassInterceptor implements ChannelInterceptor {

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = StompHeaderAccessor.wrap(message);

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
}