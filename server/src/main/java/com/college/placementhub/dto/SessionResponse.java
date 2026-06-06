package com.college.placementhub.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class SessionResponse {
    private String sessionId;
    private String joinCode;
    private String sessionTitle;
    private String trainerUsername;
    private boolean isLocal;
}
