package com.college.placementhub.repository;

import com.college.placementhub.model.Session;
import com.college.placementhub.model.SessionStatus;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface SessionRepository extends MongoRepository<Session, String> {
    List<Session> findByStatus(SessionStatus status);
    Session findByJoinCode(String joinCode);
}
