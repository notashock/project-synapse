package com.college.placementhub.controller;

import com.college.placementhub.dto.FileStreamMessage;
import com.college.placementhub.model.SharedFile;
import com.college.placementhub.model.ActiveSession;
import com.college.placementhub.repository.SharedFileRepository;
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
public class FileStreamController {

    private final SimpMessagingTemplate template;
    private final SessionService sessionService;
    private final SharedFileRepository sharedFileRepository;

    @MessageMapping("/session/{sessionId}/stream")
    public void relayFileChunk(
            @DestinationVariable String sessionId,
            @Payload FileStreamMessage message,
            SimpMessageHeaderAccessor headerAccessor // 1. Inject the accessor
    ) {
        ActiveSession session = sessionService.getSessionDetails(sessionId);
        if (session != null) {
            if (!session.isLocal() && headerAccessor.getUser() == null) {
                log.warn("Blocked file transfer: Unauthenticated user attempted to stream to cloud session {}.", sessionId);
                return;
            }

            if ("START".equals(message.type())) {
                SharedFile sharedFile = new SharedFile(
                        message.fileId(),
                        sessionId,
                        message.fileName(),
                        message.fileType(),
                        message.fileSize(),
                        message.sender(),
                        message.totalChunks(),
                        System.currentTimeMillis(),
                        message.sender() != null && message.sender().startsWith("Guest-")
                );
                sharedFileRepository.save(sharedFile);
                log.info("File Metadata Saved: {} ({}) in Session: {}", message.fileName(), message.fileId(), sessionId);
            }

            // 2. Grab the sender's unique socket ID and put it in a Header Map
            String senderSocketId = headerAccessor.getSessionId();
            Map<String, Object> headers = Map.of("senderSocketId", senderSocketId);

            // 3. Broadcast the message WITH the headers attached
            template.convertAndSend("/topic/session/" + sessionId + "/file-stream", message, headers);

        } else {
            log.warn("Blocked file transfer: Session {} is inactive.", sessionId);
        }
    }
}