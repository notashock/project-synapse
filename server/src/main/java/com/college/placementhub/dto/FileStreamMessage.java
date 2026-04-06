package com.college.placementhub.dto;

public record FileStreamMessage(
        String type,
        String fileId,
        String fileName,
        String fileType,
        long fileSize,
        String sender,
        int totalChunks,
        int chunkIndex,
        String data
){}
