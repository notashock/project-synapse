package com.college.placementhub.controller;

import com.college.placementhub.dto.JoinRequest;
import com.college.placementhub.dto.SessionRequest;
import com.college.placementhub.dto.SessionResponse;
import com.college.placementhub.model.ActiveSession;
import com.college.placementhub.security.UserDetailsImpl;
import com.college.placementhub.service.SessionService;
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

    @PostMapping("/create")
    public ResponseEntity<?> startSession(
            @RequestBody SessionRequest request,
            @AuthenticationPrincipal UserDetailsImpl userDetails
    ) {
        ActiveSession session = sessionService.createSession(userDetails.getUsername(), request.getSessionTitle());
        return ResponseEntity.ok(new SessionResponse(session.getSessionId(), session.getJoinCode(), session.getSessionTitle()));
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
        try {
            boolean success = sessionService.joinSession(sessionId, userDetails.getUsername(), payload.joinCode().trim());
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
            @AuthenticationPrincipal UserDetailsImpl userDetails
    ) {
        sessionService.leaveSession(sessionId, userDetails.getUsername());
        return ResponseEntity.ok("Successfully left the session.");
    }

    @GetMapping("/active")
    public ResponseEntity<?> getActiveSessions() {
        return ResponseEntity.ok(sessionService.getAllActiveSessions());
    }

    @DeleteMapping("/end/{sessionId}")
    public ResponseEntity<?> endSession(
            @PathVariable String sessionId,
            @AuthenticationPrincipal UserDetailsImpl userDetails
    ) {
        try {
            boolean isAuthorized = sessionService.endSession(sessionId, userDetails.getUsername());
            if (isAuthorized) {
                return ResponseEntity.ok("Session Terminated");
            } else {
                return ResponseEntity.status(HttpStatus.FORBIDDEN).body("Error: you are not authorized to end this session.");
            }
        } catch(IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body("Error: " + e.getMessage());
        }
    }
}