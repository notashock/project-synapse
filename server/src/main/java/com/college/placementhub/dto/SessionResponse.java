package com.college.placementhub.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class SessionResponse {
    private String sessionId;
    private String joinCode;
    private String sessionTitle;
}
