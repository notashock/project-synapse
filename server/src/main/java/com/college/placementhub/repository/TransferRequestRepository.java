package com.college.placementhub.repository;

import com.college.placementhub.model.TransferRequest;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface TransferRequestRepository extends MongoRepository<TransferRequest, String> {
    List<TransferRequest> findBySessionId(String sessionId);
    List<TransferRequest> findBySessionIdAndStatus(String sessionId, String status);
    void deleteBySessionId(String sessionId);
    void deleteBySessionIdAndSender(String sessionId, String sender);
    void deleteBySessionIdAndRequester(String sessionId, String requester);
}
