package com.college.placementhub.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.util.HashSet;
import java.util.Set;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "sessions")
public class Session {
    @Id
    private String sessionId;
    private String sessionTitle;
    private String hostUsername;
    private String joinCode;
    private long createdAt;
    
    @com.fasterxml.jackson.annotation.JsonProperty("isLocal")
    private boolean isLocal;
    
    private Set<String> participants = new HashSet<>();
    private SessionStatus status;

    public Session(String sessionId, String sessionTitle, String hostUsername, String joinCode, long createdAt, boolean isLocal, SessionStatus status) {
        this.sessionId = sessionId;
        this.sessionTitle = sessionTitle;
        this.hostUsername = hostUsername;
        this.joinCode = joinCode;
        this.createdAt = createdAt;
        this.isLocal = isLocal;
        this.status = status;
        this.participants = new HashSet<>();
    }
}
