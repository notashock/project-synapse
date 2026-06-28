package com.college.placementhub.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class FileOwnership {
    private String ownerPeer;
    private String transferStatus; // "PARTIAL" or "COMPLETE"
    private int completedChunks;
    private long lastSeen;
    private int uploadLoad;
}
