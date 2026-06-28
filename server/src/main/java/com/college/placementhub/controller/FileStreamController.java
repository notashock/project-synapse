package com.college.placementhub.controller;

import com.college.placementhub.dto.FileStreamMessage;
import com.college.placementhub.model.SharedFile;
import com.college.placementhub.model.Session;
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
        Session session = sessionService.getSessionDetails(sessionId);
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

    @MessageMapping("/session/{sessionId}/register-owner")
    public void registerOwner(
            @DestinationVariable String sessionId,
            @Payload java.util.Map<String, Object> payload,
            SimpMessageHeaderAccessor headerAccessor
    ) {
        Session session = sessionService.getSessionDetails(sessionId);
        if (session != null) {
            String username = (String) payload.get("username");
            String fileId = (String) payload.get("fileId");
            String fileName = (String) payload.get("fileName");
            String fileType = (String) payload.get("fileType");
            Object sizeObj = payload.get("fileSize");
            long fileSize = sizeObj instanceof Number ? ((Number) sizeObj).longValue() : 0L;
            Object chunksObj = payload.get("totalChunks");
            int totalChunks = chunksObj instanceof Number ? ((Number) chunksObj).intValue() : 0;
            String status = (String) payload.get("status");
            if (status == null) status = "COMPLETE";

            sessionService.registerOwnership(sessionId, fileId, username, status, totalChunks);
            
            if ("COMPLETE".equals(status)) {
                sessionService.triggerReplication(sessionId, fileId, fileName, fileSize, fileType, totalChunks);
            }
        }
    }

    @MessageMapping("/session/{sessionId}/sync-ownership")
    public void syncOwnership(
            @DestinationVariable String sessionId,
            @Payload java.util.Map<String, Object> payload,
            SimpMessageHeaderAccessor headerAccessor
    ) {
        Session session = sessionService.getSessionDetails(sessionId);
        if (session != null) {
            String username = (String) payload.get("username");
            Object filesObj = payload.get("files");
            if (filesObj instanceof java.util.List) {
                for (Object fileObj : (java.util.List<?>) filesObj) {
                    if (fileObj instanceof java.util.Map) {
                        java.util.Map<?, ?> fileMap = (java.util.Map<?, ?>) fileObj;
                        String fileId = (String) fileMap.get("fileId");
                        Object chunksObj = fileMap.get("totalChunks");
                        int totalChunks = chunksObj instanceof Number ? ((Number) chunksObj).intValue() : 0;
                        sessionService.registerOwnership(sessionId, fileId, username, "COMPLETE", totalChunks);
                    }
                }
            }
        }
    }

    @MessageMapping("/session/{sessionId}/transfer-request")
    public void requestTransfer(
            @DestinationVariable String sessionId,
            @Payload java.util.Map<String, Object> payload,
            SimpMessageHeaderAccessor headerAccessor
    ) {
        Session session = sessionService.getSessionDetails(sessionId);
        if (session != null) {
            if (!session.isLocal() && headerAccessor.getUser() == null) {
                log.warn("Blocked transfer request: Unauthenticated user in cloud session {}.", sessionId);
                return;
            }

            // Extract the requests list and requester from the payload
            Object requestsObj = payload.get("requests");
            String requester = (String) payload.get("requester");
            String targetSocketId = headerAccessor.getSessionId();

            if (requestsObj instanceof java.util.List) {
                java.util.List<?> requests = (java.util.List<?>) requestsObj;
                for (Object reqObj : requests) {
                    if (reqObj instanceof java.util.Map) {
                        java.util.Map<?, ?> reqMap = (java.util.Map<?, ?>) reqObj;
                        String fileId = (String) reqMap.get("fileId");
                        String sender = (String) reqMap.get("sender");
                        Object startChunkObj = reqMap.get("startChunkIndex");
                        Integer startChunkIndex = startChunkObj instanceof Number ? ((Number) startChunkObj).intValue() : 0;

                        // Content-Aware Routing: Find best owner
                        String bestOwner = sessionService.getBestOwner(sessionId, fileId, java.util.Collections.singleton(requester));
                        String targetSender = bestOwner != null ? bestOwner : sender;
                        
                        log.info("[ROUTING] Transfer request for file {} by {}. Target mapped from {} to best owner {}", fileId, requester, sender, targetSender);
                        sessionService.incrementUploadLoad(sessionId, fileId, targetSender);

                        // Broadcast the transfer command to the targeted sender's user-specific topic
                        template.convertAndSend("/topic/session/" + sessionId + "/transfer-commands/" + targetSender, Map.of(
                                "type", "TRANSFER_REQUEST",
                                "sender", sender, // Keep original sender for UI metadata mapping
                                "routedSender", targetSender, // The peer who will actually send it
                                "fileId", fileId,
                                "startChunkIndex", startChunkIndex,
                                "requester", requester != null ? requester : "Unknown",
                                "targetSocketId", targetSocketId != null ? targetSocketId : ""
                        ));
                    }
                }
            }
        } else {
            log.warn("Blocked transfer request: Session {} is inactive.", sessionId);
        }
    }
}