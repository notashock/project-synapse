package com.college.placementhub.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class ChatMessage {
    private String message;
    private String content;
    private long timestamp;
}
