package com.college.placementhub.controller;

import com.college.placementhub.dto.JoinRequest;
import com.college.placementhub.dto.SessionRequest;
import com.college.placementhub.dto.SessionResponse;
import com.college.placementhub.model.Session;
import com.college.placementhub.security.UserDetailsImpl;
import com.college.placementhub.service.SessionService;
import com.college.placementhub.repository.SharedFileRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/sessions")
@RequiredArgsConstructor
public class SessionController {

    private final SessionService sessionService;
    private final SharedFileRepository sharedFileRepository;
    private final com.college.placementhub.repository.TransferRequestRepository transferRequestRepository;

    @PostMapping("/create")
    public ResponseEntity<?> startSession(
            @RequestBody SessionRequest request,
            @AuthenticationPrincipal UserDetailsImpl userDetails
    ) {
        if (!request.isLocal() && userDetails == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("Cloud sessions require authentication.");
        }
        String username = userDetails != null ? userDetails.getUsername() : request.getGuestUsername();
        if (username == null || username.trim().isEmpty()) {
            return ResponseEntity.badRequest().body("Username or Guest Username is required.");
        }
        Session session = sessionService.createSession(username, request.getSessionTitle(), request.isLocal());
        return ResponseEntity.ok(new SessionResponse(
                session.getSessionId(),
                session.getJoinCode(),
                session.getSessionTitle(),
                session.getHostUsername(),
                session.isLocal(),
                session.getParticipants()
        ));
    }

    @PostMapping("/join/{sessionId}")
    public ResponseEntity<?> joinSession(
            @PathVariable String sessionId,
            @RequestBody JoinRequest payload,
            @AuthenticationPrincipal UserDetailsImpl userDetails
    ) {
        if (payload.joinCode() == null || payload.joinCode().trim().isEmpty()) {
            return ResponseEntity.badRequest().body("Join code is required.");
        }
        Session session;
        try {
            session = sessionService.getSessionDetails(sessionId);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.GONE).body(e.getMessage());
        }
        if (session == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body("Error: Session not found.");
        }
        if (!session.isLocal() && userDetails == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("Cloud sessions require authentication.");
        }
        String username = userDetails != null ? userDetails.getUsername() : payload.guestUsername();
        if (username == null || username.trim().isEmpty()) {
            return ResponseEntity.badRequest().body("Username or Guest Username is required.");
        }
        try {
            boolean success = sessionService.joinSession(sessionId, username, payload.joinCode().trim());
            if (success) {
                return ResponseEntity.ok("Joined successfully.");
            } else {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body("Error: Session not found.");
            }
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(e.getMessage());
        }
    }

    @PostMapping("/leave/{sessionId}")
    public ResponseEntity<?> leaveSession(
            @PathVariable String sessionId,
            @RequestParam(required = false) String guestUsername,
            @AuthenticationPrincipal UserDetailsImpl userDetails
    ) {
        Session session;
        try {
            session = sessionService.getSessionDetails(sessionId);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.GONE).body(e.getMessage());
        }
        if (session == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body("Error: Session not found.");
        }
        if (!session.isLocal() && userDetails == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("Cloud sessions require authentication.");
        }
        String username = userDetails != null ? userDetails.getUsername() : guestUsername;
        if (username != null) {
            sessionService.leaveSession(sessionId, username);
            sharedFileRepository.deleteBySessionIdAndSender(sessionId, username);
        }
        return ResponseEntity.ok("Successfully left the session.");
    }

    @GetMapping("/active")
    public ResponseEntity<?> getActiveSessions() {
        return ResponseEntity.ok(sessionService.getAllActiveSessions());
    }

    @GetMapping("/{sessionId}")
    public ResponseEntity<?> getSession(
            @PathVariable String sessionId,
            @AuthenticationPrincipal UserDetailsImpl userDetails
    ) {
        Session session;
        try {
            session = sessionService.getSessionDetails(sessionId);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.GONE).body(e.getMessage());
        }
        if (session == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body("Error: Session not found.");
        }
        if (!session.isLocal() && userDetails == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("Cloud sessions require authentication.");
        }
        return ResponseEntity.ok(new SessionResponse(
                session.getSessionId(),
                session.getJoinCode(),
                session.getSessionTitle(),
                session.getHostUsername(),
                session.isLocal(),
                session.getParticipants()
        ));
    }

    @GetMapping("/code/{joinCode}")
    public ResponseEntity<?> getSessionByCode(
            @PathVariable String joinCode,
            @AuthenticationPrincipal UserDetailsImpl userDetails
    ) {
        Session session;
        try {
            session = sessionService.getSessionByJoinCode(joinCode);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.GONE).body(e.getMessage());
        }
        if (session == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body("Error: Session not found.");
        }
        if (!session.isLocal() && userDetails == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("Cloud sessions require authentication.");
        }
        return ResponseEntity.ok(new SessionResponse(
                session.getSessionId(),
                session.getJoinCode(),
                session.getSessionTitle(),
                session.getHostUsername(),
                session.isLocal(),
                session.getParticipants()
        ));
    }

    @GetMapping("/{sessionId}/files")
    public ResponseEntity<?> getSessionFiles(
            @PathVariable String sessionId,
            @AuthenticationPrincipal UserDetailsImpl userDetails
    ) {
        Session session;
        try {
            session = sessionService.getSessionDetails(sessionId);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.GONE).body(e.getMessage());
        }
        if (session == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body("Error: Session not found.");
        }
        if (!session.isLocal() && userDetails == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("Cloud sessions require authentication.");
        }
        return ResponseEntity.ok(sharedFileRepository.findBySessionId(sessionId));
    }

    @DeleteMapping("/end/{sessionId}")
    public ResponseEntity<?> endSession(
            @PathVariable String sessionId,
            @RequestParam(required = false) String guestUsername,
            @AuthenticationPrincipal UserDetailsImpl userDetails
    ) {
        Session session;
        try {
            session = sessionService.getSessionDetails(sessionId);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.GONE).body(e.getMessage());
        }
        if (session == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body("Error: Session not found.");
        }
        if (!session.isLocal() && userDetails == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("Cloud sessions require authentication.");
        }
        String username = userDetails != null ? userDetails.getUsername() : guestUsername;
        if (username == null) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("Unauthorized");
        try {
            boolean isAuthorized = sessionService.endSession(sessionId, username);
            if (isAuthorized) {
                return ResponseEntity.ok("Session Terminated");
            } else {
                return ResponseEntity.status(HttpStatus.FORBIDDEN).body("Error: you are not authorized to end this session.");
            }
        } catch(IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body("Error: " + e.getMessage());
        }
    }

    @lombok.Data
    public static class FileTransferRequestPayload {
        private String fileId;
        private String sender;
    }



    // WebSockets handle file transfer requests and commands.
}