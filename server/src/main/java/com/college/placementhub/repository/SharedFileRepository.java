package com.college.placementhub.repository;

import com.college.placementhub.model.SharedFile;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface SharedFileRepository extends MongoRepository<SharedFile, String> {
    List<SharedFile> findBySessionId(String sessionId);
    void deleteBySessionIdAndSender(String sessionId, String sender);
}
