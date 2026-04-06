package com.college.placementhub.model;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Data
@AllArgsConstructor
public class ActiveSession {
    private String sessionId;
    private String sessionTitle;
    private String trainerUsername;
    private String joinCode;
    private long createdAt;
    private Set<String> participants;
    public ActiveSession(String sessionId, String sessionTitle, String trainerUsername, String joinCode, long createdAt) {
        this.sessionId = sessionId;
        this.sessionTitle = sessionTitle;
        this.trainerUsername = trainerUsername;
        this.joinCode = joinCode;
        this.createdAt = createdAt;
        this.participants = ConcurrentHashMap.newKeySet(); // Initialize empty set
    }
}
