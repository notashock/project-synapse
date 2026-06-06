package com.college.placementhub.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Document(collection = "shared_files")
public class SharedFile {
    @Id
    private String id;
    private String fileId;
    private String sessionId;
    private String fileName;
    private String fileType;
    private long fileSize;
    private String sender;
    private int totalChunks;
    private long createdAt;
    private boolean isAnonymous;

    public SharedFile(String fileId, String sessionId, String fileName, String fileType, long fileSize, String sender, int totalChunks, long createdAt, boolean isAnonymous) {
        this.fileId = fileId;
        this.sessionId = sessionId;
        this.fileName = fileName;
        this.fileType = fileType;
        this.fileSize = fileSize;
        this.sender = sender;
        this.totalChunks = totalChunks;
        this.createdAt = createdAt;
        this.isAnonymous = isAnonymous;
    }
}
