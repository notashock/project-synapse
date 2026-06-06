package com.college.placementhub.dto;

import lombok.Data;

@Data
public class SessionRequest {
    private String sessionTitle;
    private boolean isLocal;
    private String guestUsername;
}
