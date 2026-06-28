package com.college.placementhub.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.Set;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class SessionResponse {
    private String sessionId;
    private String joinCode;
    private String sessionTitle;
    private String hostUsername;
    @com.fasterxml.jackson.annotation.JsonProperty("isLocal")
    private boolean isLocal;
    private Set<String> participants;
}
