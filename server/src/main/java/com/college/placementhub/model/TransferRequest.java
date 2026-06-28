package com.college.placementhub.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Document(collection = "transfer_requests")
public class TransferRequest {
    @Id
    private String id;
    private String sessionId;
    private String fileId;
    private String sender;
    private String requester;
    private String status; // PENDING, TRANSMITTING, COMPLETED
    private long createdAt;

    public TransferRequest(String sessionId, String fileId, String sender, String requester, String status, long createdAt) {
        this.sessionId = sessionId;
        this.fileId = fileId;
        this.sender = sender;
        this.requester = requester;
        this.status = status;
        this.createdAt = createdAt;
    }
}
