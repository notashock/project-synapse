package com.college.placementhub.dto;

import lombok.Data;

@Data
public class SessionRequest {
    private String sessionTitle;
    @com.fasterxml.jackson.annotation.JsonProperty("isLocal")
    private boolean isLocal;
    private String guestUsername;
}
